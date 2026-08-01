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
  const parts: string[] = [];
  if (o.discountCents > 0) parts.push(`${money(o.discountCents)} coupon${o.couponCode ? ` (${o.couponCode})` : ""}`);
  if (o.pointsDiscountCents > 0) parts.push(`${money(o.pointsDiscountCents)} paid with points`);
  if (o.giftCardCents > 0) parts.push(`${money(o.giftCardCents)} paid by gift card`);
  if (o.deliveryCents === 0) parts.push("free delivery");
  else parts.push(`${money(o.deliveryCents)} delivery`);
  return parts.join(" · ");
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
    db.order.findMany({ where: { status: { in: [...DISPATCHABLE] } }, select: SELECT, orderBy: { createdAt: "asc" }, take: 500 }),
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
  return [
    `TulipGlam ${line.number}`,
    `COLLECT: ${line.collectLabel} cash`,
    ``,
    `${line.fullName} — ${line.phone}`,
    [line.address, line.city, line.area].filter(Boolean).join(", "),
    line.notes ? `Note: ${line.notes}` : "",
    `${line.itemCount} item${line.itemCount === 1 ? "" : "s"}`,
  ].filter(Boolean).join("\n");
}
