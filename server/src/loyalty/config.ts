/**
 * Every tunable number in the loyalty program, in one place.
 *
 * Nothing below is duplicated in the rules or the ledger — change a rate here and the whole
 * program follows, including the tests, which read these rather than restating them. A test
 * that hardcodes "300 points minimum" passes forever after someone changes the minimum.
 *
 * Two independent feature flags, in the style of the coming-soon gate:
 *
 *   LOYALTY_ENABLED             the program as a whole. Off = nothing earns, nothing shows.
 *   LOYALTY_REDEMPTION_ENABLED  spending points, separately.
 *
 * They are separate because earning has to run first: points must accumulate before redemption
 * is worth anything, and redemption cannot go live until the courier can see the discounted
 * amount at the door. Today the only place an order total reaches a human is a WhatsApp message
 * someone composes by hand — so switching redemption on before that changes is a doorstep
 * dispute waiting to happen.
 */

const flag = (name: string): boolean => String(process.env[name] ?? "").trim().toLowerCase() === "true";

/** The program. Off means the ledger is never written to and no UI appears. */
export const LOYALTY_ENABLED = flag("LOYALTY_ENABLED");

/**
 * Spending points. Requires LOYALTY_ENABLED — on its own it does nothing, since there would be
 * no balance to spend.
 */
export const LOYALTY_REDEMPTION_ENABLED = LOYALTY_ENABLED && flag("LOYALTY_REDEMPTION_ENABLED");

export type TierKey = "petal" | "bloom" | "bouquet";

export type TierRule = {
  key: TierKey;
  label: string;
  /** Confirmed merchandise spend over the trailing window, in cents, to reach this tier. */
  thresholdCents: number;
  /** Applied to base points at CONFIRMATION, never at placement. */
  multiplier: number;
  /** Free delivery below this order value; null means never, 0 means always. */
  freeDeliveryOverCents: number | null;
};

/**
 * Ascending by threshold. `tierForSpend` walks this backwards, so order matters.
 *
 * Perks are deliberately limited to free delivery, which the order pipeline can already
 * express. "Early access to sales" and "first access to new arrivals" were cut: there is no
 * mechanism in this codebase to restrict a product or a sale to a subset of customers, and a
 * tier perk with nothing behind it is a promise broken on day one.
 */
export const TIERS: readonly TierRule[] = [
  { key: "petal", label: "Petal", thresholdCents: 0, multiplier: 1.0, freeDeliveryOverCents: null },
  { key: "bloom", label: "Bloom", thresholdCents: 250_00, multiplier: 1.25, freeDeliveryOverCents: 40_00 },
  { key: "bouquet", label: "Bouquet", thresholdCents: 600_00, multiplier: 1.5, freeDeliveryOverCents: 0 },
];

export const RATES = {
  /** 1 point per $1 of merchandise, after discounts, before delivery. Rounded DOWN. */
  centsPerPoint: 100,

  /** 100 points = $3.00, i.e. 3 cents a point. Redemption is in whole blocks only. */
  redeemBlockPoints: 100,
  redeemBlockCents: 3_00,
  redeemMinimumPoints: 300,
  /** A redemption may not cover more than this share of the merchandise subtotal. */
  redeemMaxShareOfMerchandise: 0.5,

  /** Once per account, on creation. */
  signupBonusPoints: 100,
  /** Once per calendar year, in the customer's birth month. */
  birthdayBonusPoints: 200,

  /**
   * The COD hold. Points earned on an order become spendable this many days after delivery,
   * because a cash-on-delivery order can be refused at the door and a customer who never paid
   * must never hold a spendable balance.
   */
  holdDaysAfterDelivery: 7,

  /** Confirmed points expire this long after the last CONFIRMED earn or redemption. */
  expiryMonths: 12,
  /** Tier is computed over confirmed merchandise spend in this trailing window... */
  tierWindowMonths: 12,
  /** ...and once earned is held this long. Demotion happens only at that anniversary. */
  tierHoldMonths: 12,

  /** Refusals on one account before redemption is blocked pending manual review. */
  refusalStrikeLimit: 3,

  /** Guest orders older than this are not back-filled when an account claims them. */
  guestBackfillMaxAgeDays: 90,

  /** A manual adjustment's reason must be at least this long — "x" explains nothing later. */
  minAdjustmentReasonLength: 8,
} as const;

/** Ledger entry types. Strings, matching the rest of this schema — see the note in schema.prisma. */
export const ENTRY_TYPES = [
  "earn",
  "redeem",
  "reversal",
  "redemptionReversal",
  "expiry",
  "manualAdjustment",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_STATUSES = ["pending", "confirmed", "void"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** Order statuses that mean the customer received the goods. */
export const DELIVERED_STATUSES = ["delivered", "completed"] as const;

/**
 * Order statuses that kill a pending earn.
 *
 * `refused` is counted separately for the strike rule — it is the only one the customer caused.
 */
export const VOIDING_STATUSES = ["cancelled", "refused", "unavailable"] as const;
