/**
 * The ledger service — the only module that writes loyalty entries.
 *
 * Everything else reads. Funnelling every write through one file is what makes "balance equals
 * the sum of the ledger" an invariant rather than an aspiration, and what makes a customer
 * dispute answerable a year later.
 *
 * ── THIS MODULE DOES NO ARITHMETIC ─────────────────────────────────────────────────
 *
 * `rules.ts` decides; this fetches rows, hands them over, and persists the plan that comes back.
 * That division is not stylistic. When both files calculated, they drifted — expiry was computed
 * in one and applied in the other, so expired points stayed spendable; the tier multiplier was
 * applied on write but not on read, so a Bouquet customer's points were worth two thirds of what
 * they should be until something happened to call the sweep. Both bugs were invisible because
 * each file was self-consistent.
 *
 * So if you find yourself adding a calculation below, it belongs in `rules.ts`. The test for
 * whether this file is still honest: `materialise()` must contain no branch that decides an
 * amount, a date or a tier.
 *
 * ── NOTHING HERE DEPENDS ON A SCHEDULED JOB ────────────────────────────────────────
 *
 * Confirmation, the multiplier, the tier and expiry are all derived every time an account is
 * read, and `readAccount` reports them whether or not any row has been written. `materialise()`
 * writes those same conclusions down so the database agrees with what was reported, which
 * matters for admin queries, exports and dispute history — but skip it forever and every
 * customer-facing number stays correct.
 *
 * ── NOTHING HERE MUTATES A BALANCE ─────────────────────────────────────────────────
 *
 * `balanceCached` is written, but only ever to the value the ledger already implies. Points move
 * by appending entries — including negative ones.
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
  applyMultiplier,
  basePointsFor,
  computeState,
  isMoney,
  merchandiseCentsOf,
  multiplierFor,
  pointsToCents,
  quoteRedemption,
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
 *
 * THIS FUNCTION DOES NOT BIND A LOGIN. It used to take a `customerId` and attach it to any
 * existing account that had none, which meant anyone who could reach a caller with a phone number
 * of their choosing could claim a stranger's balance — verified: 1200 points moved to an
 * attacker's login, permanently, because the "never re-point an account that already belongs to
 * somebody" guard then locked the real owner out of their own account.
 *
 * Binding a login to a phone is a claim of identity, and there is no way to verify one here: no
 * SMS provider, no WhatsApp Business API, SMTP unconfigured. The same reasoning already sent
 * guest back-fill through admin review. Linking goes the same way — see `linkCustomerToAccount`.
 */
export async function getOrCreateAccount(
  db: Db,
  rawPhone: string,
  extra: { email?: string } = {},
): Promise<{ id: number; phoneE164: string; created: boolean }> {
  const phone = normaliseLebanesePhone(rawPhone);
  if (!phone.ok) {
    throw new LoyaltyError(`Not a usable Lebanese number: ${phone.detail}`, `phone-${phone.reason}`);
  }

  const existing = await db.loyaltyAccount.findUnique({ where: { phoneE164: phone.e164 } });
  if (existing) {
    if (extra.email && !existing.email) {
      await db.loyaltyAccount.update({ where: { id: existing.id }, data: { email: extra.email } });
    }
    return { id: existing.id, phoneE164: existing.phoneE164, created: false };
  }

  try {
    const account = await db.loyaltyAccount.create({
      data: { phoneE164: phone.e164, email: extra.email ?? "" },
    });
    return { id: account.id, phoneE164: account.phoneE164, created: true };
  } catch (e) {
    // Two checkouts for the same new number arriving together: one wins the unique index on
    // phoneE164, the other lands here. Re-read rather than throwing P2002 at the caller — the
    // account it wanted now exists, which is the outcome it asked for.
    if (!isUniqueViolation(e)) throw e;
    const won = await db.loyaltyAccount.findUnique({ where: { phoneE164: phone.e164 } });
    if (!won) throw e;
    return { id: won.id, phoneE164: won.phoneE164, created: false };
  }
}

/**
 * Attach a storefront login to a loyalty account.
 *
 * Deliberately separate from lookup, deliberately explicit, and NOT to be called with a phone
 * number the customer typed. Whoever calls this is asserting that the login and the phone belong
 * to the same person; today the only thing that can honestly assert that is an admin looking at
 * the order history, which is the same gate guest back-fill goes through.
 *
 * Refuses to re-point an account that already belongs to somebody. That guard is necessary but
 * not sufficient on its own — it is what made the takeover permanent when the binding itself was
 * reachable from ordinary lookup.
 */
export async function linkCustomerToAccount(
  db: Db,
  input: { accountId: number; customerId: number; approvedBy: string },
): Promise<{ linked: boolean }> {
  const approvedBy = input.approvedBy.trim();
  if (!approvedBy) throw new LoyaltyError("Initials are required.", "entered-by-required");

  const account = await db.loyaltyAccount.findUnique({ where: { id: input.accountId } });
  if (!account) throw new LoyaltyError(`No loyalty account ${input.accountId}`, "no-account");
  if (account.customerId === input.customerId) return { linked: false };
  if (account.customerId !== null) {
    throw new LoyaltyError("This loyalty account already belongs to a different login.", "already-linked");
  }

  // Conditional so two approvals racing produce one link and one no-op, rather than the second
  // silently overwriting the first.
  const res = await db.loyaltyAccount.updateMany({
    where: { id: input.accountId, customerId: null },
    data: { customerId: input.customerId },
  });
  return { linked: res.count > 0 };
}

/**
 * Link a brand-new login to a brand-new loyalty account, on the customer's first authenticated
 * read — but ONLY when there is provably nothing to steal.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────────────
 *
 * Link only when the normalised phone has NO existing loyalty account AND NO delivered orders.
 * Nothing of value can move, because nothing of value exists yet: no balance, no history, no
 * spend toward a tier. Anything with history goes to the admin queue instead.
 *
 * ── WHY NOT SOMETHING MORE GENEROUS ────────────────────────────────────────────────
 *
 * Every automatic route that reaches an account with history reopens the takeover: a phone
 * number is self-declared, there is no SMS provider to verify one, and `getOrCreateAccount`
 * binding a caller-supplied customerId to a caller-supplied phone is exactly how 1,200 points
 * moved to an attacker's login in a test against the live database. The most an attacker can do
 * under this rule is claim a stranger's FUTURE orders on a number they do not own — and only
 * before that stranger ever orders or registers. It is a support problem, not a theft.
 *
 * ── AND WHY THE RACE MATTERS ───────────────────────────────────────────────────────
 *
 * Two first-reads arriving together on the same fresh phone must produce one account and one
 * link. The check-then-create is made atomic by the unique index on `phoneE164`, not by the
 * check: the loser of the race gets P2002, re-reads, finds an account that now HAS an owner, and
 * declines — which is the same decision it would have made had it arrived a second later. This
 * is the fourth member of the check-then-act family in this file and it is guarded the same way
 * as the other three.
 */
export async function autoLinkOnFirstRead(
  db: Db,
  input: { customerId: number; rawPhone: string; now?: Date },
): Promise<{ linked: boolean; accountId: number | null; reason: string }> {
  if (!LOYALTY_ENABLED) return { linked: false, accountId: null, reason: "disabled" };

  const phone = normaliseLebanesePhone(input.rawPhone);
  if (!phone.ok) return { linked: false, accountId: null, reason: `unusable-phone:${phone.reason}` };

  const existing = await db.loyaltyAccount.findUnique({ where: { phoneE164: phone.e164 } });
  if (existing) {
    // Somebody has already earned against this number. Whether that is this customer or not is
    // exactly the question an automatic rule cannot answer.
    return { linked: false, accountId: null, reason: "account-exists" };
  }

  // Orders placed before the programme was switched on have no ledger row, so the account check
  // above cannot see them. Bounded: this runs once per customer, and the scan stops at a size
  // that would mean this store had grown far past the point where an admin queue was optional.
  const delivered = await db.order.findMany({
    where: { status: { in: [...DELIVERED_STATUSES] } },
    select: { phone: true, whatsapp: true },
    take: 5000,
  });
  const hasHistory = delivered.some((o) =>
    [o.phone, o.whatsapp].some((p) => {
      const n = normaliseLebanesePhone(p);
      return n.ok && n.e164 === phone.e164;
    }),
  );
  if (hasHistory) return { linked: false, accountId: null, reason: "delivered-orders-exist" };

  try {
    const account = await db.loyaltyAccount.create({
      data: { phoneE164: phone.e164, customerId: input.customerId },
    });
    // Logged deliberately, with both values, so that if this rule ever turns out too generous
    // there is a record of exactly what it did and to whom.
    console.log(`[loyalty] auto-linked ${phone.e164} to customer ${input.customerId} (account ${account.id})`);
    return { linked: true, accountId: account.id, reason: "linked" };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Lost the race. Re-read and decide again on what is now true.
    const won = await db.loyaltyAccount.findUnique({ where: { phoneE164: phone.e164 } });
    if (won && won.customerId === input.customerId) {
      // The same customer, twice at once. Idempotent, not a takeover.
      return { linked: true, accountId: won.id, reason: "linked-by-concurrent-request" };
    }
    console.log(`[loyalty] auto-link declined for customer ${input.customerId}: ${phone.e164} was claimed concurrently`);
    return { linked: false, accountId: null, reason: "lost-race" };
  }
}

// ───────────────────────────────────────────────────────────────── reading

type LoadedAccount = {
  id: number;
  /** The tier STORED on the row. `state.tier` is the one in force — prefer that. */
  storedTier: TierKey;
  storedTierEarnedAt: Date;
  balanceCached: number;
  state: AccountState;
  refusalCount: number;
};

/** Fetch everything the rules need for one account: its entries, and the orders behind them. */
async function load(db: Db, accountId: number, now: Date): Promise<LoadedAccount> {
  const account = await db.loyaltyAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new LoyaltyError(`No loyalty account ${accountId}`, "no-account");

  const rows = await db.loyaltyLedgerEntry.findMany({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, type: true, status: true, points: true, orderId: true,
      createdAt: true, confirmedAt: true, multiplierApplied: true,
    },
  });
  // Decimal(4,2) out of Postgres, plain number into the rules — the arithmetic there is integer
  // points and a small rational multiplier, and a Decimal would silently change how it rounds.
  const entries = rows.map((r) => ({
    ...r,
    multiplierApplied: r.multiplierApplied === null ? 1 : Number(r.multiplierApplied),
  })) as unknown as LedgerFacts[];

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

  const state = computeState(
    entries,
    orders,
    merchandise,
    { tier: account.tier as TierKey, earnedAt: account.tierEarnedAt },
    now,
  );

  // Refusals are counted from the orders this account actually has entries against, which is the
  // only link between an account and its orders until history linkage exists as a feature.
  const refusalCount = orderRows.filter((o) => o.status === "refused").length;

  return {
    id: account.id,
    storedTier: account.tier as TierKey,
    storedTierEarnedAt: account.tierEarnedAt,
    balanceCached: account.balanceCached,
    state,
    refusalCount,
  };
}

/** Read-only view. Does not write, so it is safe to call from anywhere, including a GET. */
export async function readAccount(db: Db, accountId: number, now = new Date()): Promise<LoadedAccount> {
  return load(db, accountId, now);
}

// ───────────────────────────────────────────────────────────────── materialising

/**
 * Execute the plan `computeState` produced. Decides nothing.
 *
 * Every value written here came out of the rules and has ALREADY been reported to whoever read
 * the account — this only makes the database say the same thing. That is the property that makes
 * the missing cron a cosmetic problem rather than a correctness one, and it holds because there
 * is no second calculation in this function to disagree with the first.
 *
 * Idempotent and concurrency-safe throughout: confirmations are conditional updates matching only
 * rows still `pending`, and expiry entries carry a `dedupeKey`, so two callers racing produce one
 * write and one no-op.
 */
export async function materialise(db: Db, accountId: number, now = new Date()): Promise<{
  confirmed: number;
  expiredPoints: number;
  tierChanged: boolean;
  balance: number;
}> {
  const loaded = await load(db, accountId, now);
  const { plan, balance } = loaded.state;

  let confirmed = 0;
  for (const c of plan.confirm) {
    const res = await db.loyaltyLedgerEntry.updateMany({
      where: { id: c.entryId, status: "pending" }, // conditional: a racing caller finds nothing
      data: {
        status: "confirmed",
        confirmedAt: c.confirmedAt,
        points: c.finalPoints,
        // `multiplierApplied` is deliberately NOT written. It was stamped when the order was
        // placed and is what this confirmation honoured; rewriting it here would imply the
        // rate is decided at confirmation, which is exactly the behaviour that let our own
        // seven-day hold demote a customer between delivery and payout.
        //
        // `expiresAt` is deliberately NOT written either. Expiry is a property of the account's activity
        // clock, not of an entry: a purchase in month eleven moves the whole balance's expiry, so
        // a per-entry date recorded at confirmation is wrong by month twelve and there is nothing
        // that reads it. A stale date on a customer-facing "your points expire on…" line is worse
        // than no date. The column stays because dropping it is a destructive migration.
      },
    });
    if (res.count > 0) confirmed++;
  }

  let expiredPoints = 0;
  for (const x of plan.expire) {
    try {
      await db.loyaltyLedgerEntry.create({
        data: {
          accountId,
          type: "expiry",
          status: "confirmed",
          points: -x.points,
          confirmedAt: x.dueAt,
          reason: x.reason,
          // Keyed on the due date, not on `now`: two callers arriving together compute the same
          // due date from the same ledger, so the second hits the unique index instead of
          // writing a second lapse and driving the balance negative.
          dedupeKey: `expiry:${accountId}:${x.dueAt.toISOString()}`,
        },
      });
      expiredPoints += x.points;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // already written by whoever got here first
    }
  }

  if (plan.tier.changed) {
    await db.loyaltyAccount.update({
      where: { id: accountId },
      data: { tier: plan.tier.tier, tierEarnedAt: plan.tier.earnedAt },
    });
  }

  // Conditional on the value we read, so a redemption that committed while this was running is
  // not clobbered by a figure computed before it. Losing the race just means the cache is
  // refreshed by the next reader; the ledger is the truth either way.
  if (loaded.balanceCached !== balance) {
    await db.loyaltyAccount.updateMany({
      where: { id: accountId, balanceCached: loaded.balanceCached },
      data: { balanceCached: balance },
    });
  }

  return { confirmed, expiredPoints, tierChanged: plan.tier.changed, balance };
}

// ───────────────────────────────────────────────────────────────── earning

/**
 * Record the points an order will earn, held pending until the COD hold elapses.
 *
 * Stores BASE points AND THE MULTIPLIER THE CUSTOMER WAS PROMISED, read from the tier they hold
 * right now. Confirmation honours that stamp rather than re-deriving a rate seven days later:
 * the hold is our mechanism, and a tier anniversary falling inside it must not quietly cost the
 * customer points on an order they placed at a better rate. It runs the other way too — an order
 * placed at Petal that matures after a promotion pays Petal's rate.
 *
 * Idempotent by database constraint: a second call for the same order hits the unique index on
 * `earnOrderId` and is swallowed, so a replayed status change or a double-submitted checkout
 * cannot grant twice.
 */
export async function recordEarn(
  db: Db,
  input: { accountId: number; orderId: number; merchandiseCents: number; now?: Date },
): Promise<{ created: boolean; basePoints: number; multiplier: number }> {
  if (!LOYALTY_ENABLED) return { created: false, basePoints: 0, multiplier: 1 };

  const basePoints = basePointsFor(input.merchandiseCents);
  if (basePoints <= 0) return { created: false, basePoints: 0, multiplier: 1 };

  const now = input.now ?? new Date();
  const loaded = await load(db, input.accountId, now);
  const multiplier = multiplierFor(loaded.state.tier);
  const promised = applyMultiplier(basePoints, multiplier);

  try {
    await db.loyaltyLedgerEntry.create({
      data: {
        accountId: input.accountId,
        orderId: input.orderId,
        earnOrderId: input.orderId, // the guard — see schema.prisma
        type: "earn",
        status: "pending",
        points: basePoints,
        multiplierApplied: new Prisma.Decimal(multiplier),
        reason: `Order earns ${promised} points once delivered`
          + (multiplier === 1 ? "" : ` (${basePoints} at ${multiplier}x, ${loaded.state.tier})`),
        createdAt: input.now,
      },
    });
    return { created: true, basePoints, multiplier };
  } catch (e) {
    if (isUniqueViolation(e)) return { created: false, basePoints, multiplier }; // already recorded
    throw e;
  }
}

/**
 * 100 points, once per account, ever.
 *
 * Guarded by the unique index rather than by a preceding read. The read-then-write version
 * granted twice under a double-submitted register form, because both requests looked before
 * either wrote.
 */
export async function recordSignupBonus(db: Db, accountId: number, now = new Date()) {
  if (!LOYALTY_ENABLED) return { created: false };
  return writeOnce(db, {
    accountId,
    dedupeKey: `signup:${accountId}`,
    points: RATES.signupBonusPoints,
    reason: SIGNUP_REASON,
    now,
  });
}

/**
 * 200 points, once per calendar year, and only inside the customer's stated birth month.
 *
 * `birthMonth` is passed in rather than read here because the rules own the decision and this
 * module owns the write. A caller with no birth month on file gets nothing — inventing a month
 * would grant a bonus on a date that means nothing to the customer.
 */
export async function recordBirthdayBonus(
  db: Db,
  input: { accountId: number; birthMonth: number | null; now?: Date },
) {
  if (!LOYALTY_ENABLED) return { created: false };
  const now = input.now ?? new Date();
  if (!input.birthMonth || input.birthMonth < 1 || input.birthMonth > 12) return { created: false };
  // Months are 1-12 in the schema and 0-11 from getMonth(). Without this the bonus lands a month
  // early, every year, for everybody.
  if (now.getMonth() + 1 !== input.birthMonth) return { created: false };

  return writeOnce(db, {
    accountId: input.accountId,
    dedupeKey: `birthday:${input.accountId}:${now.getFullYear()}`,
    points: RATES.birthdayBonusPoints,
    reason: `${BIRTHDAY_REASON} ${now.getFullYear()}`,
    now,
  });
}

/** Insert a confirmed entry that must exist at most once, letting Postgres do the deciding. */
async function writeOnce(
  db: Db,
  input: { accountId: number; dedupeKey: string; points: number; reason: string; now: Date },
): Promise<{ created: boolean }> {
  try {
    await db.loyaltyLedgerEntry.create({
      data: {
        accountId: input.accountId,
        type: "manualAdjustment",
        status: "confirmed",
        points: input.points,
        confirmedAt: input.now,
        reason: input.reason,
        dedupeKey: input.dedupeKey,
      },
    });
    return { created: true };
  } catch (e) {
    if (isUniqueViolation(e)) return { created: false };
    throw e;
  }
}

const SIGNUP_REASON = "Welcome bonus";
const BIRTHDAY_REASON = "Birthday bonus";

// ───────────────────────────────────────────────────────────────── voiding & reversing

/**
 * Re-price a still-pending earn after the order's merchandise value changed.
 *
 * Removing an unsourceable line recomputes subtotal, delivery, coupon and gift card on the
 * server. The earn was recorded at placement against the original basket, so without this the
 * customer earns on goods they never received.
 *
 * Only touches `pending` rows, and only downward-or-upward on BASE points — the multiplier
 * stamped at placement is untouched, because the rate they were promised has not changed, only
 * the amount they are buying. A confirmed earn is out of scope: it means the goods were
 * delivered and kept, and changing it is a reversal with a reason attached.
 */
export async function repricePendingEarn(
  db: Db,
  orderId: number,
  merchandiseCents: number,
): Promise<{ repriced: boolean; basePoints: number }> {
  const basePoints = basePointsFor(merchandiseCents);
  const existing = await db.loyaltyLedgerEntry.findFirst({
    where: { orderId, type: "earn", status: "pending" },
    select: { id: true, points: true, multiplierApplied: true },
  });
  if (!existing || existing.points === basePoints) return { repriced: false, basePoints };

  const multiplier = existing.multiplierApplied === null ? 1 : Number(existing.multiplierApplied);
  const promised = applyMultiplier(basePoints, multiplier);

  if (basePoints <= 0) {
    // The order is now worth no points at all. Void rather than leaving a zero-point row, so the
    // ledger reads as "this earns nothing" rather than "this earns, but nothing".
    await db.loyaltyLedgerEntry.updateMany({
      where: { id: existing.id, status: "pending" },
      data: { status: "void", reason: "Order value fell to nothing after an item was removed" },
    });
    return { repriced: true, basePoints: 0 };
  }

  await db.loyaltyLedgerEntry.updateMany({
    where: { id: existing.id, status: "pending" }, // conditional: never re-price a confirmed earn
    data: {
      points: basePoints,
      reason: `Order earns ${promised} points once delivered (re-priced after an item was removed)`,
    },
  });
  return { repriced: true, basePoints };
}

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
 * making the judgement by hand has one correct implementation to call.
 *
 * Keyed on (order, portion), so a retried request or a double-clicked button reverses once. A
 * genuine second reversal of the same order at the same portion is not expressible, and should
 * not be — that is what `manualAdjustment` is for, with a reason attached.
 */
export async function reverseEarn(
  db: Db,
  input: { orderId: number; portion?: number; reason: string; enteredBy?: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const portion = Math.min(1, Math.max(0, input.portion ?? 1));

  const earns = await db.loyaltyLedgerEntry.findMany({
    where: { orderId: input.orderId, type: "earn", status: "confirmed" },
    orderBy: { id: "asc" },
  });
  if (earns.length === 0) return { reversed: 0, points: 0 };

  let total = 0;
  let reversed = 0;
  for (const e of earns) {
    // Rounded so the customer keeps the fraction rather than the shop.
    const take = Math.floor(e.points * portion);
    if (take <= 0) continue;
    try {
      await db.loyaltyLedgerEntry.create({
        data: {
          accountId: e.accountId, orderId: input.orderId,
          type: "reversal", status: "confirmed",
          points: -take, confirmedAt: now,
          reason: input.reason, createdBy: input.enteredBy ?? "",
          dedupeKey: `reversal:${e.id}:${portion}`,
        },
      });
      total += take;
      reversed++;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // already clawed back
    }
  }
  return { reversed, points: total };
}

/**
 * Give back points spent on an order that was cancelled or refused.
 *
 * The old version read for an existing reversal and then wrote, which restored twice when a
 * status change double-fired. The key does the deciding now.
 */
export async function reverseRedemption(db: Db, orderId: number, reason: string, now = new Date()) {
  const spends = await db.loyaltyLedgerEntry.findMany({
    where: { orderId, type: "redeem" },
    orderBy: { id: "asc" },
  });
  if (spends.length === 0) return { restored: 0 };

  let restored = 0;
  for (const s of spends) {
    try {
      await db.loyaltyLedgerEntry.create({
        data: {
          accountId: s.accountId, orderId,
          type: "redemptionReversal", status: "confirmed",
          points: Math.abs(s.points), confirmedAt: now, reason,
          dedupeKey: `redemption-reversal:${s.id}`,
        },
      });
      restored += Math.abs(s.points);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return { restored };
}

// ───────────────────────────────────────────────────────────────── redeeming

/** Points already taken off this order, in cents. The 50% cap is a property of the ORDER. */
async function redeemedCentsOnOrder(db: Db, orderId: number): Promise<number> {
  const rows = await db.loyaltyLedgerEntry.findMany({
    where: { orderId, type: "redeem", status: { not: "void" } },
    select: { points: true },
  });
  const reversals = await db.loyaltyLedgerEntry.findMany({
    where: { orderId, type: "redemptionReversal", status: { not: "void" } },
    select: { points: true },
  });
  const spent = rows.reduce((n, r) => n + Math.abs(r.points), 0);
  const back = reversals.reduce((n, r) => n + Math.abs(r.points), 0);
  return pointsToCents(Math.max(0, spent - back));
}

/**
 * Spend points as part of a LARGER transaction — specifically, the one that creates the order.
 *
 * ── WHY THIS EXISTS ALONGSIDE `redeem()` ───────────────────────────────────────────
 *
 * `redeem()` opens its own SERIALIZABLE transaction, which is right when redemption is the whole
 * operation. It is wrong at checkout: the points discount and the order have to land together or
 * not at all. Writing the order first and the ledger entry after leaves an order discounted by
 * points nobody paid; writing the ledger entry first and failing the order leaves points spent on
 * an order that does not exist.
 *
 * So this takes the caller's `tx` and does its work inside it. THE CALLER IS RESPONSIBLE FOR THE
 * ISOLATION LEVEL — `POST /api/orders` raises its transaction to Serializable when, and only
 * when, points are being spent, so a checkout that redeems nothing is completely unaffected.
 * Read-committed here would let two checkout tabs both read the same balance and both spend it,
 * which is exactly how this codebase once gave away $50 twice from one gift card.
 *
 * Returns 0 when the programme or redemption is off, so the caller needs no flag check.
 */
export async function redeemWithin(
  tx: Prisma.TransactionClient,
  input: {
    accountId: number;
    orderId: number;
    requestedPoints: number;
    merchandiseCents: number;
    signedIn: boolean;
    now?: Date;
  },
): Promise<{ points: number; cents: number }> {
  if (!LOYALTY_REDEMPTION_ENABLED || input.requestedPoints <= 0) return { points: 0, cents: 0 };
  if (!isMoney(input.merchandiseCents)) {
    throw new LoyaltyError("Basket total is not a whole number of cents.", "bad-input");
  }

  const now = input.now ?? new Date();
  const loaded = await load(tx, input.accountId, now);
  const already = await redeemedCentsOnOrder(tx, input.orderId);

  const quote = quoteRedemption({
    requestedPoints: input.requestedPoints,
    balance: loaded.state.balance,
    merchandiseCents: input.merchandiseCents,
    alreadyRedeemedCentsOnOrder: already,
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
      // One redemption row per order at checkout. A retried checkout that somehow reached here
      // twice with the same order hits the index rather than spending twice.
      dedupeKey: `checkout-redeem:${input.orderId}`,
    },
  });

  await tx.loyaltyAccount.update({
    where: { id: input.accountId },
    data: { balanceCached: loaded.state.balance - quote.points },
  });

  return { points: quote.points, cents: quote.cents };
}

/** What may be redeemed, without writing anything. Safe for a preview endpoint. */
export async function previewRedemption(
  db: Db,
  input: { accountId: number; orderId?: number; requestedPoints: number; merchandiseCents: number; signedIn: boolean; now?: Date },
): Promise<RedemptionQuote> {
  const now = input.now ?? new Date();
  const loaded = await load(db, input.accountId, now);
  const already = input.orderId ? await redeemedCentsOnOrder(db, input.orderId) : 0;
  return quoteRedemption({
    requestedPoints: input.requestedPoints,
    balance: loaded.state.balance,
    merchandiseCents: input.merchandiseCents,
    alreadyRedeemedCentsOnOrder: already,
    redemptionEnabled: LOYALTY_REDEMPTION_ENABLED,
    signedIn: input.signedIn,
    refusalCount: loaded.refusalCount,
  });
}

/**
 * Spend points on an order.
 *
 * Runs SERIALIZABLE and re-reads BOTH the balance and what this order has already had redeemed
 * against it inside the transaction. Reading either before opening the transaction and trusting
 * it is the obvious exploit, and it is the one that gets found: the cap used to be evaluated per
 * call, so two redemptions of $30 landed on one $60 basket and covered all of it.
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
  if (!isMoney(input.merchandiseCents)) {
    throw new LoyaltyError("Basket total is not a whole number of cents.", "bad-input");
  }

  // Serialisable transactions abort under conflict, and the sweep touching the same account is
  // enough to cause one. Retry the REDEMPTION, never the sweep: the sweep is idempotent and
  // rerunnable by design and nobody is waiting on it, whereas there is a customer at checkout
  // watching this. Bounded so it cannot spin, and jittered so two tabs that collided once do
  // not collide again in lockstep.
  let lastConflict: unknown = null;
  for (let attempt = 0; attempt < REDEEM_ATTEMPTS; attempt++) {
    try {
      return await redeemOnce(db, input);
    } catch (e) {
      if (!isSerialisationFailure(e)) throw e; // a real refusal — do not paper over it
      lastConflict = e;
      const backoff = 25 * 2 ** attempt + Math.floor(Math.random() * 50);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  // Out of attempts. A clean, actionable refusal — NOT a 500. The customer did nothing wrong and
  // "try again" is genuinely the right advice, because the next attempt almost certainly wins.
  console.error(`[loyalty] redeem gave up after ${REDEEM_ATTEMPTS} serialisation conflicts:`, lastConflict);
  throw new LoyaltyError("Your points could not be applied just now. Please try again.", "busy");
}

/** Attempts before giving up. Three is enough that losing all of them means something is wrong. */
const REDEEM_ATTEMPTS = 3;

/**
 * Postgres serialisation failure (SQLSTATE 40001) or deadlock (40P01), as Prisma reports them.
 *
 * P2034 is Prisma's own "write conflict or deadlock" code. The raw SQLSTATE is checked too
 * because it arrives that way through some driver paths, and a conflict misread as a real error
 * would be shown to the customer as a permanent failure when a retry would have worked.
 */
export function isSerialisationFailure(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2034") return true;
    const meta = e.meta as { code?: string } | undefined;
    if (meta?.code === "40001" || meta?.code === "40P01") return true;
  }
  const message = e instanceof Error ? e.message : String(e);
  return /40001|40P01|could not serialize|deadlock detected/i.test(message);
}

async function redeemOnce(
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
      const already = await redeemedCentsOnOrder(tx, input.orderId);
      const quote = quoteRedemption({
        requestedPoints: input.requestedPoints,
        balance: loaded.state.balance,
        merchandiseCents: input.merchandiseCents,
        alreadyRedeemedCentsOnOrder: already,
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

      // Written inside the same transaction so a concurrent reader never sees a balance that has
      // not had this redemption taken off it.
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
 * NOTE FOR WHOEVER READS THIS NEXT: the moment a second person has admin access, real per-admin
 * identity stops being optional.
 *
 * ── `orderId`: crediting an order by hand ──────────────────────────────────────────
 *
 * Optional, and it does two things beyond the audit trail. It records WHICH order the correction
 * was for, and it CLAIMS that order's credit slot by taking `earnOrderId` — so a later
 * `recordEarn` for the same order hits the unique index and is swallowed instead of paying a
 * second time.
 *
 * That matters for orders placed by signed-in customers while the flag was off. Those have no
 * ledger row and cannot be reached by guest back-fill, which only looks at orders with no
 * customer attached. Crediting them by hand is the interim, and without the claim the interim
 * would quietly double-pay the day a back-fill script ran.
 *
 * The adjustment still does NOT count toward tier spend: only `earn` entries do, so a correction
 * moves the balance without silently buying a tier the customer did not spend their way into.
 */
export async function manualAdjustment(
  db: Db,
  input: { accountId: number; points: number; reason: string; enteredBy: string; orderId?: number; now?: Date },
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

  try {
    const entry = await db.loyaltyLedgerEntry.create({
      data: {
        accountId: input.accountId,
        type: "manualAdjustment",
        status: "confirmed",
        points: input.points,
        confirmedAt: input.now ?? new Date(),
        reason,
        createdBy: enteredBy,
        orderId: input.orderId ?? null,
        // Only when crediting a specific order, and only for a credit — a deduction is not a
        // payout and must not block the order from earning normally later.
        earnOrderId: input.orderId && input.points > 0 ? input.orderId : null,
      },
    });
    return { id: entry.id };
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new LoyaltyError(
        "This order has already been credited — adjust without an order reference, or reverse the existing entry first.",
        "order-already-credited",
      );
    }
    throw e;
  }
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
 * DERIVED, not a queue table. A pending claim is simply a match with no decision recorded against
 * it, so there is no second copy of the truth to fall out of step.
 *
 * A match is a CANDIDATE, never an approval. Anyone can type a stranger's number at checkout, so
 * the phone proves nothing on its own — an admin decides, which is the same gate that now governs
 * linking a login to an account.
 *
 * Deliberately does NOT touch Order.customerId. Attaching a past guest order to an account changes
 * what appears in that customer's order history — addresses, items, everything — which is an
 * orders-domain decision with its own privacy weight, not something loyalty should do as a side
 * effect. Approving a claim writes ledger entries and nothing else.
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

/**
 * Run `attempt` until it succeeds or stops failing for a reason worth retrying.
 *
 * Returns the value, or `null` if every attempt hit a serialisation conflict. Anything that is
 * not a conflict is rethrown immediately — a retry loop that swallows real errors is worse than
 * no retry loop, because it turns one loud failure into several quiet ones.
 *
 * This lives here, exported and tested, rather than inline in the checkout handler where it
 * started. The bug it fixes — a Serializable transaction with no retry, so a conflict that is
 * nobody's fault loses the whole order — survived review precisely because it was five lines
 * buried in a two-thousand-line file with no way to exercise them.
 *
 * The caller decides what `null` means. Checkout retries once more with points switched off,
 * because an order at full price beats no order; the sweep just gives up, because it runs again.
 */
export async function withSerialisationRetry<T>(
  attempt: () => Promise<T>,
  opts: { attempts?: number; delayMs?: (n: number) => number } = {},
): Promise<{ value: T; conflicts: number } | { value: null; conflicts: number; lastError: unknown }> {
  const attempts = opts.attempts ?? REDEEM_ATTEMPTS;
  // Exponential with jitter. Without the jitter two transactions that collided once back off by
  // the same amount and collide again on the same schedule.
  const delayFor = opts.delayMs ?? ((n: number) => 25 * 2 ** n + Math.floor(Math.random() * 50));

  let lastError: unknown = null;
  for (let n = 0; n < attempts; n++) {
    try {
      return { value: await attempt(), conflicts: n };
    } catch (e) {
      if (!isSerialisationFailure(e)) throw e;
      lastError = e;
      // No sleep after the final attempt — nothing is waiting for it.
      if (n < attempts - 1) await new Promise((r) => setTimeout(r, delayFor(n)));
    }
  }
  return { value: null, conflicts: attempts, lastError };
}
