/**
 * The ledger service — the only module that writes loyalty entries.
 *
 * Everything else reads. Funnelling every write through one file is what makes "balance equals
 * the sum of the ledger" an invariant rather than an aspiration, and what makes a customer
 * dispute answerable a year later.
 *
 * The arithmetic lives in `rules.ts` as pure functions. This module fetches rows, hands them
 * over, and persists what comes back.
 *
 * ── Two properties worth stating up front ──────────────────────────────────────────
 *
 * NOTHING HERE DEPENDS ON A SCHEDULED JOB. Confirmation, tier and expiry are computed from the
 * ledger and the orders behind it every time an account is read. `materialise()` writes those
 * conclusions down, but only as a cache: skip it forever and every balance is still correct.
 *
 * NOTHING HERE MUTATES A BALANCE. `balanceCached` is written, but only ever to the value the
 * ledger already implies. Points move by appending entries — including negative ones.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  RATES,
  LOYALTY_ENABLED,
  LOYALTY_REDEMPTION_ENABLED,
  DELIVERED_STATUSES,
  type TierKey,
} from "./config.js";
import {
  addMonths,
  applyMultiplier,
  basePointsFor,
  computeState,
  effectiveTier,
  merchandiseCentsOf,
  multiplierFor,
  quoteRedemption,
  tierForSpend,
  type AccountState,
  type LedgerFacts,
  type OrderFacts,
  type RedemptionQuote,
} from "./rules.js";
import { normaliseLebanesePhone } from "./phone.js";

/** Anything that can run a query — the client, or a transaction handle. */
type Db = PrismaClient | Prisma.TransactionClient;

export class LoyaltyError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "LoyaltyError";
  }
}

// ───────────────────────────────────────────────────────────────── accounts

/**
 * Find or create the account for a phone number.
 *
 * The number is normalised here and nowhere else on the write path. Every account key in the
 * system therefore comes from one function, which is the only way two spellings of one number
 * cannot become two accounts.
 */
export async function getOrCreateAccount(
  db: Db,
  rawPhone: string,
  extra: { customerId?: number | null; email?: string } = {},
): Promise<{ id: number; phoneE164: string; created: boolean }> {
  const phone = normaliseLebanesePhone(rawPhone);
  if (!phone.ok) {
    throw new LoyaltyError(`Not a usable Lebanese number: ${phone.detail}`, `phone-${phone.reason}`);
  }

  const existing = await db.loyaltyAccount.findUnique({ where: { phoneE164: phone.e164 } });
  if (existing) {
    // Link a login to an account that was created from a guest order, without ever re-pointing
    // an account that already belongs to somebody.
    if (extra.customerId && !existing.customerId) {
      await db.loyaltyAccount.update({ where: { id: existing.id }, data: { customerId: extra.customerId } });
    }
    if (extra.email && !existing.email) {
      await db.loyaltyAccount.update({ where: { id: existing.id }, data: { email: extra.email } });
    }
    return { id: existing.id, phoneE164: existing.phoneE164, created: false };
  }

  const account = await db.loyaltyAccount.create({
    data: {
      phoneE164: phone.e164,
      customerId: extra.customerId ?? null,
      email: extra.email ?? "",
    },
  });
  return { id: account.id, phoneE164: account.phoneE164, created: true };
}

// ───────────────────────────────────────────────────────────────── reading

type LoadedAccount = {
  id: number;
  tier: TierKey;
  tierEarnedAt: Date;
  balanceCached: number;
  state: AccountState;
  /** Tier the trailing-window spend qualifies for, before the hold rule is applied. */
  qualifiesFor: TierKey;
  refusalCount: number;
};

/** Fetch everything the rules need for one account: its entries, and the orders behind them. */
async function load(db: Db, accountId: number, now: Date): Promise<LoadedAccount> {
  const account = await db.loyaltyAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new LoyaltyError(`No loyalty account ${accountId}`, "no-account");

  const rows = await db.loyaltyLedgerEntry.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: { id: true, type: true, status: true, points: true, orderId: true, createdAt: true, confirmedAt: true },
  });
  const entries = rows as unknown as LedgerFacts[];

  const orderIds = [...new Set(entries.map((e) => e.orderId).filter((v): v is number => v !== null))];
  const orderRows = orderIds.length
    ? await db.order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true, status: true, deliveredAt: true,
          subtotalCents: true, discountCents: true, pointsDiscountCents: true,
        },
      })
    : [];

  const orders = new Map<number, OrderFacts>();
  const merchandise = new Map<number, number>();
  for (const o of orderRows) {
    orders.set(o.id, { id: o.id, status: o.status, deliveredAt: o.deliveredAt });
    merchandise.set(o.id, merchandiseCentsOf(o));
  }

  const state = computeState(entries, orders, merchandise, now);

  // Refusals are counted from the orders this account actually has entries against, which is
  // the only link between an account and its orders until history linkage exists as a feature.
  const refusalCount = orderRows.filter((o) => o.status === "refused").length;

  return {
    id: account.id,
    tier: account.tier as TierKey,
    tierEarnedAt: account.tierEarnedAt,
    balanceCached: account.balanceCached,
    state,
    qualifiesFor: tierForSpend(state.windowSpendCents),
    refusalCount,
  };
}

/** Read-only view. Does not write, so it is safe to call from anywhere, including a GET. */
export async function readAccount(db: Db, accountId: number, now = new Date()): Promise<LoadedAccount> {
  return load(db, accountId, now);
}

// ───────────────────────────────────────────────────────────────── materialising

/**
 * Write down what the rules already imply: confirm matured earns, apply the tier, lapse expired
 * points, refresh the cached balance.
 *
 * Purely a cache refresh. Every value it writes was already true; not calling it changes no
 * customer-visible number, which is the property that makes the missing cron a cosmetic problem
 * rather than a correctness one.
 *
 * Idempotent and concurrency-safe: each confirmation is a conditional update matching only rows
 * still `pending`, so two callers racing produce one confirmation and one no-op.
 */
export async function materialise(db: Db, accountId: number, now = new Date()): Promise<{
  confirmed: number;
  expiredPoints: number;
  tierChanged: boolean;
  balance: number;
}> {
  let confirmed = 0;
  let expiredPoints = 0;

  let loaded = await load(db, accountId, now);

  // Confirm OLDEST FIRST, recomputing the tier after each one.
  //
  // The order matters and is the whole reason this is a loop rather than an updateMany: a
  // customer crossing into Bloom partway through a batch must get 1.25x on the orders that
  // confirm after the crossing and 1.0x on the ones before it. Confirming them together, or
  // newest-first, would either over-pay or under-pay the difference.
  const ready = [...loaded.state.readyToConfirm].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const entry of ready) {
    // CONFIRMED spend only — not `windowSpendCents`, which also counts matured-but-unconfirmed
    // earns. Using that would let this entry's own spend, and every sibling maturing alongside
    // it, count toward the tier that multiplies it: one large order would push the customer to
    // Bloom and then pay itself 1.25x. The reload at the bottom of this loop is what lets the
    // NEXT entry see this one's spend.
    const tierNow = effectiveTier(
      tierForSpend(loaded.state.confirmedSpendCents),
      { tier: loaded.tier, earnedAt: loaded.tierEarnedAt },
      now,
    );
    const multiplier = multiplierFor(tierNow.tier);

    // `points` currently holds BASE points — the multiplier is applied at confirmation, not at
    // placement, because the tier at placement is not the tier that should be honoured.
    const finalPoints = applyMultiplier(entry.points, multiplier);

    const res = await db.loyaltyLedgerEntry.updateMany({
      where: { id: entry.id, status: "pending" }, // conditional: a racing caller finds nothing
      data: {
        status: "confirmed",
        confirmedAt: now,
        points: finalPoints,
        multiplierApplied: new Prisma.Decimal(multiplier),
        expiresAt: addMonths(now, RATES.expiryMonths),
      },
    });
    if (res.count === 0) continue; // somebody else confirmed it first

    confirmed++;
    if (tierNow.changed) {
      await db.loyaltyAccount.update({
        where: { id: accountId },
        data: { tier: tierNow.tier, tierEarnedAt: tierNow.earnedAt },
      });
    }
    loaded = await load(db, accountId, now); // spend moved, so the tier may have too
  }

  // Tier can also change with nothing confirming — a demotion falls due at an anniversary.
  const finalTier = effectiveTier(
    loaded.qualifiesFor,
    { tier: loaded.tier, earnedAt: loaded.tierEarnedAt },
    now,
  );
  const tierChanged = finalTier.tier !== loaded.tier;
  if (tierChanged) {
    await db.loyaltyAccount.update({
      where: { id: accountId },
      data: { tier: finalTier.tier, tierEarnedAt: finalTier.earnedAt },
    });
    loaded = await load(db, accountId, now);
  }

  // Expiry. Always an entry — points never vanish without a record to point at.
  if (loaded.state.hasLapsed && loaded.state.balance > 0) {
    expiredPoints = loaded.state.balance;
    await db.loyaltyLedgerEntry.create({
      data: {
        accountId,
        type: "expiry",
        status: "confirmed",
        points: -expiredPoints,
        confirmedAt: now,
        reason: `${RATES.expiryMonths} months with no confirmed earn or redemption`,
      },
    });
    loaded = await load(db, accountId, now);
  }

  if (loaded.balanceCached !== loaded.state.balance) {
    await db.loyaltyAccount.update({
      where: { id: accountId },
      data: { balanceCached: loaded.state.balance },
    });
  }

  return { confirmed, expiredPoints, tierChanged, balance: loaded.state.balance };
}

// ───────────────────────────────────────────────────────────────── earning

/**
 * Record the points an order will earn, held pending until the COD hold elapses.
 *
 * Stores BASE points; the multiplier lands at confirmation. Idempotent by database constraint:
 * a second call for the same order hits the unique index on `earnOrderId` and is swallowed, so
 * a replayed status change or a double-submitted checkout cannot grant twice.
 */
export async function recordEarn(
  db: Db,
  input: { accountId: number; orderId: number; merchandiseCents: number; now?: Date },
): Promise<{ created: boolean; basePoints: number }> {
  if (!LOYALTY_ENABLED) return { created: false, basePoints: 0 };

  const basePoints = basePointsFor(input.merchandiseCents);
  if (basePoints <= 0) return { created: false, basePoints: 0 };

  try {
    await db.loyaltyLedgerEntry.create({
      data: {
        accountId: input.accountId,
        orderId: input.orderId,
        earnOrderId: input.orderId, // the guard — see schema.prisma
        type: "earn",
        status: "pending",
        points: basePoints,
        reason: `Order earns ${basePoints} points once delivered`,
        createdAt: input.now,
      },
    });
    return { created: true, basePoints };
  } catch (e) {
    if (isUniqueViolation(e)) return { created: false, basePoints }; // already recorded
    throw e;
  }
}

/** 100 points, once per account, ever. */
export async function recordSignupBonus(db: Db, accountId: number, now = new Date()) {
  if (!LOYALTY_ENABLED) return { created: false };
  const already = await db.loyaltyLedgerEntry.findFirst({
    where: { accountId, type: "manualAdjustment", reason: { startsWith: SIGNUP_REASON } },
  });
  if (already) return { created: false };
  await db.loyaltyLedgerEntry.create({
    data: {
      accountId, type: "manualAdjustment", status: "confirmed",
      points: RATES.signupBonusPoints, confirmedAt: now,
      reason: SIGNUP_REASON,
    },
  });
  return { created: true };
}

/** 200 points, once per calendar year. */
export async function recordBirthdayBonus(db: Db, accountId: number, now = new Date()) {
  if (!LOYALTY_ENABLED) return { created: false };
  const reason = `${BIRTHDAY_REASON} ${now.getFullYear()}`;
  const already = await db.loyaltyLedgerEntry.findFirst({ where: { accountId, reason } });
  if (already) return { created: false };
  await db.loyaltyLedgerEntry.create({
    data: {
      accountId, type: "manualAdjustment", status: "confirmed",
      points: RATES.birthdayBonusPoints, confirmedAt: now, reason,
    },
  });
  return { created: true };
}

const SIGNUP_REASON = "Welcome bonus";
const BIRTHDAY_REASON = "Birthday bonus";

// ───────────────────────────────────────────────────────────────── voiding & reversing

/**
 * Kill the pending earn on an order that will never be paid for.
 *
 * Only touches `pending` rows. An earn that already confirmed is money the customer can
 * legitimately have spent, and retracting it is a reversal — see `reverseEarn`.
 */
export async function voidEarnForOrder(db: Db, orderId: number, reason: string) {
  const res = await db.loyaltyLedgerEntry.updateMany({
    where: { orderId, type: "earn", status: "pending" },
    data: { status: "void", reason },
  });
  return { voided: res.count };
}

/**
 * Claw back points from an order that already confirmed.
 *
 * `portion` supports a proportional reversal for a partial return. NOTHING CALLS IT WITH A
 * PORTION BELOW 1 TODAY, and that is deliberate rather than an oversight: the order system does
 * not model partial refusal, so there is no field recording refunded merchandise value and no
 * honest way to compute the share automatically. The arithmetic lives here so that an admin
 * making the judgement by hand has one correct implementation to call. See the note in the
 * stage-2 report.
 */
export async function reverseEarn(
  db: Db,
  input: { orderId: number; portion?: number; reason: string; enteredBy?: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const portion = Math.min(1, Math.max(0, input.portion ?? 1));

  const earns = await db.loyaltyLedgerEntry.findMany({
    where: { orderId: input.orderId, type: "earn", status: "confirmed" },
  });
  if (earns.length === 0) return { reversed: 0, points: 0 };

  let total = 0;
  for (const e of earns) {
    // Rounded so the customer keeps the fraction rather than the shop.
    const take = Math.floor(e.points * portion);
    if (take <= 0) continue;
    await db.loyaltyLedgerEntry.create({
      data: {
        accountId: e.accountId, orderId: input.orderId,
        type: "reversal", status: "confirmed",
        points: -take, confirmedAt: now,
        reason: input.reason, createdBy: input.enteredBy ?? "",
      },
    });
    total += take;
  }
  return { reversed: earns.length, points: total };
}

/** Give back points spent on an order that was cancelled or refused. */
export async function reverseRedemption(db: Db, orderId: number, reason: string, now = new Date()) {
  const spends = await db.loyaltyLedgerEntry.findMany({
    where: { orderId, type: "redeem" },
  });
  const alreadyBack = await db.loyaltyLedgerEntry.findFirst({
    where: { orderId, type: "redemptionReversal" },
  });
  if (alreadyBack || spends.length === 0) return { restored: 0 };

  let restored = 0;
  for (const s of spends) {
    await db.loyaltyLedgerEntry.create({
      data: {
        accountId: s.accountId, orderId,
        type: "redemptionReversal", status: "confirmed",
        points: Math.abs(s.points), confirmedAt: now, reason,
      },
    });
    restored += Math.abs(s.points);
  }
  return { restored };
}

// ───────────────────────────────────────────────────────────────── redeeming

/** What may be redeemed, without writing anything. Safe for a preview endpoint. */
export async function previewRedemption(
  db: Db,
  input: { accountId: number; requestedPoints: number; merchandiseCents: number; signedIn: boolean; now?: Date },
): Promise<RedemptionQuote> {
  const now = input.now ?? new Date();
  const loaded = await load(db, input.accountId, now);
  return quoteRedemption({
    requestedPoints: input.requestedPoints,
    balance: loaded.state.balance,
    merchandiseCents: input.merchandiseCents,
    redemptionEnabled: LOYALTY_REDEMPTION_ENABLED,
    signedIn: input.signedIn,
    refusalCount: loaded.refusalCount,
  });
}

/**
 * Spend points on an order.
 *
 * Runs SERIALIZABLE and re-reads the balance inside the transaction, so two checkout tabs
 * redeeming the same points cannot both succeed — one commits and the other fails its
 * serialisation check. Reading the balance before opening the transaction and trusting it would
 * be the obvious exploit, and it is the one that gets found.
 *
 * The caller must pass a PrismaClient, not a transaction handle: this opens its own.
 */
export async function redeem(
  db: PrismaClient,
  input: {
    accountId: number;
    orderId: number;
    requestedPoints: number;
    merchandiseCents: number;
    signedIn: boolean;
    now?: Date;
  },
): Promise<{ points: number; cents: number }> {
  const now = input.now ?? new Date();

  return db.$transaction(
    async (tx) => {
      const loaded = await load(tx, input.accountId, now);
      const quote = quoteRedemption({
        requestedPoints: input.requestedPoints,
        balance: loaded.state.balance,
        merchandiseCents: input.merchandiseCents,
        redemptionEnabled: LOYALTY_REDEMPTION_ENABLED,
        signedIn: input.signedIn,
        refusalCount: loaded.refusalCount,
      });
      if (!quote.ok) throw new LoyaltyError(quote.detail, quote.reason);

      await tx.loyaltyLedgerEntry.create({
        data: {
          accountId: input.accountId,
          orderId: input.orderId,
          type: "redeem",
          status: "confirmed",
          points: -quote.points,
          confirmedAt: now,
          reason: `Redeemed ${quote.points} points for ${(quote.cents / 100).toFixed(2)} off`,
        },
      });

      // Written inside the same transaction so a concurrent reader never sees a balance that
      // has not had this redemption taken off it.
      await tx.loyaltyAccount.update({
        where: { id: input.accountId },
        data: { balanceCached: loaded.state.balance - quote.points },
      });

      return { points: quote.points, cents: quote.cents };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

// ───────────────────────────────────────────────────────────────── admin

/**
 * A manual correction.
 *
 * `enteredBy` is SELF-DECLARED and deliberately named to say so — admin access is a single
 * shared key with no per-admin identity, so this can only ever mean "someone holding the key".
 * Nothing may ever trust it for authorisation. The accountability that works here is the
 * mandatory reason and the timestamp.
 *
 * NOTE FOR WHOEVER READS THIS NEXT: the moment a second person has admin access, real
 * per-admin identity stops being optional.
 */
export async function manualAdjustment(
  db: Db,
  input: { accountId: number; points: number; reason: string; enteredBy: string; now?: Date },
) {
  const reason = input.reason.trim();
  if (reason.length < RATES.minAdjustmentReasonLength) {
    throw new LoyaltyError(
      `A reason of at least ${RATES.minAdjustmentReasonLength} characters is required — it is what makes this reconstructable later.`,
      "reason-too-short",
    );
  }
  const enteredBy = input.enteredBy.trim();
  if (!enteredBy) throw new LoyaltyError("Initials are required.", "entered-by-required");
  if (!Number.isInteger(input.points) || input.points === 0) {
    throw new LoyaltyError("Adjustment must be a non-zero whole number of points.", "bad-points");
  }

  const entry = await db.loyaltyLedgerEntry.create({
    data: {
      accountId: input.accountId,
      type: "manualAdjustment",
      status: "confirmed",
      points: input.points,
      confirmedAt: input.now ?? new Date(),
      reason,
      createdBy: enteredBy,
    },
  });
  return { id: entry.id };
}

// ───────────────────────────────────────────────────────────────── guest back-fill

export type GuestClaim = {
  orderId: number;
  number: string;
  deliveredAt: Date | null;
  merchandiseCents: number;
  basePoints: number;
};

/**
 * Delivered guest orders whose phone matches this account and which nobody has ruled on.
 *
 * DERIVED, not a queue table. A pending claim is simply a match with no decision recorded
 * against it, so there is no second copy of the truth to fall out of step.
 *
 * Deliberately does NOT touch Order.customerId. Attaching a past guest order to an account
 * changes what appears in that customer's order history — addresses, items, everything — which
 * is an orders-domain decision with its own privacy weight, not something loyalty should do as
 * a side effect. Approving a claim writes ledger entries and nothing else.
 */
export async function pendingGuestClaims(db: Db, accountId: number, now = new Date()): Promise<GuestClaim[]> {
  const account = await db.loyaltyAccount.findUnique({ where: { id: accountId } });
  if (!account) return [];

  const cutoff = new Date(now.getTime() - RATES.guestBackfillMaxAgeDays * 24 * 60 * 60 * 1000);

  // Phone is stored raw on Order, so matching happens in code through the same normaliser that
  // produced the account key. Comparing raw strings in SQL would miss "03 123456" against
  // "+9613123456" — which is the entire reason the normaliser exists.
  const candidates = await db.order.findMany({
    where: {
      status: { in: [...DELIVERED_STATUSES] },
      deliveredAt: { not: null, gte: cutoff },
      customerId: null,
    },
    select: {
      id: true, number: true, phone: true, whatsapp: true, deliveredAt: true,
      subtotalCents: true, discountCents: true, pointsDiscountCents: true,
    },
  });

  const alreadyEarned = new Set(
    (await db.loyaltyLedgerEntry.findMany({
      where: { accountId, type: "earn" },
      select: { orderId: true },
    })).map((e) => e.orderId),
  );

  const out: GuestClaim[] = [];
  for (const o of candidates) {
    if (alreadyEarned.has(o.id)) continue;
    const matches = [o.phone, o.whatsapp]
      .map((p) => normaliseLebanesePhone(p))
      .some((r) => r.ok && r.e164 === account.phoneE164);
    if (!matches) continue;
    const merchandiseCents = merchandiseCentsOf(o);
    out.push({
      orderId: o.id,
      number: o.number,
      deliveredAt: o.deliveredAt,
      merchandiseCents,
      basePoints: basePointsFor(merchandiseCents),
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────── helpers

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Exported for tests and admin tooling: the ledger sum, straight from the rows. */
export async function ledgerSum(db: Db, accountId: number): Promise<number> {
  const rows = await db.loyaltyLedgerEntry.findMany({
    where: { accountId, status: { not: "void" } },
    select: { points: true },
  });
  return rows.reduce((n, r) => n + r.points, 0);
}

export type { AccountState, LoadedAccount };
export { LOYALTY_ENABLED, LOYALTY_REDEMPTION_ENABLED };
