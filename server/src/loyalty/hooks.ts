/**
 * Where the loyalty programme touches the order pipeline.
 *
 * Everything here is a HOOK. Nothing in this file changes how an order is priced, placed or
 * moved between statuses; it observes those events and writes ledger entries. If this whole file
 * were deleted the shop would still work, which is the property that makes it safe to run a
 * points programme on top of a checkout that predates it.
 *
 * ── A LOYALTY FAILURE MUST NEVER COST A SALE ───────────────────────────────────────
 *
 * Every hook is wrapped in `safely`, which swallows and logs. If the ledger throws, if Neon is
 * slow, if a connection dies mid-write — the order still lands, the customer still gets their
 * confirmation, and the points are reconciled later by the sweep or by hand. Points are
 * recoverable from the order history; a sale abandoned at the last step is not.
 *
 * The reverse is emphatically not true, which is why the hooks run AFTER the order transaction
 * commits and never inside it. Inside, a loyalty failure would roll the order back.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  LOYALTY_ENABLED,
  DELIVERED_STATUSES,
  VOIDING_STATUSES,
} from "./config.js";
import { getOrCreateAccount, recordEarn, voidEarnForOrder, reverseRedemption } from "./ledger.js";
import { merchandiseCentsOf } from "./rules.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * How long a hook may take before checkout stops waiting for it.
 *
 * Neon is in us-east-2 and Render's free tier sleeps, so a cold connection can take seconds. The
 * timeout does not cancel the query — it cannot; it stops the CUSTOMER waiting for it. The write
 * may still land, which is fine: every hook below is idempotent by database constraint, so a
 * write that completes after we walked away cannot be applied twice by the retry that follows.
 */
const HOOK_TIMEOUT_MS = 4000;

/**
 * Run a hook so that its failure is logged, never propagated.
 *
 * Returns `null` on any failure, including a timeout. Callers are not expected to check — the
 * point is that there is nothing useful for them to do about it.
 */
export async function safely<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  if (!LOYALTY_ENABLED) return null;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${HOOK_TIMEOUT_MS}ms`)), HOOK_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    // Deliberately console.error and nothing else. There is no error-reporting service wired up,
    // and inventing one here would be a bigger decision than this file should be making. The
    // sweep endpoint reports what is unreconciled, which is the durable way to notice.
    console.error(`[loyalty] ${label} failed (order still processed):`, e instanceof Error ? e.message : e);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ───────────────────────────────────────────────────────────────── placement

/**
 * An order has been placed. Open or find the account for its phone, and record the pending earn.
 *
 * Called AFTER the order transaction has committed. The account is keyed on the phone the
 * customer typed, not on their login, so guest orders accumulate against the same account they
 * will eventually claim — and a signed-in customer's login is NOT bound here, because a phone
 * number typed at checkout proves nothing about who owns it (see `linkCustomerToAccount`).
 */
export async function onOrderPlaced(
  db: Db,
  order: { id: number; phone: string; whatsapp: string; email: string; subtotalCents: number; discountCents: number; pointsDiscountCents: number },
): Promise<void> {
  const merchandiseCents = merchandiseCentsOf(order);
  if (merchandiseCents <= 0) return;

  // Fall back to the WhatsApp number: some customers give a landline as `phone` and their real
  // mobile as `whatsapp`, and a landline has no Lebanese mobile prefix to key an account on.
  const raw = [order.phone, order.whatsapp].find((p) => p && p.trim());
  if (!raw) return;

  const account = await getOrCreateAccount(db, raw, { email: order.email });
  await recordEarn(db, { accountId: account.id, orderId: order.id, merchandiseCents });
}

// ───────────────────────────────────────────────────────────────── status changes

/**
 * An order has changed status. Two things follow.
 *
 * DELIVERED stamps `deliveredAt` once, and only if it is not already set. That timestamp is the
 * start of the COD hold and therefore of every maturity calculation in the system, so it must
 * never move: `canTransition` returns true when from === to, and the admin endpoint writes an
 * event unconditionally, which means an admin re-saving "Delivered" would otherwise push a
 * customer's points back by however long passed between the two clicks.
 *
 * CANCELLED / REFUSED / UNAVAILABLE kills the pending earn and gives back anything redeemed.
 * A confirmed earn is deliberately NOT clawed back automatically: confirmation means the hold
 * elapsed, which means the goods were delivered and kept for a week, and reversing that is a
 * judgement an admin makes with a reason attached (`reverseEarn`).
 */
export async function onOrderStatusChanged(
  db: Db,
  input: { orderId: number; to: string; at?: Date },
): Promise<void> {
  const at = input.at ?? new Date();

  if ((DELIVERED_STATUSES as readonly string[]).includes(input.to)) {
    // Conditional on deliveredAt still being null, so this is a no-op the second time.
    await db.order.updateMany({
      where: { id: input.orderId, deliveredAt: null },
      data: { deliveredAt: at },
    });
    return;
  }

  if ((VOIDING_STATUSES as readonly string[]).includes(input.to)) {
    const label = `Order ${input.to}`;
    await voidEarnForOrder(db, input.orderId, label);
    await reverseRedemption(db, input.orderId, label, at);
  }
}

// ───────────────────────────────────────────────────────────────── boot

/** A shared secret short enough to guess is not a secret, it is a speed bump. */
const MIN_SWEEP_SECRET_LENGTH = 24;

export const LOYALTY_SWEEP_SECRET = (process.env.LOYALTY_SWEEP_SECRET ?? "").trim();

/**
 * Refuse to start rather than expose an unauthenticated write endpoint.
 *
 * Same shape as `assertComingSoonConfig`, including the part that matters most: it is enforced
 * ONLY while the feature is on. Enforcing it unconditionally would mean a missing secret takes
 * production down during the state the site is in almost all the time — the programme is off by
 * default and will be for a while.
 */
export function assertLoyaltyConfig(): void {
  if (!LOYALTY_ENABLED) return;

  const fail = (lines: string[]): never => {
    console.error(["", "FATAL: LOYALTY_ENABLED=true, but the loyalty config is not safe to run.", "", ...lines, "", "  Refusing to start.", ""].join("\n"));
    process.exit(1);
  };

  if (!LOYALTY_SWEEP_SECRET) {
    fail([
      "  LOYALTY_SWEEP_SECRET is not set. /api/internal/loyalty-sweep writes to the ledger,",
      "  and an empty secret would let an empty header through.",
      "",
      "  Generate one with:",
      '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    ]);
  }
  if (LOYALTY_SWEEP_SECRET.length < MIN_SWEEP_SECRET_LENGTH) {
    fail([
      `  LOYALTY_SWEEP_SECRET is ${LOYALTY_SWEEP_SECRET.length} characters; the minimum is ${MIN_SWEEP_SECRET_LENGTH}.`,
      "  A guessable secret on a write endpoint is a public write endpoint.",
    ]);
  }
}
