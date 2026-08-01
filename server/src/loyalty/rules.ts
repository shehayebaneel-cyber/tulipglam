/**
 * The loyalty rules, as pure functions.
 *
 * No database, no clock, no config beyond `config.ts`. Every function takes plain data and
 * returns plain data, so the arithmetic that decides what a customer is owed can be tested
 * exhaustively without a fixture, a transaction or a server.
 *
 * ── THE ONE IDEA THAT SHAPES EVERYTHING ────────────────────────────────────────────
 *
 * Render's free tier sleeps, so no scheduled job can be relied on to have run. Nothing here may
 * therefore depend on a job having happened. Spendability, the tier multiplier and expiry are all
 * DERIVED at read time; the stored columns are a cache that converges opportunistically.
 *
 * ── WHY THIS FILE DECIDES AND `ledger.ts` ONLY WRITES ──────────────────────────────
 *
 * The first version of this design had the arithmetic in two places: `computeState` derived a
 * balance for reading, and `materialise()` independently recomputed the same figures for writing.
 * They drifted, exactly as two copies of one calculation always do, and the drift was invisible
 * because each side was self-consistent:
 *
 *   - expiry was computed here and applied only there, so expired points stayed spendable
 *     forever on a server where the sweep never ran — which is every server, by design;
 *   - the tier multiplier was applied only there, so a Bouquet customer's matured order was
 *     worth 600 points on the read path and 900 on the write path.
 *
 * Both were real, both were live, and neither was found by a test, because the tests exercised
 * the two paths separately and each behaved consistently with itself.
 *
 * So `computeState` now returns a PLAN as well as a state: the exact rows `materialise()` must
 * write to make the database agree with what has already been reported. `materialise()` executes
 * that plan and computes nothing. There is one implementation of the arithmetic, the read path
 * is that implementation, and "the balance is correct even if the sweep never runs" is true by
 * construction rather than by two pieces of code happening to agree.
 *
 * If you are about to add a calculation to `ledger.ts`: it belongs here instead.
 */
import { RATES, TIERS, type TierKey, type EntryStatus, type EntryType } from "./config.js";

// ───────────────────────────────────────────────────────────────── money

/**
 * Money is a whole number of cents. Anything else is refused rather than coerced.
 *
 * `Number(req.body.x)` on a missing field yields NaN, and NaN poisons silently: every comparison
 * against it is false, so a cap expressed as `requested > cap` stops rejecting anything. That was
 * a live hole — a NaN basket let 100,000 points ($3,000) through a 50%-of-basket cap. Rejecting
 * at the boundary is the second line of defence; this is the first.
 */
export function parseCents(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null; // no decimals, no exponents, no "1e3", no ""
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

/** Cents that must be present and non-negative — a basket, a subtotal, a discount. */
export const isMoney = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

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
  if (!isMoney(order.subtotalCents) || !isMoney(order.discountCents) || !isMoney(order.pointsDiscountCents)) {
    return 0; // a malformed order earns nothing rather than earning NaN
  }
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
  at: Date,
): { tier: TierKey; earnedAt: Date; changed: boolean } {
  if (tierRank(qualifiedFor) > tierRank(held.tier)) {
    return { tier: qualifiedFor, earnedAt: at, changed: true };
  }
  const anniversary = addMonths(held.earnedAt, RATES.tierHoldMonths);
  if (at >= anniversary && tierRank(qualifiedFor) < tierRank(held.tier)) {
    // The hold has run out and they no longer qualify. Drop to what they do qualify for, and
    // restart the clock so the new tier is itself held for a full cycle.
    return { tier: qualifiedFor, earnedAt: at, changed: true };
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

// ───────────────────────────────────────────────────────────────── state

export type LedgerFacts = {
  id: number;
  type: EntryType;
  status: EntryStatus;
  points: number;
  orderId: number | null;
  createdAt: Date;
  confirmedAt: Date | null;
  /**
   * The tier multiplier this earn was PROMISED, stamped when the order was placed.
   *
   * Not recomputed at maturity. The COD hold is our mechanism — seven days between delivery and
   * the points becoming spendable — and it must not cost the customer anything. A customer who
   * ordered at Bloom was shown Bloom's rate; if their tier anniversary happens to fall in that
   * gap, the demotion is our clock firing, not a change in what they were promised.
   *
   * The same principle runs the other way: an order placed at Petal that matures after a
   * promotion pays Petal's rate. The rate you see when you order is the rate you get, in both
   * directions. It also means an order can never buy the tier that pays it, since the tier is
   * read before the order exists.
   */
  multiplierApplied: number;
};

/** One row `materialise()` must update to make the database say what has already been reported. */
export type ConfirmPlan = {
  entryId: number;
  basePoints: number;
  /** After the tier multiplier — the figure the read path has ALREADY counted as spendable. */
  finalPoints: number;
  /** Read off the entry, stamped at placement. Never recomputed here — see `LedgerFacts`. */
  multiplier: number;
  /**
   * The maturity date, NOT the moment materialise happens to run.
   *
   * Stamping `now` would mean the act of reading an account changed its expiry clock, so the
   * same account gave different answers depending on whether a sweep had touched it — the
   * scheduler dependency this design exists to avoid, reintroduced through the back door.
   */
  confirmedAt: Date;
};

/** A whole-balance lapse that has already been applied to the derived balance. */
export type ExpiryPlan = {
  /** Positive magnitude; the entry written is negative. */
  points: number;
  dueAt: Date;
  reason: string;
};

export type MaterialisePlan = {
  confirm: ConfirmPlan[];
  expire: ExpiryPlan[];
  tier: { tier: TierKey; earnedAt: Date; changed: boolean };
};

export type AccountState = {
  /** Spendable now: confirmed, multiplied, and not expired. May be NEGATIVE. */
  balance: number;
  /** Earned but still inside the COD hold, or on an order not yet delivered. Base points. */
  pending: number;
  /** Merchandise spend inside the trailing tier window, NET of reversals. */
  windowSpendCents: number;
  /** The tier that spend qualifies for, before the twelve-month hold is applied. */
  qualifiesFor: TierKey;
  /** The tier actually in force, hold rule applied. This is the customer-facing answer. */
  tier: TierKey;
  tierEarnedAt: Date;
  /** When the current balance lapses, or null if there is nothing to lose. */
  expiresAt: Date | null;
  /** True when a lapse has already been applied to `balance` above. */
  hasLapsed: boolean;
  /** Most recent confirmed earn or redemption — the thing the expiry clock runs from. */
  lastActivityAt: Date | null;
  /** Exactly what `materialise()` must write. It decides nothing itself. */
  plan: MaterialisePlan;
};

type LiveEntry = {
  id: number;
  type: EntryType;
  /** The points that count toward the balance — multiplied, for entries the plan will confirm. */
  points: number;
  /** When this entry takes effect. Drives both the expiry clock and lapse eligibility. */
  at: Date;
  /** Does this reset the expiry clock? Confirmed earns and redemptions only. */
  isActivity: boolean;
};

/**
 * Everything about an account, derived from its ledger — and the plan to write it down.
 *
 * `orders` supplies the delivery facts for entries that reference one. An entry whose order is
 * missing from the map is treated as not yet mature, which fails safe: worst case a customer
 * waits, rather than spending points on goods they refused.
 *
 * `held` is the tier currently stored on the account, which the hold rule needs; pass the
 * schema defaults for a fresh account.
 */
export function computeState(
  entries: readonly LedgerFacts[],
  orders: ReadonlyMap<number, OrderFacts>,
  merchandiseByOrder: ReadonlyMap<number, number>,
  held: { tier: TierKey; earnedAt: Date },
  now: Date,
): AccountState {
  // ── merchandise per order, net of anything reversed ──────────────────────────────
  //
  // A returned order must stop counting toward tier progress. Clawing the points back while
  // leaving the spend in place let a customer buy $600, return the lot, and keep Bouquet — free
  // delivery and 1.5x — for a full twelve months.
  const earnedPointsByOrder = new Map<number, number>();
  const reversedPointsByOrder = new Map<number, number>();
  for (const e of entries) {
    if (e.orderId === null || e.status === "void") continue;
    if (e.type === "earn") {
      earnedPointsByOrder.set(e.orderId, (earnedPointsByOrder.get(e.orderId) ?? 0) + e.points);
    } else if (e.type === "reversal") {
      reversedPointsByOrder.set(e.orderId, (reversedPointsByOrder.get(e.orderId) ?? 0) + Math.abs(e.points));
    }
  }
  const countedMerchandise = (orderId: number): number => {
    const gross = merchandiseByOrder.get(orderId) ?? 0;
    const earned = earnedPointsByOrder.get(orderId) ?? 0;
    const reversed = reversedPointsByOrder.get(orderId) ?? 0;
    if (earned <= 0 || reversed <= 0) return gross;
    const kept = Math.max(0, 1 - reversed / earned); // proportional, so partial returns work
    return Math.floor(gross * kept);
  };

  // ── split the ledger ─────────────────────────────────────────────────────────────
  const live: LiveEntry[] = [];
  const toConfirm: { entry: LedgerFacts; maturity: Date }[] = [];
  let pending = 0;

  for (const e of entries) {
    if (e.status === "void") continue;

    if (e.status === "confirmed") {
      live.push({
        id: e.id,
        type: e.type,
        points: e.points,
        at: e.confirmedAt ?? e.createdAt,
        // Expiry itself must not reset the clock, or points could never lapse; a reversal is not
        // the customer doing anything.
        isActivity: e.type === "earn" || e.type === "redeem",
      });
      continue;
    }

    // Pending. Anything that is not an earn is immediate by nature — a redemption is spent the
    // moment it is made, and a manual adjustment is a decision already taken — so only earns can
    // legitimately sit pending, waiting on a delivery.
    if (e.type !== "earn") {
      live.push({ id: e.id, type: e.type, points: e.points, at: e.createdAt, isActivity: e.type === "redeem" });
      continue;
    }

    const order = e.orderId === null ? null : orders.get(e.orderId);
    const maturity = maturesAt(order);
    if (maturity !== null && now >= maturity) {
      toConfirm.push({ entry: e, maturity });
    } else {
      // Multiplied, so the pending figure a customer is shown is the figure that eventually
      // confirms. Showing base points here and a larger number a week later reads as a bug to
      // whoever is looking at it.
      pending += applyMultiplier(e.points, e.multiplierApplied);
    }
  }

  // ── replay the confirmations, oldest first ───────────────────────────────────────
  //
  // The multiplier is NOT decided here — it was stamped on the entry when the order was placed
  // and is simply honoured. What this replay is still for is the TIER CLOCK: crossing a
  // threshold has to be dated to the maturity that crossed it, not to whenever someone happens
  // to read the account, because `tierEarnedAt` starts a twelve-month hold and a wrong date
  // there moves a demotion by up to a year.
  toConfirm.sort((a, b) => a.maturity.getTime() - b.maturity.getTime() || a.entry.id - b.entry.id);

  /** (date, merchandise) pairs for spend already confirmed — grows as the replay proceeds. */
  const confirmedSpend: { at: Date; cents: number }[] = [];
  for (const e of entries) {
    if (e.type !== "earn" || e.status !== "confirmed" || e.orderId === null) continue;
    confirmedSpend.push({ at: e.confirmedAt ?? e.createdAt, cents: countedMerchandise(e.orderId) });
  }
  const spendInWindowAt = (at: Date): number => {
    const start = addMonths(at, -RATES.tierWindowMonths);
    let total = 0;
    for (const s of confirmedSpend) if (s.at >= start && s.at <= at) total += s.cents;
    return total;
  };

  const confirm: ConfirmPlan[] = [];
  let heldNow = { tier: held.tier, earnedAt: held.earnedAt };

  for (const { entry, maturity } of toConfirm) {
    // Honoured, not recomputed. Deriving it from the tier at maturity is what made our own COD
    // hold cost the customer points: an order placed at Bloom whose anniversary fell in the
    // seven days between delivery and confirmation was paid at Petal.
    const multiplier = entry.multiplierApplied;
    const finalPoints = applyMultiplier(entry.points, multiplier);

    confirm.push({
      entryId: entry.id,
      basePoints: entry.points,
      finalPoints,
      multiplier,
      confirmedAt: maturity,
    });

    // Counted as spendable immediately, at the MULTIPLIED figure. The hold has objectively
    // elapsed; making the customer wait for a database write they cannot see would be the
    // scheduler dependency this design exists to avoid. Counting base points here instead is how
    // a Bouquet customer's 900 points read as 600 until something happened to call the sweep.
    live.push({ id: entry.id, type: "earn", points: finalPoints, at: maturity, isActivity: true });

    if (entry.orderId !== null) confirmedSpend.push({ at: maturity, cents: countedMerchandise(entry.orderId) });
    // The spend has landed, so a threshold crossed by THIS order is dated to this maturity.
    const tierThen = effectiveTier(tierForSpend(spendInWindowAt(maturity)), heldNow, maturity);
    heldNow = { tier: tierThen.tier, earnedAt: tierThen.earnedAt };
  }

  // ── expiry, applied to the balance rather than merely noticed ────────────────────
  live.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);
  const expire: ExpiryPlan[] = [];
  const lapsed = new Set<number>();

  const activityDates = live.filter((e) => e.isActivity).map((e) => e.at);
  let cursor: Date | null = activityDates.length ? activityDates[0] : null;
  let expiresAt: Date | null = null;

  while (cursor !== null) {
    const due: Date = addMonths(cursor, RATES.expiryMonths);
    const next = activityDates.find((d) => d > cursor!) ?? null;
    if (next !== null && next < due) {
      cursor = next; // the customer came back in time; clock restarts
      continue;
    }
    if (now < due) {
      expiresAt = due; // not lapsed yet — this is the date to show them
      break;
    }
    // Lapsed. Everything live and dated on or before the due date goes; anything granted after
    // it survives, so a birthday bonus awarded last week is not destroyed retroactively by a
    // clock that ran out before it existed.
    let amount = 0;
    for (const e of live) {
      if (lapsed.has(e.id) || e.at > due) continue;
      lapsed.add(e.id);
      amount += e.points;
    }
    if (amount > 0) {
      expire.push({
        points: amount,
        dueAt: due,
        reason: `${RATES.expiryMonths} months with no confirmed earn or redemption`,
      });
    }
    cursor = activityDates.find((d) => d > due) ?? null;
    expiresAt = null;
  }

  // ── the balance, after everything above ──────────────────────────────────────────
  let balance = 0;
  for (const e of live) if (!lapsed.has(e.id)) balance += e.points;

  const lastActivityAt = activityDates.length ? activityDates[activityDates.length - 1] : null;
  if (expiresAt === null && lastActivityAt !== null && expire.length === 0) {
    expiresAt = addMonths(lastActivityAt, RATES.expiryMonths);
  }

  const windowSpendCents = spendInWindowAt(now);
  const qualifiesFor = tierForSpend(windowSpendCents);
  const finalTier = effectiveTier(qualifiesFor, heldNow, now);

  return {
    balance,
    pending,
    windowSpendCents,
    qualifiesFor,
    tier: finalTier.tier,
    tierEarnedAt: finalTier.earnedAt,
    expiresAt,
    hasLapsed: expire.length > 0,
    lastActivityAt,
    plan: {
      confirm,
      expire,
      tier: {
        tier: finalTier.tier,
        earnedAt: finalTier.earnedAt,
        changed: finalTier.tier !== held.tier || finalTier.earnedAt.getTime() !== held.earnedAt.getTime(),
      },
    },
  };
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
  | "bad-input"
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
 * from a browser is never trusted, since the cap depends on a basket the client can change after
 * the quote was issued.
 *
 * `alreadyRedeemedCentsOnOrder` is what makes the cap a property of the ORDER rather than of the
 * call. Without it the 50% cap was enforced per invocation, so two redemptions of $30 each landed
 * on one $60 basket and covered 100% of it. The caller must read that figure inside the same
 * serialisable transaction as the write, or this is check-then-act with extra steps.
 */
export function quoteRedemption(input: {
  requestedPoints: number;
  balance: number;
  merchandiseCents: number;
  alreadyRedeemedCentsOnOrder?: number;
  redemptionEnabled: boolean;
  signedIn: boolean;
  refusalCount: number;
}): RedemptionQuote {
  const alreadyCents = input.alreadyRedeemedCentsOnOrder ?? 0;

  // Refuse non-finite money outright. Every comparison against NaN is false, so a cap expressed
  // as `requested > cap` silently stops rejecting anything — the cap does not fail loudly, it
  // just evaporates. `parseCents` at the route boundary is the first line of defence; this is
  // the second, because one day a caller will skip it.
  if (!isMoney(input.merchandiseCents) || !isMoney(alreadyCents) || !Number.isSafeInteger(input.balance)) {
    return { ok: false, reason: "bad-input", detail: "Basket total is not a whole number of cents.", maxPoints: 0 };
  }
  if (!Number.isSafeInteger(input.requestedPoints) || input.requestedPoints < 0) {
    return { ok: false, reason: "bad-input", detail: "Points must be a whole number.", maxPoints: 0 };
  }

  const capCents = Math.max(0, Math.floor(input.merchandiseCents * RATES.redeemMaxShareOfMerchandise) - alreadyCents);
  const capPoints = toBlocks((capCents / RATES.redeemBlockCents) * RATES.redeemBlockPoints);
  const maxPoints = Math.max(0, Math.min(toBlocks(input.balance), capPoints));

  const no = (reason: RedemptionRefusal, detail: string): RedemptionQuote =>
    ({ ok: false, reason, detail, maxPoints });

  if (!input.redemptionEnabled) return no("disabled", "Redeeming points is not switched on yet.");
  // Requiring a signed-in customer replaces the one-time code the brief asked for: there is no
  // SMS provider and SMTP is unconfigured, so no code could actually be delivered. Nobody spends
  // points without authenticating either way.
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
