/**
 * Dispatch: telling a delivery driver what to collect at the door.
 *
 * ── THE PROBLEM THIS EXISTS FOR ────────────────────────────────────────────────────
 *
 * There is no courier integration. Today the only place an order total reaches a human is a
 * WhatsApp message the CUSTOMER composes at checkout — which means the shop has no artefact of
 * its own that says what to collect. That was survivable while every order was simply
 * "subtotal plus delivery" and a driver could work it out from the invoice in the bag.
 *
 * It stops being survivable the moment points are redeemable. A $60 order with 300 points spent
 * is $51 at the door, and nothing on the parcel would say so. The driver collects $60, or argues
 * with the customer on their doorstep. That is why redemption is still switched off, and it is
 * the one thing standing between it and going live.
 *
 * ── WHAT THIS MODULE DOES, AND DELIBERATELY DOES NOT DO ────────────────────────────
 *
 * It does NOT pick a delivery process. That is the owner's call and it depends on which courier
 * they end up using. What it does is make the amount unambiguous, portable, and impossible to
 * disagree with the order — so that whichever process gets chosen, the number is already there:
 *
 *   a printed note in the parcel     -> `deliveryNote()` renders one
 *   a daily list for the driver      -> `manifest()` returns the day's runs with a cash total
 *   a WhatsApp message per order     -> `courierMessage()` writes it
 *   a courier's own portal or API    -> every one of the above shows the same copyable figure
 *
 * ── ONE NUMBER, FROM ONE PLACE ─────────────────────────────────────────────────────
 *
 * `collectCents` is `order.totalCents` and nothing else. It is not recomputed here, not adjusted
 * here, and not rounded here. Checkout already worked it out with the coupon, the points, the
 * delivery fee and the gift card in the right order and inside a transaction; a second
 * calculation on the way to the door is exactly how a driver ends up holding a different number
 * from the customer.
 */
import type { PrismaClient } from "@prisma/client";
import { statusMeta } from "./status.js";

/** Statuses where a parcel is on its way to somebody and cash is expected. */
export const DISPATCHABLE = ["packed", "dispatched", "out_for_delivery"] as const;
/** Statuses that are about to become dispatchable — useful for planning a run. */
export const PREPARING = ["confirmed", "sourcing"] as const;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export type DispatchLine = {
  id: number;
  number: string;
  status: string;
  statusLabel: string;
  fullName: string;
  phone: string;
  whatsapp: string;
  area: string;
  city: string;
  address: string;
  notes: string;
  itemCount: number;
  /** What the goods in the bag are worth at their own prices — used only to decide whether the
   *  collect amount needs explaining. Never shown to the driver. */
  itemsFaceValueCents: number;
  /** THE figure. Straight from the order, never recomputed. */
  collectCents: number;
  collectLabel: string;
  /** Present only when it differs from the plain goods+delivery sum — see `whyDifferent`. */
  whyDifferent: string;
  createdAt: Date;
  items: { name: string; variantLabel: string; qty: number; priceCents: number }[];
};

/**
 * Why the amount at the door is not simply "the things in the bag".
 *
 * A driver holding a parcel worth $60 and asked for $51 needs one line telling them why, or
 * they will assume a mistake and collect $60. This is that line, and it is derived from what
 * the order actually recorded rather than from a template.
 */
function whyDifferent(o: { subtotalCents: number; discountCents: number; pointsDiscountCents: number; giftCardCents: number; deliveryCents: number; couponCode: string }): string {
  // The coupon CODE is deliberately not here. This line is printed on a sheet handed to a
  // driver and, through courierMessage, sent to whoever is delivering — a working discount
  // code is not something to put in their hands. The amount is what they need; the code is
  // the shop's business.
  const reductions: string[] = [];
  if (o.discountCents > 0) reductions.push(`${money(o.discountCents)} coupon`);
  if (o.pointsDiscountCents > 0) reductions.push(`${money(o.pointsDiscountCents)} paid with points`);
  if (o.giftCardCents > 0) reductions.push(`${money(o.giftCardCents)} paid by gift card`);

  /**
   * EMPTY when nothing reduced the amount — which is every order today.
   *
   * This used to always return a line, so an ordinary order printed "$3.00 delivery" in a
   * column headed *why this is not the price of the goods*. Nothing was different about it;
   * goods plus delivery is what a total normally is. A sheet where every row carries an
   * explanation trains the reader to stop reading them, and the one row that genuinely needs
   * explaining — the points order, the whole reason this module exists — is the one that then
   * gets skipped. The blank rows are what make the filled one visible.
   */
  if (reductions.length === 0) return "";

  // Delivery is named only alongside a reduction, so the arithmetic on the sheet reads whole:
  // the driver can see goods, minus this, plus delivery, equals the figure they are asking for.
  reductions.push(o.deliveryCents === 0 ? "free delivery" : `${money(o.deliveryCents)} delivery`);
  return reductions.join(" · ");
}

const shape = (o: Parameters<typeof whyDifferent>[0] & {
  id: number; number: string; status: string; fullName: string; phone: string; whatsapp: string;
  area: string; city: string; address: string; notes: string; totalCents: number; createdAt: Date;
  items: { name: string; variantLabel: string; qty: number; priceCents: number }[];
}): DispatchLine => ({
  id: o.id,
  number: o.number,
  status: o.status,
  statusLabel: statusMeta(o.status).label,
  fullName: o.fullName,
  phone: o.phone,
  whatsapp: o.whatsapp,
  area: o.area,
  city: o.city,
  address: o.address,
  notes: o.notes,
  itemCount: o.items.reduce((n, i) => n + i.qty, 0),
  itemsFaceValueCents: o.items.reduce((n, i) => n + i.priceCents * i.qty, 0),
  collectCents: o.totalCents,
  collectLabel: money(o.totalCents),
  whyDifferent: whyDifferent(o),
  createdAt: o.createdAt,
  items: o.items,
});

const SELECT = {
  id: true, number: true, status: true, fullName: true, phone: true, whatsapp: true,
  area: true, city: true, address: true, notes: true,
  subtotalCents: true, discountCents: true, pointsDiscountCents: true, giftCardCents: true,
  deliveryCents: true, totalCents: true, couponCode: true, createdAt: true,
  items: { select: { name: true, variantLabel: true, qty: true, priceCents: true } },
} as const;

export type Manifest = {
  generatedAt: Date;
  outForDelivery: DispatchLine[];
  preparing: DispatchLine[];
  /** Cash the driver should come back with if every run below is accepted. */
  expectedCashCents: number;
  expectedCashLabel: string;
  /** How many carry a discount a driver would otherwise question. */
  discountedCount: number;
};

/**
 * Today's run.
 *
 * `expectedCash` is what to reconcile against when the driver returns — the single number that
 * turns "did we get paid" from a per-order question into one comparison.
 */
export async function manifest(db: PrismaClient, now = new Date()): Promise<Manifest> {
  const [out, prep] = await Promise.all([
    // NEWEST first, not oldest. With oldest-first and a cap, a backlog of stale packed orders
    // would push today's actual run off the end of the list — the driver would be handed a
    // sheet that omitted the parcels in the van.
    db.order.findMany({ where: { status: { in: [...DISPATCHABLE] } }, select: SELECT, orderBy: { createdAt: "desc" }, take: 500 }),
    db.order.findMany({ where: { status: { in: [...PREPARING] } }, select: SELECT, orderBy: { createdAt: "asc" }, take: 500 }),
  ]);

  const outForDelivery = out.map(shape);
  const expectedCashCents = outForDelivery.reduce((n, o) => n + o.collectCents, 0);

  return {
    generatedAt: now,
    outForDelivery,
    preparing: prep.map(shape),
    expectedCashCents,
    expectedCashLabel: money(expectedCashCents),
    discountedCount: out.filter((o) => o.discountCents > 0 || o.pointsDiscountCents > 0 || o.giftCardCents > 0).length,
  };
}

export async function dispatchLine(db: PrismaClient, orderId: number): Promise<DispatchLine | null> {
  const o = await db.order.findUnique({ where: { id: orderId }, select: SELECT });
  return o ? shape(o) : null;
}

/**
 * A message to send a courier about one order.
 *
 * Deliberately short and front-loaded: the amount is the first thing after the order number,
 * because this gets read on a phone, in a car, at a door. Everything a driver needs and nothing
 * they do not — no item list, no prices, no coupon codes. What is in the bag is the shop's
 * business; what to collect is theirs.
 */
export function courierMessage(line: DispatchLine): string {
  // Anything that reduces the amount below the face value of the bag is stated. Without it the
  // message says "collect $43" for a parcel visibly worth $60 and the driver assumes a mistake
  // — which is the exact failure this whole module exists to prevent. It was built into the
  // printed sheet and left out of the message, which is the artefact most likely to be read.
  const reduced = line.collectCents < line.itemsFaceValueCents;
  return [
    `TulipGlam ${line.number}`,
    `COLLECT: ${line.collectLabel} cash`,
    reduced ? `(${line.whyDifferent})` : "",
    ``,
    `${line.fullName} — ${line.phone}`,
    [line.address, line.city, line.area].filter(Boolean).join(", "),
    line.notes ? `Note: ${line.notes}` : "",
    `${line.itemCount} item${line.itemCount === 1 ? "" : "s"}`,
  ].filter(Boolean).join("\n");
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
 *  RECONCILING A RUN — counting the money after the van comes back
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * `manifest()` answers "what should I collect today". It is a forecast, and it assumes every
 * parcel is accepted. Real rounds are not like that: some are paid, some are refused at the
 * door, some were paid partly in points before the driver ever left.
 *
 * This answers the question that actually gets asked at the end of the day, standing over a
 * pile of notes: **does what is in my hand match what happened?** It has to hold for a mixed
 * round or it is worse than useless, because a total that is nearly right is a total that gets
 * trusted and then quietly absorbs a missing $20.
 *
 * The identity it is built on:
 *
 *     cash in hand  =  Σ totalCents of everything DELIVERED
 *
 * and nothing else. Not the subtotal, not the goods in the van, not the forecast.
 *
 *   · A refused parcel contributes ZERO. The goods came back; no money changed hands. It is
 *     not a shortfall to be explained, it is simply not part of the sum — but it IS listed,
 *     with the amount that did not arrive, because "the total is lower than this morning" is a
 *     question that will be asked and must have an answer on the same sheet.
 *   · A points-discounted order contributes its DISCOUNTED total, because that is the cash the
 *     customer handed over. The points were spent when the order was placed; expecting the full
 *     price back is double-counting the same money.
 *   · A gift-card order is the same case for the same reason.
 *   · Anything still out contributes zero and is listed separately, so a driver still holding
 *     three parcels does not read as three missing payments.
 *
 * Which gives the line the owner can check in ten seconds:
 *
 *     collected + refused + stillOut  =  the run that went out
 */
export type Reconciliation = {
  since: Date;
  until: Date;
  /** THE number: what should be in hand. Nothing else in this object is money you have. */
  collectedCents: number;
  collectedLabel: string;
  delivered: { number: string; name: string; collectedCents: number; collectedLabel: string; paidWithPointsCents: number }[];
  /** Came back. Zero cash, and that is correct, not a discrepancy. */
  refused: { number: string; name: string; wouldHaveBeenCents: number; wouldHaveBeenLabel: string; status: string }[];
  refusedCents: number;
  refusedLabel: string;
  /** Not resolved yet — still out with the driver. */
  stillOutCents: number;
  stillOutLabel: string;
  stillOutCount: number;
  /** collected + refused + stillOut. Compare against the morning's manifest. */
  accountedForCents: number;
  accountedForLabel: string;
  /** How much of the collected figure was settled in points rather than cash at the door. */
  paidWithPointsCents: number;
  paidWithPointsLabel: string;
};

/** Ended in cash. */
const SETTLED = ["delivered", "completed"] as const;
/** Ended without cash after the parcel had already gone out. */
const RETURNED = ["refused", "cancelled"] as const;

export async function reconcile(db: PrismaClient, since: Date, until = new Date()): Promise<Reconciliation> {
  /**
   * The window is taken from the ORDER EVENT, not from `updatedAt`.
   *
   * `updatedAt` moves whenever anything on the row is touched — an admin fixing a typo in an
   * address next week would pull a week-old order into today's reconciliation and inflate the
   * total by an amount that was collected on a different day. The event table records when the
   * status actually changed, which is the thing being counted.
   */
  const events = await db.orderEvent.findMany({
    where: { status: { in: [...SETTLED, ...RETURNED] }, createdAt: { gte: since, lte: until } },
    select: { orderId: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Latest event per order wins: an order that went delivered then cancelled is a cancellation,
  // and one cancelled then re-entered is not a refusal. Ascending order means the last write
  // for each id is the newest.
  const latest = new Map<number, string>();
  for (const e of events) latest.set(e.orderId, e.status);

  /**
   * The still-out figure is read UNCONDITIONALLY, before any early exit.
   *
   * An earlier version returned a block of zeroes as soon as nothing had settled yet — which is
   * the state of every morning, with the van loaded and on the road. It reported "still out: 0"
   * while three parcels were out, so the panel said nothing was owed at the exact moment the
   * most money was in transit. Caught by looking at the screen, not by the tests, all of which
   * happened to seed a settled order first.
   */
  const stillOutRows = await db.order.findMany({
    where: { status: { in: [...DISPATCHABLE] } },
    select: { totalCents: true },
  });
  const stillOutCents = stillOutRows.reduce((n, o) => n + o.totalCents, 0);

  if (latest.size === 0) {
    const zero = money(0);
    return {
      since, until,
      collectedCents: 0, collectedLabel: zero, delivered: [],
      refused: [], refusedCents: 0, refusedLabel: zero,
      stillOutCents, stillOutLabel: money(stillOutCents), stillOutCount: stillOutRows.length,
      accountedForCents: stillOutCents, accountedForLabel: money(stillOutCents),
      paidWithPointsCents: 0, paidWithPointsLabel: zero,
    };
  }

  const orders = await db.order.findMany({
    where: { id: { in: [...latest.keys()] } },
    select: { id: true, number: true, fullName: true, totalCents: true, pointsDiscountCents: true, status: true },
  });

  const delivered: Reconciliation["delivered"] = [];
  const refused: Reconciliation["refused"] = [];
  for (const o of orders) {
    const ended = latest.get(o.id)!;
    if ((SETTLED as readonly string[]).includes(ended)) {
      delivered.push({
        number: o.number, name: o.fullName,
        collectedCents: o.totalCents, collectedLabel: money(o.totalCents),
        paidWithPointsCents: o.pointsDiscountCents,
      });
    } else {
      refused.push({
        number: o.number, name: o.fullName,
        wouldHaveBeenCents: o.totalCents, wouldHaveBeenLabel: money(o.totalCents),
        status: statusMeta(ended).label,
      });
    }
  }

  const collectedCents = delivered.reduce((n, d) => n + d.collectedCents, 0);
  const refusedCents = refused.reduce((n, r) => n + r.wouldHaveBeenCents, 0);
  const paidWithPointsCents = delivered.reduce((n, d) => n + d.paidWithPointsCents, 0);

  return {
    since, until,
    collectedCents, collectedLabel: money(collectedCents), delivered,
    refused, refusedCents, refusedLabel: money(refusedCents),
    stillOutCents, stillOutLabel: money(stillOutCents), stillOutCount: stillOutRows.length,
    accountedForCents: collectedCents + refusedCents + stillOutCents,
    accountedForLabel: money(collectedCents + refusedCents + stillOutCents),
    paidWithPointsCents, paidWithPointsLabel: money(paidWithPointsCents),
  };
}
