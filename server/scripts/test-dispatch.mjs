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
const { manifest, dispatchLine, courierMessage, reconcile } = await import("../src/dispatch.ts");

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
  // THE LAUNCH-DAY CASE. Every order on day one looks exactly like this: no coupon, no points,
  // no gift card. The column is headed "why this is not the price of the goods", and for an
  // ordinary order the honest answer is that there is nothing to say. It used to print
  // "$3.00 delivery" on every single row, which trains the reader to skip the column — and the
  // one row that ever needs it is the points order this module was built for.
  ck("an ordinary order needs no explanation at all", p.whyDifferent === "", `got "${p.whyDifferent}"`);
  ck("  ...and still collects goods plus delivery", p.collectCents === 23_00, `${p.collectCents}`);
  ck("  ...and the message carries no parenthetical either", !courierMessage(p).includes("("), courierMessage(p));
  ck("  ...while the amount is still the first thing after the order number",
    courierMessage(p).split("\n")[1] === "COLLECT: $23.00 cash", courierMessage(p).split("\n")[1]);

  console.log("\nA delivered order is off the run:");
  await db.order.update({ where: { id: plain.id }, data: { status: "delivered" } });
  const after = await manifest(db);
  ck("delivered orders do not stay on the sheet", !after.outForDelivery.some((x) => x.id === plain.id));

  // ════════════════════════════════════════════════════════════════════════════════════
  //  A MIXED ROUND — "does the total match what is actually in my pocket?"
  // ════════════════════════════════════════════════════════════════════════════════════
  //
  // Three parcels go out. One is paid in full, one is refused at the door, one was partly
  // paid with points before the van left. The requirement, in the owner's words, is that the
  // run's cash total reconciles to what is actually in their pocket — so the assertion is
  // written against a hand-counted figure, not against a second call to the same code.

  console.log("\nA mixed round: one paid, one refused, one settled partly in points:");
  const roundStart = new Date(Date.now() - 60_000);

  const mk = async (name, opts) => {
    const o = await db.order.create({
      data: {
        number: `TG-MIX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        status: "out_for_delivery",
        fullName: name, phone: "+96171500003", whatsapp: "+96171500003",
        area: "Jounieh", city: "Jounieh", address: "Main St", paymentMethod: "cod",
        subtotalCents: opts.subtotal, discountCents: 0,
        pointsDiscountCents: opts.points ?? 0, giftCardCents: 0,
        deliveryCents: opts.delivery, totalCents: opts.total,
        items: { create: [{ name: "Thing", variantLabel: "", qty: 1, priceCents: opts.subtotal }] },
      },
    });
    made.push(o.id);
    return o;
  };

  // Hand-counted, deliberately. These are the notes that would physically be in the pocket.
  const paid = await mk("Paid In Full", { subtotal: 4000, delivery: 300, total: 4300 });
  const refusedO = await mk("Refused At Door", { subtotal: 2500, delivery: 300, total: 2800 });
  const pointsO = await mk("Spent Points", { subtotal: 6000, delivery: 300, points: 900, total: 5400 });

  /**
   * THE MORNING, before anything has been settled.
   *
   * Counted first, deliberately. The three parcels above are loaded and out; nothing has been
   * delivered or refused yet. An early version returned a block of zeroes in exactly this state
   * — "still out: 0" with the van on the road — and every other test here happened to settle an
   * order before counting, so none of them saw it. It took looking at the screen.
   */
  const morning = await reconcile(db, roundStart);
  ck("before anything settles, the parcels on the road are still counted", morning.stillOutCount >= 3, `${morning.stillOutCount}`);
  ck("  ...with their money", morning.stillOutCents >= 4300 + 2800 + 5400, `${morning.stillOutCents}`);
  ck("  ...and none of it is reported as collected", morning.collectedCents === 0);
  ck("  ...while the accounted-for line still covers the run", morning.accountedForCents >= 12500, `${morning.accountedForCents}`);

  const settle = (id, status) =>
    db.order.update({ where: { id }, data: { status, events: { create: { status, note: "round" } } } });

  await settle(paid.id, "delivered");
  await settle(refusedO.id, "refused");
  await settle(pointsO.id, "delivered");

  const r = await reconcile(db, roundStart);

  // $43.00 from the first + $54.00 from the points order = $97.00. The refused parcel came
  // back, so it contributes nothing — that is not a shortfall, it is simply not a payment.
  const inPocket = 4300 + 5400;
  ck("the collected total is the cash actually taken", r.collectedCents === inPocket, `${r.collectedCents} vs ${inPocket}`);
  ck("  ...which reads as $97.00", r.collectedLabel === "$97.00", r.collectedLabel);
  ck("the refused parcel contributes nothing to the cash", !r.delivered.some((d) => d.number === refusedO.number));
  ck("  ...but is listed, with the amount that did not arrive", r.refused.some((x) => x.number === refusedO.number && x.wouldHaveBeenCents === 2800));
  ck("  ...and named as refused, not lumped in with cancelled", r.refused.find((x) => x.number === refusedO.number)?.status === "Refused at Door");

  // The points order is the one that would be double-counted by a naive total: expecting the
  // $63.00 the goods and delivery are worth means asking for $9.00 the customer already paid
  // with points at checkout.
  const pointsRow = r.delivered.find((d) => d.number === pointsO.number);
  ck("the points order counts its DISCOUNTED total, not its face value", pointsRow?.collectedCents === 5400, `${pointsRow?.collectedCents}`);
  ck("  ...and how much of it was settled in points is stated", r.paidWithPointsCents === 900, `${r.paidWithPointsCents}`);
  ck("  ...so nothing asks for the same $9.00 twice", r.collectedCents + r.paidWithPointsCents === 4300 + 6300);

  // The line that makes it checkable in ten seconds against the morning's sheet.
  ck("collected + refused + still out accounts for the whole run",
    r.accountedForCents === r.collectedCents + r.refusedCents + r.stillOutCents,
    `${r.accountedForCents}`);
  ck("and a parcel still with the driver is not counted as missing money",
    !r.refused.some((x) => x.number === paid.number) && r.stillOutCents >= 0);

  // A window that excludes the round must exclude its money, or a fixed address typo next
  // week would inflate today's total.
  const later = await reconcile(db, new Date(Date.now() + 60_000));
  ck("a window after the round reports no cash", later.collectedCents === 0, `${later.collectedCents}`);
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
