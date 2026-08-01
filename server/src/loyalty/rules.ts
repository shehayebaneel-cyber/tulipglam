/**
 * The loyalty rules, as pure functions.
 *
 * No database, no clock, no config beyond `config.ts`. Every function takes plain data and
 * returns plain data, so the arithmetic that decides what a customer is owed can be tested
 * exhaustively without a fixture, a transaction or a server.
 *
 * `ledger.ts` is the only module that talks to the database; it fetches rows, hands them here,
 * and writes back what these functions decide. Keeping the two apart is what makes the money
 * math cheap to argue about.
 *
 * ── The one idea that shapes everything ────────────────────────────────────────────
 * Render's free tier sleeps, so no scheduled job can be relied on to have run. Nothing here
 * may therefore depend on a job having happened. Spendability, tier and expiry are all
 * DERIVED from the ledger and the orders behind it at read time; the stored `status` column is
 * a cache that converges opportunistically. A balance is correct on a server that has been
 * asleep for a month.
 */
import { RATES, TIERS, type TierKey, type EntryStatus, type EntryType } from "./config.js";

// ───────────────────────────────────────────────────────────────── time

/** Whole months added to a date, clamped so 31 Jan + 1 month is 28/29 Feb rather than 2 March. */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const targetMonth = d.getMonth() + months;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(targetMonth);
  const lastDayOfTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfTargetMonth));
  return d;
}

export const addDays = (from: Date, days: number): Date =>
  new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

// ───────────────────────────────────────────────────────────────── earning

/**
 * The merchandise value an order earns on: after every discount, before delivery.
 *
 * Delivery never earns — a customer in a far governorate would otherwise earn more for the same
 * basket. Both discounts come off, coupon and points alike, because points are earned on what
 * was actually paid for goods; leaving the points discount in would let someone farm points by
 * redeeming and re-earning on the same money.
 *
 * A gift card is NOT deducted. It is a means of payment, not a reduction in the price of the
 * goods — the merchandise was still bought at full value.
 */
export function merchandiseCentsOf(order: {
  subtotalCents: number;
  discountCents: number;
  pointsDiscountCents: number;
}): number {
  return Math.max(0, order.subtotalCents - order.discountCents - order.pointsDiscountCents);
}

/** Base points before any tier multiplier. 1 point per $1, rounded DOWN — never a fraction. */
export function basePointsFor(merchandiseCents: number): number {
  if (!Number.isFinite(merchandiseCents) || merchandiseCents <= 0) return 0;
  return Math.floor(merchandiseCents / RATES.centsPerPoint);
}

/**
 * Base points with the tier multiplier applied, rounded DOWN.
 *
 * Applied at CONFIRMATION, not at placement — which is why a pending entry holds base points and
 * is revised upward when it confirms. Rounding down at this final step, rather than rounding the
 * multiplier, keeps the result a whole number without ever paying out a fraction.
 */
export function applyMultiplier(basePoints: number, multiplier: number): number {
  if (basePoints <= 0) return 0;
  return Math.floor(basePoints * multiplier);
}

// ───────────────────────────────────────────────────────────────── tiers

/** The tier a given trailing-window spend qualifies for. */
export function tierForSpend(spendCents: number): TierKey {
  let earned: TierKey = TIERS[0].key;
  for (const t of TIERS) if (spendCents >= t.thresholdCents) earned = t.key;
  return earned;
}

export const tierRule = (key: TierKey) => TIERS.find((t) => t.key === key) ?? TIERS[0];
export const multiplierFor = (key: TierKey): number => tierRule(key).multiplier;
export const tierRank = (key: TierKey): number => TIERS.findIndex((t) => t.key === key);

/**
 * The tier in force, given what was qualified for and what is currently held.
 *
 * Upgrades take effect immediately. Demotion happens ONLY at the anniversary of the held tier,
 * so a customer who qualified for Bloom keeps it for a full twelve months even if they buy
 * nothing else — and is never quietly downgraded mid-cycle for a slow quarter.
 */
export function effectiveTier(
  qualifiedFor: TierKey,
  held: { tier: TierKey; earnedAt: Date },
  now: Date,
): { tier: TierKey; earnedAt: Date; changed: boolean } {
  if (tierRank(qualifiedFor) > tierRank(held.tier)) {
    return { tier: qualifiedFor, earnedAt: now, changed: true };
  }
  const anniversary = addMonths(held.earnedAt, RATES.tierHoldMonths);
  if (now >= anniversary && tierRank(qualifiedFor) < tierRank(held.tier)) {
    // The hold has run out and they no longer qualify. Drop to what they do qualify for, and
    // restart the clock so the new tier is itself held for a full cycle.
    return { tier: qualifiedFor, earnedAt: now, changed: true };
  }
  return { tier: held.tier, earnedAt: held.earnedAt, changed: false };
}

// ───────────────────────────────────────────────────────────────── the COD hold

/** Just enough of an order for the rules to reason about it. */
export type OrderFacts = {
  id: number;
  status: string;
  deliveredAt: Date | null;
};

/**
 * When a pending earn on this order becomes spendable, or null if it never will (yet).
 *
 * The whole no-cron design rests here: this is a comparison against a stored timestamp, so it
 * gives the same answer whether or not any job has ever run.
 */
export function maturesAt(order: OrderFacts | null | undefined): Date | null {
  if (!order?.deliveredAt) return null;
  return addDays(order.deliveredAt, RATES.holdDaysAfterDelivery);
}

/** Has the hold elapsed? */
export function isMature(order: OrderFacts | null | undefined, now: Date): boolean {
  const at = maturesAt(order);
  return at !== null && now >= at;
}

// ───────────────────────────────────────────────────────────────── balance

export type LedgerFacts = {
  id: number;
  type: EntryType;
  status: EntryStatus;
  points: number;
  orderId: number | null;
  createdAt: Date;
  confirmedAt: Date | null;
};

export type AccountState = {
  /** Spendable now: confirmed (or confirmable) and not expired. May be NEGATIVE. */
  balance: number;
  /** Earned but still inside the COD hold, or on an order not yet delivered. */
  pending: number;
  /** Entries that are pending in the database but have in fact matured. */
  readyToConfirm: LedgerFacts[];
  /**
   * Merchandise spend inside the tier window counting confirmed AND matured-but-unconfirmed
   * earns — what the customer's tier progress bar should show, since a matured earn is already
   * spendable and it would be odd for it not to count toward status.
   */
  windowSpendCents: number;
  /**
   * The same window, but counting ONLY entries already confirmed.
   *
   * This is what decides the multiplier when confirming an entry, and the distinction is not
   * cosmetic. Using the figure above would let an entry's own spend — and the spend of every
   * other entry maturing in the same batch — count toward the tier that multiplies it, so a
   * single large order would push the customer to Bloom and then pay itself 1.25x. Points
   * confirmed at Petal must not be retroactively re-multiplied.
   */
  confirmedSpendCents: number;
  /** When the whole confirmed balance lapses, or null if there is nothing to lose. */
  expiresAt: Date | null;
  /** True when the expiry date has already passed and an expiry entry is owed. */
  hasLapsed: boolean;
  /** Most recent confirmed earn or redemption — the thing the expiry clock runs from. */
  lastActivityAt: Date | null;
};

/**
 * Everything about an account, derived from its ledger.
 *
 * `orders` supplies the delivery facts for entries that reference one. An entry whose order is
 * missing from the map is treated as not yet mature, which fails safe: worst case a customer
 * waits, rather than spending points on goods they refused.
 */
export function computeState(
  entries: readonly LedgerFacts[],
  orders: ReadonlyMap<number, OrderFacts>,
  merchandiseByOrder: ReadonlyMap<number, number>,
  now: Date,
): AccountState {
  const readyToConfirm: LedgerFacts[] = [];
  let balance = 0;
  let pending = 0;
  let lastActivityAt: Date | null = null;

  const noteActivity = (at: Date | null) => {
    if (at && (!lastActivityAt || at > lastActivityAt)) lastActivityAt = at;
  };

  for (const e of entries) {
    if (e.status === "void") continue;

    if (e.status === "confirmed") {
      balance += e.points;
      // The expiry clock runs from confirmed EARNS and REDEMPTIONS only. Expiry itself must not
      // reset it, or points could never lapse; a reversal is not the customer doing anything.
      if (e.type === "earn" || e.type === "redeem") noteActivity(e.confirmedAt ?? e.createdAt);
      continue;
    }

    // Pending. Anything that is not an earn is immediate by nature — a redemption is spent the
    // moment it is made, and a manual adjustment is a decision already taken — so only earns
    // can legitimately sit pending, waiting on a delivery.
    if (e.type !== "earn") {
      balance += e.points;
      if (e.type === "redeem") noteActivity(e.createdAt);
      continue;
    }

    const order = e.orderId === null ? null : orders.get(e.orderId);
    if (isMature(order, now)) {
      readyToConfirm.push(e);
      // Counted as spendable immediately: the hold has objectively elapsed, and making the
      // customer wait for a database write they cannot see would be the scheduler dependency
      // this design exists to avoid.
      balance += e.points;
      noteActivity(maturesAt(order));
    } else {
      pending += e.points;
    }
  }

  // Tier spend over the trailing window, counted two ways — see the field docs above for why
  // the difference matters.
  const windowStart = addMonths(now, -RATES.tierWindowMonths);
  let windowSpendCents = 0;
  let confirmedSpendCents = 0;
  for (const e of entries) {
    if (e.type !== "earn" || e.status === "void" || e.orderId === null) continue;
    const mature = isMature(orders.get(e.orderId), now);
    if (e.status !== "confirmed" && !mature) continue;
    const at = e.confirmedAt ?? maturesAt(orders.get(e.orderId)) ?? e.createdAt;
    if (at < windowStart) continue;
    const cents = merchandiseByOrder.get(e.orderId) ?? 0;
    windowSpendCents += cents;
    if (e.status === "confirmed") confirmedSpendCents += cents;
  }

  const expiresAt = lastActivityAt ? addMonths(lastActivityAt, RATES.expiryMonths) : null;
  const hasLapsed = expiresAt !== null && now >= expiresAt && balance > 0;

  return { balance, pending, readyToConfirm, windowSpendCents, confirmedSpendCents, expiresAt, hasLapsed, lastActivityAt };
}

// ───────────────────────────────────────────────────────────────── redeeming

export const pointsToCents = (points: number): number =>
  Math.floor(points / RATES.redeemBlockPoints) * RATES.redeemBlockCents;

/** Round down to a whole redeemable block. */
export const toBlocks = (points: number): number =>
  Math.max(0, Math.floor(points / RATES.redeemBlockPoints) * RATES.redeemBlockPoints);

export type RedemptionQuote =
  | { ok: true; points: number; cents: number; maxPoints: number }
  | { ok: false; reason: RedemptionRefusal; detail: string; maxPoints: number };

export type RedemptionRefusal =
  | "disabled"
  | "not-signed-in"
  | "negative-balance"
  | "blocked-refusals"
  | "below-minimum"
  | "not-a-block"
  | "insufficient-balance"
  | "over-cap";

/**
 * What a customer may redeem against a basket, and why not if they may not.
 *
 * The server recomputes this from the ledger on every request — a redemption amount arriving
 * from a browser is never trusted, since the cap depends on a basket the client can change
 * after the quote was issued.
 */
export function quoteRedemption(input: {
  requestedPoints: number;
  balance: number;
  merchandiseCents: number;
  redemptionEnabled: boolean;
  signedIn: boolean;
  refusalCount: number;
}): RedemptionQuote {
  const capCents = Math.floor(input.merchandiseCents * RATES.redeemMaxShareOfMerchandise);
  const capPoints = toBlocks((capCents / RATES.redeemBlockCents) * RATES.redeemBlockPoints);
  const maxPoints = Math.max(0, Math.min(toBlocks(input.balance), capPoints));

  const no = (reason: RedemptionRefusal, detail: string): RedemptionQuote =>
    ({ ok: false, reason, detail, maxPoints });

  if (!input.redemptionEnabled) return no("disabled", "Redeeming points is not switched on yet.");
  // Requiring a signed-in customer replaces the one-time code the brief asked for: there is no
  // SMS provider and SMTP is unconfigured, so no code could actually be delivered. Nobody
  // spends points without authenticating either way.
  if (!input.signedIn) return no("not-signed-in", "Sign in to spend your points.");
  if (input.balance < 0) {
    // Reversals can legitimately push a balance below zero. Blocking here, rather than clamping
    // the balance at zero, is what stops someone redeeming, returning the goods and keeping the
    // discount — future earnings pay the debt back first.
    return no("negative-balance", "This account has a negative balance. Earn it back before redeeming.");
  }
  if (input.refusalCount >= RATES.refusalStrikeLimit) {
    return no("blocked-refusals", `${input.refusalCount} refused deliveries — redemption is paused pending review.`);
  }

  const requested = input.requestedPoints;
  if (requested % RATES.redeemBlockPoints !== 0) {
    return no("not-a-block", `Points are redeemed in blocks of ${RATES.redeemBlockPoints}.`);
  }
  if (requested < RATES.redeemMinimumPoints) {
    return no("below-minimum", `The minimum redemption is ${RATES.redeemMinimumPoints} points.`);
  }
  if (requested > input.balance) return no("insufficient-balance", "Not enough points.");
  if (requested > capPoints) {
    return no("over-cap", `Points may cover at most ${RATES.redeemMaxShareOfMerchandise * 100}% of the items.`);
  }

  return { ok: true, points: requested, cents: pointsToCents(requested), maxPoints };
}
