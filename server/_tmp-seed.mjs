const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const stamp = Date.now().toString(36).toUpperCase();
const o = await db.order.create({
  data: {
    number: `DRILL${stamp}`, status: "delivered", deliveredAt: new Date("2026-07-15T09:30:00Z"),
    fullName: "Drill Subject", phone: "+96171900001", email: "drill@tulipglam-test.invalid",
    area: "Beirut", city: "Beirut", address: "Somewhere 12",
    subtotalCents: 87_50, discountCents: 5_00, pointsDiscountCents: 9_00, giftCardCents: 0,
    deliveryCents: 3_00, totalCents: 76_50, paymentMethod: "cod",
    items: { create: [{ name: "Drill Serum", variantLabel: "30ml", qty: 3, priceCents: 29_17 }] },
  },
});
const acct = await db.loyaltyAccount.create({ data: { phoneE164: "+96171900001", tier: "bloom" } });
await db.loyaltyLedgerEntry.create({
  data: {
    accountId: acct.id, orderId: o.id, type: "earn", status: "confirmed",
    points: 98, multiplierApplied: 1.25, reason: "drill fixture",
    confirmedAt: new Date("2026-07-22T09:30:00Z"),
  },
});
console.log(`seeded order ${o.number} ($76.50, awkward cents) + a 1.25x ledger entry`);
console.log(JSON.stringify({ orderId: o.id, accountId: acct.id }));
await db.$disconnect();
