/**
 * Checkout money math, driven through the HTTP API.
 *
 *     node scripts/test-checkout-money.mjs             # what it would check, no orders placed
 *     node scripts/test-checkout-money.mjs --write     # places real orders, then deletes them
 *
 * The server must already be running on PORT (default 4230).
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production.
 *
 *  --write creates its own throwaway coupons and gift cards (prefix TEST-), places orders
 *  against them, then deletes every row it created in a `finally`. It never reads, updates or
 *  deletes a coupon, gift card or order it did not create. Existing catalogue rows are only
 *  read, to find a product to buy.
 *
 *  Orders it creates are visible in admin while it runs — a few seconds — and are gone
 *  afterwards. Do not run it during a live promotion if that would confuse anyone watching.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * What it covers:
 *   - the free-delivery threshold at its exact boundary (under / on / over)
 *   - a percent coupon, a fixed coupon, and a coupon under its minimum order
 *   - a gift card larger and smaller than the total
 *   - two simultaneous orders paying with the SAME gift card  → it must not go negative
 *   - two simultaneous orders using a coupon with ONE use left → it must not be over-used
 */
const BASE = `http://localhost:${process.env.PORT ?? 4230}/api`;
const WRITE = process.argv.includes("--write");

const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};
const money = (c) => "$" + (c / 100).toFixed(2);

if (!WRITE) {
  console.log("\nDry run — no orders placed. Pass --write to actually exercise checkout.\n");
  console.log("  would check: free-delivery boundary (under / exactly on / over)");
  console.log("  would check: percent coupon, fixed coupon, coupon below its minimum");
  console.log("  would check: gift card larger than the total, and smaller than it");
  console.log("  would check: two concurrent orders on one gift card cannot overdraw it");
  console.log("  would check: two concurrent orders cannot exceed a coupon's maxUses\n");
  process.exit(0);
}

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

const tag = `TEST-${Date.now().toString(36).toUpperCase()}`;
const made = { coupons: [], giftCards: [], orderNumbers: [] };

const buyer = { fullName: "Checkout Test", phone: "00000000", address: "test", city: "test" };
const placeOrder = async (extra) => {
  const r = await post("/orders", { ...buyer, ...extra });
  if (r.body?.number) made.orderNumbers.push(r.body.number);
  return r;
};

try {
  // ---------------------------------------------------------------- fixtures
  const settings = Object.fromEntries((await db.setting.findMany()).map((s) => [s.key, s.value]));
  const threshold = Number(settings.freeDeliveryThresholdCents ?? 6000);
  const defaultDelivery = Number(settings.defaultDeliveryCents ?? 300);
  console.log(`\nFree delivery at ${money(threshold)}, otherwise ${money(defaultDelivery)}.`);

  // Active, no variants and no sale price, so quantity alone controls the subtotal and the
  // arithmetic below is exact. Preferring a price that divides the threshold means the
  // *exact* boundary can be hit — $60.00 itself, not just $59.85 and $60.80 either side.
  const candidates = await db.product.findMany({
    where: { status: "active", saleCents: null, priceCents: { gt: 0, lte: 2000 }, variants: { none: {} } },
    select: { id: true, name: true, priceCents: true },
    take: 400,
  });
  if (!candidates.length) throw new Error("no suitable test product found");
  const unit = candidates.find((p) => threshold % p.priceCents === 0) ?? candidates[0];
  const exact = threshold % unit.priceCents === 0;
  console.log(`Buying “${unit.name}” at ${money(unit.priceCents)} each${exact ? "" : " (no price divides the threshold, so the exact boundary can't be hit)"}.\n`);

  const sub = (qty) => unit.priceCents * qty;
  const line = (qty) => [{ productId: unit.id, qty }];

  // ---------------------------------------------------------------- delivery boundary
  console.log("Free-delivery threshold:");
  // The rule is `subtotal >= threshold`, so the interesting points are the last qty below it
  // and the first at or above it — an off-by-one here charges delivery on a qualifying order.
  const over = Math.ceil(threshold / unit.priceCents);
  const under = over - 1;

  const r1 = await placeOrder({ items: line(under) });
  check(`${money(sub(under))} — under the threshold — is charged delivery`,
    r1.status === 200 && r1.body.deliveryCents === defaultDelivery, JSON.stringify(r1.body));
  check("  ...and the total is subtotal + delivery",
    r1.body.totalCents === sub(under) + defaultDelivery, `${r1.body.totalCents} vs ${sub(under) + defaultDelivery}`);

  const r2 = await placeOrder({ items: line(over) });
  check(`${money(sub(over))} — ${exact ? "exactly on" : "over"} the threshold — is free`,
    r2.status === 200 && r2.body.deliveryCents === 0, JSON.stringify(r2.body));
  check("  ...and the total is just the subtotal", r2.body.totalCents === sub(over), `${r2.body.totalCents} vs ${sub(over)}`);

  if (exact) {
    // One cent past the boundary, to prove the comparison isn't accidentally `>`.
    const r2b = await placeOrder({ items: line(over + 1) });
    check(`${money(sub(over + 1))} — past the threshold — is still free`,
      r2b.body.deliveryCents === 0, JSON.stringify(r2b.body));
  }

  // ---------------------------------------------------------------- coupons
  console.log("\nCoupons:");
  const pct = await db.coupon.create({ data: { code: `${tag}-PCT`, type: "percent", value: 10, active: true, minOrderCents: 0 } });
  made.coupons.push(pct.id);
  const qty = over; // a qualifying subtotal, so delivery is out of the way while testing coupons
  const r3 = await placeOrder({ items: line(qty), couponCode: pct.code });
  check("a 10% coupon discounts 10% of the subtotal",
    r3.body.discountCents === Math.round(sub(qty) * 0.1), `${r3.body.discountCents} vs ${Math.round(sub(qty) * 0.1)}`);

  const fixed = await db.coupon.create({ data: { code: `${tag}-FIX`, type: "fixed", value: 200, active: true, minOrderCents: 0 } });
  made.coupons.push(fixed.id);
  const r4 = await placeOrder({ items: line(qty), couponCode: fixed.code });
  check("a $2 fixed coupon discounts exactly $2", r4.body.discountCents === 200, String(r4.body.discountCents));

  const gated = await db.coupon.create({ data: { code: `${tag}-MIN`, type: "fixed", value: 500, active: true, minOrderCents: 99_999_00 } });
  made.coupons.push(gated.id);
  const r5 = await placeOrder({ items: line(1), couponCode: gated.code });
  check("a coupon below its minimum order applies nothing", r5.body.discountCents === 0, String(r5.body.discountCents));

  // ---------------------------------------------------------------- gift cards
  console.log("\nGift cards:");
  const big = await db.giftCard.create({ data: { code: `${tag}-BIG`, initialCents: 500_00, balanceCents: 500_00, active: true } });
  made.giftCards.push(big.id);
  const r6 = await placeOrder({ items: line(qty), giftCardCode: big.code });
  check("a card bigger than the total covers it exactly and no more",
    r6.body.giftCardCents === sub(qty) && r6.body.totalCents === 0, JSON.stringify(r6.body));
  const bigAfter = await db.giftCard.findUnique({ where: { id: big.id } });
  check("  ...and only that much is debited", bigAfter.balanceCents === 500_00 - sub(qty), String(bigAfter.balanceCents));

  const small = await db.giftCard.create({ data: { code: `${tag}-SML`, initialCents: 100, balanceCents: 100, active: true } });
  made.giftCards.push(small.id);
  const r7 = await placeOrder({ items: line(qty), giftCardCode: small.code });
  check("a card smaller than the total is spent in full", r7.body.giftCardCents === 100, String(r7.body.giftCardCents));
  check("  ...leaving the rest to pay", r7.body.totalCents === sub(qty) - 100, String(r7.body.totalCents));
  const smallAfter = await db.giftCard.findUnique({ where: { id: small.id } });
  check("  ...and the balance is zero, never negative", smallAfter.balanceCents === 0, String(smallAfter.balanceCents));

  // ---------------------------------------------------------------- races
  console.log("\nTwo orders at the same moment:");
  const shared = await db.giftCard.create({ data: { code: `${tag}-RACE`, initialCents: 500, balanceCents: 500, active: true } });
  made.giftCards.push(shared.id);
  const both = await Promise.all([
    placeOrder({ items: line(qty), giftCardCode: shared.code }),
    placeOrder({ items: line(qty), giftCardCode: shared.code }),
  ]);
  const spent = both.reduce((n, r) => n + (r.body.giftCardCents ?? 0), 0);
  const sharedAfter = await db.giftCard.findUnique({ where: { id: shared.id } });
  check("one $5 gift card can't pay for two orders",
    spent === 500, `both orders together applied ${money(spent)} of a ${money(500)} card`);
  check("  ...and the balance never goes negative",
    sharedAfter.balanceCents === 0, `balance is ${money(sharedAfter.balanceCents)}`);

  const once = await db.coupon.create({ data: { code: `${tag}-ONCE`, type: "fixed", value: 100, active: true, minOrderCents: 0, maxUses: 1 } });
  made.coupons.push(once.id);
  const raced = await Promise.all([
    placeOrder({ items: line(qty), couponCode: once.code }),
    placeOrder({ items: line(qty), couponCode: once.code }),
  ]);
  const applied = raced.filter((r) => (r.body.discountCents ?? 0) > 0).length;
  const onceAfter = await db.coupon.findUnique({ where: { id: once.id } });
  check("a one-use coupon is applied to exactly one of two simultaneous orders",
    applied === 1, `${applied} orders got the discount`);
  check("  ...and usedCount stops at maxUses",
    onceAfter.usedCount === 1, `usedCount is ${onceAfter.usedCount}`);
} finally {
  // Delete orders first: their items reference products, and the order rows are what a human
  // would otherwise find sitting in admin.
  if (made.orderNumbers.length) {
    const orders = await db.order.findMany({ where: { number: { in: made.orderNumbers } }, select: { id: true } });
    const ids = orders.map((o) => o.id);
    await db.orderEvent.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await db.order.deleteMany({ where: { id: { in: ids } } });
  }
  if (made.coupons.length) await db.coupon.deleteMany({ where: { id: { in: made.coupons } } });
  if (made.giftCards.length) await db.giftCard.deleteMany({ where: { id: { in: made.giftCards } } });
  console.log(`\n  cleaned up ${made.orderNumbers.length} orders, ${made.coupons.length} coupons, ${made.giftCards.length} gift cards`);
  await db.$disconnect();
}

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exit(fail ? 1 : 0);
