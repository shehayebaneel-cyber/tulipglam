/**
 * The loyalty admin surface: what the operator can see and do that a customer cannot.
 *
 * ── THIS IS THE ONE PLACE THE RAW VOCABULARY IS ALLOWED OUT ────────────────────────
 *
 * `present.ts` exists to keep `redemptionReversal`, `manualAdjustment`, `void`, `dedupeKey` and
 * ledger row ids away from customers. Here they are the point. The question this surface exists
 * to answer is "why does this customer have the balance they have", and that question cannot be
 * answered in customer-facing language — an admin needs to see that entry #4,102 was a reversal
 * against order TG-00A1F3, entered by whoever typed "AS", at 14:02 on a Tuesday.
 *
 * So: raw types, raw statuses, raw reasons, real ids, real multipliers. Deliberately.
 *
 * ── AND ENUMERATION IS FINE HERE ───────────────────────────────────────────────────
 *
 * The customer API has no lookup by phone, on purpose. This one does, also on purpose: the
 * operator holds the admin key, is looking at an order in front of them, and needs to find the
 * account behind it. The protection is the key, not the absence of a search box.
 *
 * ── NOTHING HERE TRUSTS `enteredBy` ────────────────────────────────────────────────
 *
 * It is typed by a human into a box labelled "your initials (not verified)". Admin access is a
 * single shared key with no per-admin identity, so it can only ever mean "someone holding the
 * key". It is recorded for reconstruction, never consulted for authorisation.
 *
 * NOTE FOR WHOEVER READS THIS NEXT: the moment a second person has the key, real per-admin
 * identity stops being optional.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import { RATES, TIERS, DELIVERED_STATUSES, type TierKey } from "./config.js";
import { readAccount, pendingGuestClaims, recordEarn } from "./ledger.js";
import { normaliseLebanesePhone, formatLebanesePhone } from "./phone.js";
import { basePointsFor, merchandiseCentsOf } from "./rules.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** What a point is worth when redeemed: 100 points = $3.00, so 3 cents each. */
export const CENTS_PER_POINT = RATES.redeemBlockCents / RATES.redeemBlockPoints;

// ───────────────────────────────────────────────────────────────── lookup

export type AccountHit = {
  id: number;
  phoneE164: string;
  phoneDisplay: string;
  customerId: number | null;
  customerName: string;
  customerEmail: string;
  tier: TierKey;
  balanceCached: number;
  createdAt: Date;
};

/**
 * Find accounts by phone, in any spelling.
 *
 * The search term goes through the SAME normaliser that produced every account key, so "03 123
 * 456", "+9613123456" and "0096133123456" all find the same row. Falling back to a raw substring
 * match would find nothing for two of those three, which is exactly the failure the normaliser
 * exists to prevent — and an operator who searches their customer's number and is told "no
 * account" will open a second one by hand.
 *
 * A term that is not a usable Lebanese number falls back to matching the stored E.164 text, so a
 * partial number still finds something rather than nothing.
 */
export async function findAccounts(db: Db, term: string, take = 20): Promise<AccountHit[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];

  const normalised = normaliseLebanesePhone(trimmed);
  const where: Prisma.LoyaltyAccountWhereInput = normalised.ok
    ? { phoneE164: normalised.e164 }
    : { phoneE164: { contains: trimmed.replace(/\D/g, "") } };

  const rows = await db.loyaltyAccount.findMany({
    where,
    take,
    orderBy: { updatedAt: "desc" },
    include: { customer: { select: { fullName: true, email: true } } },
  });

  return rows.map((a) => ({
    id: a.id,
    phoneE164: a.phoneE164,
    phoneDisplay: formatLebanesePhone(a.phoneE164),
    customerId: a.customerId,
    customerName: a.customer?.fullName ?? "",
    customerEmail: a.customer?.email ?? "",
    tier: a.tier as TierKey,
    balanceCached: a.balanceCached,
    createdAt: a.createdAt,
  }));
}

// ───────────────────────────────────────────────────────────────── one account

/**
 * Everything about one account, in operator language.
 *
 * `derived` is what the rules say right now; `stored` is what the rows say. Showing BOTH is the
 * point of this view: they legitimately differ whenever the sweep has not run since something
 * matured, and an operator who does not know that will read a mismatch as corruption. The
 * customer sees only `derived`, because `derived` is the truth.
 */
export async function accountDetail(db: Db, accountId: number, now = new Date()) {
  const account = await db.loyaltyAccount.findUnique({
    where: { id: accountId },
    include: { customer: { select: { id: true, fullName: true, email: true } } },
  });
  if (!account) return null;

  const { state, refusalCount } = await readAccount(db, accountId, now);

  const entries = await db.loyaltyLedgerEntry.findMany({
    where: { accountId },
    orderBy: { id: "desc" },
    take: 200,
    include: { order: { select: { number: true, status: true, deliveredAt: true } } },
  });

  return {
    id: account.id,
    phoneE164: account.phoneE164,
    phoneDisplay: formatLebanesePhone(account.phoneE164),
    email: account.email,
    createdAt: account.createdAt,
    customer: account.customer,
    refusalCount,
    /** Blocked from redeeming until somebody reviews it — see RATES.refusalStrikeLimit. */
    redemptionBlocked: refusalCount >= RATES.refusalStrikeLimit,

    stored: {
      tier: account.tier,
      tierEarnedAt: account.tierEarnedAt,
      balanceCached: account.balanceCached,
    },
    derived: {
      balance: state.balance,
      pending: state.pending,
      tier: state.tier,
      tierEarnedAt: state.tierEarnedAt,
      qualifiesFor: state.qualifiesFor,
      windowSpendCents: state.windowSpendCents,
      expiresAt: state.expiresAt,
      hasLapsed: state.hasLapsed,
      /** Rows the sweep would write if it ran now. Empty means stored and derived agree. */
      pendingWrites: {
        confirm: state.plan.confirm.length,
        expirePoints: state.plan.expire.reduce((n, x) => n + x.points, 0),
        tierChange: state.plan.tier.changed ? state.plan.tier.tier : null,
      },
    },

    // Raw. Every column an operator might need to reconstruct a dispute.
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      points: e.points,
      multiplierApplied: Number(e.multiplierApplied ?? 1),
      orderId: e.orderId,
      orderNumber: e.order?.number ?? null,
      orderStatus: e.order?.status ?? null,
      reason: e.reason,
      enteredBy: e.createdBy,
      dedupeKey: e.dedupeKey,
      createdAt: e.createdAt,
      confirmedAt: e.confirmedAt,
    })),
  };
}

// ───────────────────────────────────────────────────────────────── back-fill queues

export type ClaimRow = {
  orderId: number;
  number: string;
  deliveredAt: Date | null;
  merchandiseCents: number;
  basePoints: number;
  /** Why this order is a candidate — which field matched, so an operator can sanity-check it. */
  matchedOn: string;
  customerName: string;
  /** Set when somebody has already ruled on it. Null means outstanding. */
  decision: { decision: string; decidedBy: string; note: string; decidedAt: Date } | null;
};

/**
 * Delivered GUEST orders whose phone matches this account.
 *
 * The queue is derived, not stored — a pending claim is a match with no decision row against it.
 * Decisions are recorded so a claim an admin has already refused does not reappear on every
 * visit; the fifth time it reappeared somebody would approve it just to clear the list.
 */
export async function guestClaims(db: Db, accountId: number, now = new Date()): Promise<ClaimRow[]> {
  const claims = await pendingGuestClaims(db, accountId, now);
  if (claims.length === 0) return [];

  const [decisions, orders] = await Promise.all([
    db.loyaltyClaimDecision.findMany({ where: { accountId, orderId: { in: claims.map((c) => c.orderId) } } }),
    db.order.findMany({ where: { id: { in: claims.map((c) => c.orderId) } }, select: { id: true, fullName: true } }),
  ]);
  const byOrder = new Map(decisions.map((d) => [d.orderId, d]));
  const names = new Map(orders.map((o) => [o.id, o.fullName]));

  return claims.map((c) => {
    const d = byOrder.get(c.orderId);
    return {
      ...c,
      matchedOn: "phone",
      customerName: names.get(c.orderId) ?? "",
      decision: d ? { decision: d.decision, decidedBy: d.decidedBy, note: d.note, decidedAt: d.decidedAt } : null,
    };
  });
}

/**
 * Delivered orders placed by this account's SIGNED-IN customer that never earned anything.
 *
 * These exist because the programme was switched off when they were placed, so no hook ran.
 * Guest back-fill cannot reach them — it only looks at orders with no customer attached — which
 * is the gap identified in the stage-2b review and left open deliberately until there was a
 * surface to resolve it on. This is that surface.
 *
 * The identity question is already settled for these: the order carries the customer's id
 * because they were signed in when they placed it. That is a fact the system recorded, not a
 * phone number somebody typed. An operator still confirms, because the DECISION is whether an
 * order from before the programme should earn at all.
 */
export async function signedInBackfill(db: Db, accountId: number): Promise<ClaimRow[]> {
  const account = await db.loyaltyAccount.findUnique({ where: { id: accountId }, select: { customerId: true } });
  if (!account?.customerId) return [];

  const orders = await db.order.findMany({
    where: {
      customerId: account.customerId,
      status: { in: [...DELIVERED_STATUSES] },
      // No earn row against the order at all. `earnOrderId` is claimed by recordEarn AND by a
      // manual credit, so this correctly excludes anything already paid by hand.
      loyaltyEntries: { none: { type: "earn" } },
    },
    select: {
      id: true, number: true, fullName: true, deliveredAt: true,
      subtotalCents: true, discountCents: true, pointsDiscountCents: true,
    },
    orderBy: { deliveredAt: "desc" },
    take: 100,
  });
  if (orders.length === 0) return [];

  const decisions = await db.loyaltyClaimDecision.findMany({
    where: { accountId, orderId: { in: orders.map((o) => o.id) } },
  });
  const byOrder = new Map(decisions.map((d) => [d.orderId, d]));

  return orders.map((o) => {
    const merchandiseCents = merchandiseCentsOf(o);
    const d = byOrder.get(o.id);
    return {
      orderId: o.id,
      number: o.number,
      deliveredAt: o.deliveredAt,
      merchandiseCents,
      basePoints: basePointsFor(merchandiseCents),
      matchedOn: "signed-in at checkout",
      customerName: o.fullName,
      decision: d ? { decision: d.decision, decidedBy: d.decidedBy, note: d.note, decidedAt: d.decidedAt } : null,
    };
  });
}

/**
 * Rule on a claim.
 *
 * Approving writes an EARN entry against the order and nothing else. It deliberately does NOT
 * touch `Order.customerId`: attaching a past guest order to an account changes what appears in
 * that customer's order history — addresses, items, everything — which is an orders-domain
 * decision with its own privacy weight, not something loyalty should do as a side effect.
 *
 * The decision row is written FIRST, and its unique index on (accountId, orderId) is what makes
 * a double-clicked Approve button grant once. Writing the earn first and the decision second
 * would leave the classic window where two clicks both find no decision and both pay.
 */
export async function decideClaim(
  db: PrismaClient,
  input: { accountId: number; orderId: number; decision: "approved" | "rejected"; decidedBy: string; note: string; now?: Date },
): Promise<{ ok: true; granted: number } | { ok: false; error: string; code: string }> {
  const decidedBy = input.decidedBy.trim();
  const note = input.note.trim();
  if (!decidedBy) return { ok: false, error: "Initials are required.", code: "entered-by-required" };
  if (note.length < RATES.minAdjustmentReasonLength) {
    return {
      ok: false,
      code: "reason-too-short",
      error: `A note of at least ${RATES.minAdjustmentReasonLength} characters is required — it is what makes this reviewable later.`,
    };
  }

  const now = input.now ?? new Date();

  try {
    await db.loyaltyClaimDecision.create({
      data: { accountId: input.accountId, orderId: input.orderId, decision: input.decision, decidedBy, note, decidedAt: now },
    });
  } catch {
    return { ok: false, error: "This order has already been ruled on.", code: "already-decided" };
  }

  if (input.decision === "rejected") return { ok: true, granted: 0 };

  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: { subtotalCents: true, discountCents: true, pointsDiscountCents: true, deliveredAt: true },
  });
  if (!order) return { ok: true, granted: 0 };

  const merchandiseCents = merchandiseCentsOf(order);
  // `now` is the entry's creation date, but maturity is driven by the order's OWN deliveredAt,
  // so a back-filled order that was delivered months ago is spendable immediately rather than
  // starting a fresh seven-day hold the customer has already served.
  const res = await recordEarn(db, { accountId: input.accountId, orderId: input.orderId, merchandiseCents, now });
  return { ok: true, granted: res.created ? res.basePoints : 0 };
}

// ───────────────────────────────────────────────────────────────── the dashboard

export type LoyaltyDashboard = {
  /** Confirmed, unexpired points across every account, and what they would cost to honour. */
  outstandingPoints: number;
  liabilityCents: number;
  centsPerPoint: number;
  /** Points still inside the COD hold — not a liability yet, but they will be. */
  pendingPoints: number;
  pendingLiabilityCents: number;
  issuedThisMonth: number;
  redeemedThisMonth: number;
  expiredThisMonth: number;
  accounts: number;
  linkedAccounts: number;
  tiers: { key: TierKey; label: string; count: number }[];
  monthLabel: string;
};

/**
 * The numbers an owner needs to know what this programme is costing.
 *
 * ── LIABILITY IS COMPUTED FROM THE LEDGER, NOT FROM `balanceCached` ────────────────
 *
 * The cache is a cache. On a store where the sweep may never have run it can be behind by every
 * unmaterialised confirmation on every account, and a liability figure that is quietly low is
 * worse than no figure at all. This sums the rows.
 *
 * It deliberately does NOT subtract points that are about to expire, and does not model
 * breakage. Both would make the number smaller and both are guesses; an owner deciding whether
 * this programme is affordable should see the number that assumes everyone redeems.
 */
export async function dashboard(db: Db, now = new Date()): Promise<LoyaltyDashboard> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [confirmed, pendingRows, issued, redeemed, expired, accounts, linked, tierCounts] = await Promise.all([
    db.loyaltyLedgerEntry.aggregate({ _sum: { points: true }, where: { status: "confirmed" } }),
    db.loyaltyLedgerEntry.aggregate({ _sum: { points: true }, where: { status: "pending", type: "earn" } }),
    db.loyaltyLedgerEntry.aggregate({
      _sum: { points: true },
      where: { status: "confirmed", points: { gt: 0 }, confirmedAt: { gte: monthStart } },
    }),
    db.loyaltyLedgerEntry.aggregate({
      _sum: { points: true },
      where: { type: "redeem", status: "confirmed", confirmedAt: { gte: monthStart } },
    }),
    db.loyaltyLedgerEntry.aggregate({
      _sum: { points: true },
      where: { type: "expiry", status: "confirmed", confirmedAt: { gte: monthStart } },
    }),
    db.loyaltyAccount.count(),
    db.loyaltyAccount.count({ where: { customerId: { not: null } } }),
    db.loyaltyAccount.groupBy({ by: ["tier"], _count: { _all: true } }),
  ]);

  // Confirmed entries sum to the outstanding balance: earns are positive, redemptions,
  // reversals and expiries negative. Clamped at zero because a store-wide negative would mean
  // more has been clawed back than granted, which is not a liability.
  const outstandingPoints = Math.max(0, confirmed._sum.points ?? 0);
  const pendingPoints = Math.max(0, pendingRows._sum.points ?? 0);

  const byTier = new Map(tierCounts.map((t) => [t.tier, t._count._all]));

  return {
    outstandingPoints,
    liabilityCents: Math.round(outstandingPoints * CENTS_PER_POINT),
    centsPerPoint: CENTS_PER_POINT,
    pendingPoints,
    pendingLiabilityCents: Math.round(pendingPoints * CENTS_PER_POINT),
    issuedThisMonth: issued._sum.points ?? 0,
    redeemedThisMonth: Math.abs(redeemed._sum.points ?? 0),
    expiredThisMonth: Math.abs(expired._sum.points ?? 0),
    accounts,
    linkedAccounts: linked,
    tiers: TIERS.map((t) => ({ key: t.key, label: t.label, count: byTier.get(t.key) ?? 0 })),
    monthLabel: monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
  };
}
