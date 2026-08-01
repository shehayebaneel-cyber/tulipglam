/**
 * Dispatch — what a delivery driver is told to collect.
 *
 *     node --import tsx scripts/test-dispatch.mjs --write
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  Creates two orders on a reserved phone range and deletes them.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * The case under test is the one that goes wrong: an order carrying a coupon, points AND a
 * gift card, where the cash at the door is nothing like what the bag looks worth. A driver who
 * cannot see why will collect the bag's value and argue with the customer.
 */
const { PrismaClient } = await import("@prisma/client");
const { manifest, dispatchLine, courierMessage } = await import("../src/dispatch.ts");

const db = new PrismaClient();
let pass = 0, fail = 0;
const ck = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${ok ? "" : "  " + x}`); };
const made = [];

try {
  const o = await db.order.create({
    data: {
      number: `DSP${Date.now().toString(36).toUpperCase()}`, status: "out_for_delivery",
      fullName: "Dispatch Test", phone: "+96171500001", whatsapp: "+96171500001",
      area: "Beirut", city: "Beirut", address: "Hamra St, building 5", notes: "Ring twice",
      subtotalCents: 60_00, discountCents: 5_00, pointsDiscountCents: 9_00, giftCardCents: 6_00,
      deliveryCents: 3_00, totalCents: 43_00, couponCode: "WELCOME10", paymentMethod: "cod",
      items: { create: [{ name: "Lip Colour", variantLabel: "Rosewood", qty: 2, priceCents: 30_00 }] },
    },
  });
  made.push(o.id);

  console.log("\nThe number at the door:");
  const line = await dispatchLine(db, o.id);
  ck("collect is the order total, never recomputed here", line.collectCents === 43_00, String(line.collectCents));
  ck("  ...formatted once, on the server", line.collectLabel === "$43.00", line.collectLabel);
  ck("  ...and every reduction is spelled out",
    line.whyDifferent.includes("coupon") && line.whyDifferent.includes("points") && line.whyDifferent.includes("gift card"),
    line.whyDifferent);

  const m = await manifest(db);
  ck("it appears on the run", m.outForDelivery.some((x) => x.id === o.id));
  ck("  ...its cash is in the expected total", m.expectedCashCents >= 43_00);
  ck("  ...and it is counted as one to watch", m.discountedCount >= 1);

  console.log("\nThe courier message:");
  const msg = courierMessage(line);
  ck("the amount comes before anything else", msg.split("\n")[1].startsWith("COLLECT: $43.00"), msg.split("\n")[1]);
  ck("  ...no item prices or coupon codes reach the driver", !msg.includes("30.00") && !msg.includes("WELCOME10"));
  ck("  ...the customer's delivery note survives", msg.includes("Ring twice"));

  console.log("\nA plain order reads plainly:");
  const plain = await db.order.create({
    data: {
      number: `DSP${Date.now().toString(36).toUpperCase()}B`, status: "packed",
      fullName: "Plain", phone: "+96171500002", area: "Jounieh", city: "Jounieh", address: "Main St",
      subtotalCents: 20_00, discountCents: 0, pointsDiscountCents: 0, giftCardCents: 0,
      deliveryCents: 3_00, totalCents: 23_00, paymentMethod: "cod",
      items: { create: [{ name: "Serum", variantLabel: "", qty: 1, priceCents: 20_00 }] },
    },
  });
  made.push(plain.id);
  const p = await dispatchLine(db, plain.id);
  ck("says only what applies", p.whyDifferent === "$3.00 delivery", p.whyDifferent);
  ck("  ...and collects goods plus delivery", p.collectCents === 23_00);

  console.log("\nA delivered order is off the run:");
  await db.order.update({ where: { id: plain.id }, data: { status: "delivered" } });
  const after = await manifest(db);
  ck("delivered orders do not stay on the sheet", !after.outForDelivery.some((x) => x.id === plain.id));
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 4).join("\n        ")}`);
} finally {
  await db.orderItem.deleteMany({ where: { orderId: { in: made } } });
  await db.order.deleteMany({ where: { id: { in: made } } });
  await db.$disconnect();
  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}
