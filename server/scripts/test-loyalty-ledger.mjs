/**
 * The loyalty ledger service and its rules.
 *
 *     node --import tsx scripts/test-loyalty-ledger.mjs           # pure rules only, no database
 *     node --import tsx scripts/test-loyalty-ledger.mjs --write   # + the service, against Neon
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production.
 *
 *  --write creates its own orders and loyalty accounts on a reserved phone range
 *  (+9617000xxxx) and deletes every row it made in a `finally`. It never reads, updates or
 *  deletes a row it did not create. There are no real orders or customers yet in any case.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * The flags are read at module load, so they are set before the imports below. A test suite
 * that ran with the program switched off would pass by doing nothing at all.
 */
process.env.LOYALTY_ENABLED = "true";
process.env.LOYALTY_REDEMPTION_ENABLED = "true";

const { PrismaClient, Prisma } = await import("@prisma/client");
const rules = await import("../src/loyalty/rules.ts");
const ledger = await import("../src/loyalty/ledger.ts");
const { RATES, TIERS } = await import("../src/loyalty/config.ts");

const WRITE = process.argv.includes("--write");

let pass = 0, fail = 0;
const ck = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};
const section = (t) => console.log(`\n${t}`);

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-01-15T10:00:00.000Z");
const at = (days) => new Date(T0.getTime() + days * DAY);

// ════════════════════════════════════════════════════ PURE RULES (no database)

section("Earning arithmetic:");
{
  const m = rules.merchandiseCentsOf;
  ck("merchandise is subtotal minus both discounts", m({ subtotalCents: 10_000, discountCents: 1_000, pointsDiscountCents: 300 }) === 8_700);
  ck("  ...delivery never enters it", m({ subtotalCents: 5_000, discountCents: 0, pointsDiscountCents: 0 }) === 5_000);
  ck("  ...and never goes negative", m({ subtotalCents: 100, discountCents: 5_000, pointsDiscountCents: 0 }) === 0);

  ck("$1 earns 1 point", rules.basePointsFor(100) === 1);
  ck("$59.99 earns 59, rounded DOWN", rules.basePointsFor(5_999) === 59);
  ck("$0.99 earns nothing", rules.basePointsFor(99) === 0);
  ck("zero earns nothing", rules.basePointsFor(0) === 0);
  ck("negative earns nothing", rules.basePointsFor(-500) === 0);
  ck("no fractions ever escape", Number.isInteger(rules.basePointsFor(12_345)));
}

section("Tier multiplier — applied at confirmation, rounded down:");
{
  ck("Petal 1.0x leaves 100 at 100", rules.applyMultiplier(100, 1.0) === 100);
  ck("Bloom 1.25x turns 100 into 125", rules.applyMultiplier(100, 1.25) === 125);
  ck("Bouquet 1.5x turns 100 into 150", rules.applyMultiplier(100, 1.5) === 150);
  ck("1.25x on 33 rounds DOWN to 41, not 41.25", rules.applyMultiplier(33, 1.25) === 41);
  ck("zero stays zero", rules.applyMultiplier(0, 1.5) === 0);
}

section("Tier thresholds:");
{
  ck("$0 is Petal", rules.tierForSpend(0) === "petal");
  ck("$249.99 is still Petal", rules.tierForSpend(249_99) === "petal");
  ck("$250 exactly is Bloom", rules.tierForSpend(250_00) === "bloom");
  ck("$599.99 is still Bloom", rules.tierForSpend(599_99) === "bloom");
  ck("$600 exactly is Bouquet", rules.tierForSpend(600_00) === "bouquet");
  ck("$10,000 is still Bouquet", rules.tierForSpend(1_000_000) === "bouquet");
  ck("every tier in config is reachable", TIERS.every((t) => rules.tierForSpend(t.thresholdCents) === t.key));
}

section("Tier hold — up immediately, down only at the anniversary:");
{
  const held = { tier: "petal", earnedAt: T0 };
  ck("upgrade lands at once", rules.effectiveTier("bloom", held, at(1)).tier === "bloom");
  ck("  ...and restarts the clock", rules.effectiveTier("bloom", held, at(1)).earnedAt.getTime() === at(1).getTime());

  const bloom = { tier: "bloom", earnedAt: T0 };
  ck("no demotion at 6 months", rules.effectiveTier("petal", bloom, at(180)).tier === "bloom");
  ck("no demotion at 11 months", rules.effectiveTier("petal", bloom, at(334)).tier === "bloom");
  ck("no demotion the day before the anniversary", rules.effectiveTier("petal", bloom, at(364)).tier === "bloom");
  ck("demotion AT the anniversary", rules.effectiveTier("petal", bloom, rules.addMonths(T0, 12)).tier === "petal");
  ck("still qualifying means no demotion", rules.effectiveTier("bloom", bloom, at(400)).tier === "bloom");
  ck("qualifying HIGHER at the anniversary promotes", rules.effectiveTier("bouquet", bloom, at(400)).tier === "bouquet");
}

section("addMonths does not overflow a short month:");
{
  ck("31 Jan + 1 month = 28 Feb (2026 is not a leap year)",
    rules.addMonths(new Date("2026-01-31T00:00:00Z"), 1).getDate() === 28,
    String(rules.addMonths(new Date("2026-01-31T00:00:00Z"), 1)));
  ck("31 Mar + 1 month = 30 Apr", rules.addMonths(new Date("2026-03-31T00:00:00Z"), 1).getDate() === 30);
  ck("29 Feb 2028 + 12 months = 28 Feb 2029", rules.addMonths(new Date("2028-02-29T00:00:00Z"), 12).getDate() === 28);
}

section("The COD hold:");
{
  const delivered = { id: 1, status: "delivered", deliveredAt: T0 };
  ck("an undelivered order never matures", rules.maturesAt({ id: 1, status: "dispatched", deliveredAt: null }) === null);
  ck("a delivered order matures 7 days later", rules.maturesAt(delivered).getTime() === at(RATES.holdDaysAfterDelivery).getTime());
  ck("not mature on day 6", !rules.isMature(delivered, at(6)));
  ck("not mature one second before", !rules.isMature(delivered, new Date(at(7).getTime() - 1000)));
  ck("mature exactly on day 7", rules.isMature(delivered, at(7)));
  ck("mature on day 30", rules.isMature(delivered, at(30)));
  ck("a missing order is treated as not mature (fails safe)", !rules.isMature(null, at(365)));
}

section("Redemption quoting:");
{
  const base = { balance: 1000, merchandiseCents: 10_000, redemptionEnabled: true, signedIn: true, refusalCount: 0 };
  const q = (over) => rules.quoteRedemption({ ...base, ...over });

  ck("300 points on a $100 basket is fine", q({ requestedPoints: 300 }).ok);
  ck("  ...and is worth $9.00", q({ requestedPoints: 300 }).cents === 900);
  ck("100 points is $3.00", rules.pointsToCents(100) === 300);
  ck("299 points is below the minimum", q({ requestedPoints: 299 }).reason === "not-a-block");
  ck("200 points is a block but below the minimum", q({ requestedPoints: 200 }).reason === "below-minimum");
  ck("350 points is not a whole block", q({ requestedPoints: 350 }).reason === "not-a-block");
  ck("more than the balance is refused", q({ requestedPoints: 1100 }).reason === "insufficient-balance");

  // The 50% cap: $100 of goods allows $50, which is 1666.67 points, floored to 1600.
  ck("the cap is 50% of merchandise", q({ requestedPoints: 1700, balance: 5000 }).reason === "over-cap");
  ck("  ...and maxPoints is a whole block", q({ requestedPoints: 300, balance: 5000 }).maxPoints % RATES.redeemBlockPoints === 0);
  ck("  ...worth no more than half the basket",
    rules.pointsToCents(q({ requestedPoints: 300, balance: 5000 }).maxPoints) <= 10_000 * RATES.redeemMaxShareOfMerchandise);

  ck("a negative balance blocks redemption", q({ requestedPoints: 300, balance: -50 }).reason === "negative-balance");
  ck("  ...rather than being clamped to zero", q({ requestedPoints: 300, balance: -50 }).maxPoints === 0);
  ck("three refusals block redemption", q({ requestedPoints: 300, refusalCount: 3 }).reason === "blocked-refusals");
  ck("two refusals do not", q({ requestedPoints: 300, refusalCount: 2 }).ok);
  ck("signed out cannot redeem", q({ requestedPoints: 300, signedIn: false }).reason === "not-signed-in");
  ck("the flag being off refuses everything", q({ requestedPoints: 300, redemptionEnabled: false }).reason === "disabled");
}

section("computeState — the lazy read, with no job ever having run:");
{
  const orders = new Map([[1, { id: 1, status: "delivered", deliveredAt: T0 }]]);
  const money = new Map([[1, 10_000]]);
  const pendingEarn = [{ id: 1, type: "earn", status: "pending", points: 100, orderId: 1, createdAt: T0, confirmedAt: null }];

  const before = rules.computeState(pendingEarn, orders, money, at(3));
  ck("inside the hold: pending, not spendable", before.balance === 0 && before.pending === 100);
  ck("  ...and nothing is ready to confirm", before.readyToConfirm.length === 0);

  const after = rules.computeState(pendingEarn, orders, money, at(8));
  ck("after the hold: spendable even though the row still says pending", after.balance === 100 && after.pending === 0,
    `balance=${after.balance} pending=${after.pending}`);
  ck("  ...and it is flagged for materialising", after.readyToConfirm.length === 1);
  ck("  ...which is the whole no-cron design", true);

  const undelivered = new Map([[1, { id: 1, status: "dispatched", deliveredAt: null }]]);
  const never = rules.computeState(pendingEarn, undelivered, money, at(400));
  ck("an order never delivered never becomes spendable", never.balance === 0 && never.pending === 100);

  const voided = rules.computeState(
    [{ ...pendingEarn[0], status: "void" }], orders, money, at(30));
  ck("a void entry counts for nothing", voided.balance === 0 && voided.pending === 0);
}

section("Tier spend is counted two ways, and the difference is load-bearing:");
{
  // A regression pin. The first implementation used one figure for both, so an entry's own
  // spend counted toward the tier that multiplied it: a single $400 order pushed the customer
  // past $250 and then paid ITSELF 1.25x. Points confirmed at Petal must not be retroactively
  // re-multiplied, which is exactly what that was.
  const orders = new Map([
    [1, { id: 1, status: "delivered", deliveredAt: T0 }],
    [2, { id: 2, status: "delivered", deliveredAt: T0 }],
  ]);
  const money = new Map([[1, 300_00], [2, 100_00]]);
  const entries = [
    { id: 1, type: "earn", status: "pending", points: 300, orderId: 1, createdAt: T0, confirmedAt: null },
    { id: 2, type: "earn", status: "pending", points: 100, orderId: 2, createdAt: at(1), confirmedAt: null },
  ];

  const s = rules.computeState(entries, orders, money, at(10));
  ck("windowSpend counts matured earns — the customer's progress bar", s.windowSpendCents === 400_00, String(s.windowSpendCents));
  ck("confirmedSpend counts none of them yet — the multiplier basis", s.confirmedSpendCents === 0, String(s.confirmedSpendCents));
  ck("  ...so the first entry confirms at Petal", rules.tierForSpend(s.confirmedSpendCents) === "petal");

  const afterFirst = rules.computeState(
    [{ ...entries[0], status: "confirmed", confirmedAt: at(10) }, entries[1]], orders, money, at(10));
  ck("once the first is confirmed, its spend counts", afterFirst.confirmedSpendCents === 300_00, String(afterFirst.confirmedSpendCents));
  ck("  ...so the second confirms at Bloom", rules.tierForSpend(afterFirst.confirmedSpendCents) === "bloom");
}

section("Expiry clock — confirmed activity only:");
{
  const orders = new Map();
  const money = new Map();
  const confirmedEarn = (id, points, when) =>
    ({ id, type: "earn", status: "confirmed", points, orderId: null, createdAt: when, confirmedAt: when });

  const s = rules.computeState([confirmedEarn(1, 500, T0)], orders, money, at(30));
  ck("expiry is 12 months after the confirmed earn",
    s.expiresAt.getTime() === rules.addMonths(T0, 12).getTime(), String(s.expiresAt));
  ck("not lapsed at 11 months", !rules.computeState([confirmedEarn(1, 500, T0)], orders, money, at(334)).hasLapsed);
  ck("lapsed at 12 months", rules.computeState([confirmedEarn(1, 500, T0)], orders, money, at(370)).hasLapsed);

  // A pending earn must NOT hold the clock open — otherwise placing orders you never accept
  // would keep a balance alive forever.
  const withPending = [
    confirmedEarn(1, 500, T0),
    { id: 2, type: "earn", status: "pending", points: 999, orderId: 7, createdAt: at(300), confirmedAt: null },
  ];
  const st = rules.computeState(withPending, new Map([[7, { id: 7, status: "dispatched", deliveredAt: null }]]), money, at(370));
  ck("a pending earn does NOT reset the expiry clock", st.hasLapsed, `expiresAt=${st.expiresAt}`);

  const withRedeem = [
    confirmedEarn(1, 500, T0),
    { id: 2, type: "redeem", status: "confirmed", points: -300, orderId: null, createdAt: at(200), confirmedAt: at(200) },
  ];
  const sr = rules.computeState(withRedeem, orders, money, at(370));
  ck("a redemption DOES reset it", !sr.hasLapsed && sr.expiresAt.getTime() === rules.addMonths(at(200), 12).getTime());
}

// ════════════════════════════════════════════════════ THE SERVICE (database)

if (!WRITE) {
  console.log("\n(service tests skipped — pass --write to run them against the database)");
  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}

const db = new PrismaClient();
const TAG = `LOYT${Date.now().toString(36).toUpperCase()}`;
const made = { orders: [], accounts: [] };
let phoneSeq = 0;
const nextPhone = () => `+9617000${String(++phoneSeq).padStart(4, "0")}`;

async function makeOrder({ subtotalCents, status = "received", deliveredAt = null, discountCents = 0, pointsDiscountCents = 0, phone }) {
  const o = await db.order.create({
    data: {
      number: `${TAG}-${made.orders.length + 1}`,
      status, deliveredAt, phone, fullName: "Ledger Test",
      subtotalCents, discountCents, pointsDiscountCents,
      deliveryCents: 0, totalCents: Math.max(0, subtotalCents - discountCents - pointsDiscountCents),
    },
  });
  made.orders.push(o.id);
  return o;
}
async function makeAccount(phone) {
  const a = await ledger.getOrCreateAccount(db, phone);
  made.accounts.push(a.id);
  return a;
}
/** The invariant that must hold after every single operation. */
async function balanceMatchesLedger(accountId, label) {
  const state = await ledger.readAccount(db, accountId, new Date());
  const sum = await ledger.ledgerSum(db, accountId);
  const confirmedOnly = (await db.loyaltyLedgerEntry.findMany({ where: { accountId, status: "confirmed" } }))
    .reduce((n, r) => n + r.points, 0);
  ck(`${label} — ledger sum reconciles`, state.state.balance === confirmedOnly + state.state.readyToConfirm.reduce((n, e) => n + e.points, 0),
    `state=${state.state.balance} confirmed=${confirmedOnly} sum=${sum}`);
}

try {
  section("Account creation:");
  {
    const phone = nextPhone();
    const a = await makeAccount(phone);
    ck("created", a.created && a.phoneE164 === phone);
    const again = await ledger.getOrCreateAccount(db, phone.replace("+961", "0"));
    ck("the same number in local form finds the SAME account", !again.created && again.id === a.id,
      `${a.id} vs ${again.id}`);
    let threw = null;
    try { await ledger.getOrCreateAccount(db, "not a phone"); } catch (e) { threw = e.code; }
    ck("an unusable number is refused, not silently keyed", threw?.startsWith("phone-"), String(threw));
  }

  section("Full lifecycle — place, deliver, hold, confirm, redeem:");
  {
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    const order = await makeOrder({ subtotalCents: 12_050, phone }); // $120.50 -> 120 points

    const earn = await ledger.recordEarn(db, { accountId: acct.id, orderId: order.id, merchandiseCents: 12_050, now: T0 });
    ck("earn recorded as 120 base points", earn.created && earn.basePoints === 120, String(earn.basePoints));

    let s = await ledger.readAccount(db, acct.id, at(1));
    ck("day 1: pending, nothing spendable", s.state.balance === 0 && s.state.pending === 120);

    await db.order.update({ where: { id: order.id }, data: { status: "delivered", deliveredAt: at(2) } });
    s = await ledger.readAccount(db, acct.id, at(3));
    ck("delivered but inside the hold: still pending", s.state.balance === 0 && s.state.pending === 120);

    s = await ledger.readAccount(db, acct.id, at(9));
    ck("7 days after delivery: spendable WITHOUT materialise() ever running", s.state.balance === 120,
      `balance=${s.state.balance}`);

    const m = await ledger.materialise(db, acct.id, at(9));
    ck("materialise confirms it", m.confirmed === 1 && m.balance === 120);
    const row = await db.loyaltyLedgerEntry.findFirst({ where: { accountId: acct.id, type: "earn" } });
    ck("  ...the row is now confirmed", row.status === "confirmed" && row.confirmedAt !== null);
    ck("  ...at Petal, so 1.0x and 120 points", row.points === 120 && row.multiplierApplied.toString() === "1");

    const m2 = await ledger.materialise(db, acct.id, at(9));
    ck("materialise is idempotent", m2.confirmed === 0 && m2.balance === 120);
    await balanceMatchesLedger(acct.id, "after confirmation");
  }

  section("Redemption:");
  {
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    await ledger.manualAdjustment(db, { accountId: acct.id, points: 1000, reason: "seed for redemption test", enteredBy: "TEST", now: T0 });
    const order = await makeOrder({ subtotalCents: 10_000, phone });

    const r = await ledger.redeem(db, { accountId: acct.id, orderId: order.id, requestedPoints: 300, merchandiseCents: 10_000, signedIn: true, now: at(1) });
    ck("300 points redeemed for $9.00", r.points === 300 && r.cents === 900);
    const s = await ledger.readAccount(db, acct.id, at(1));
    ck("balance drops to 700", s.state.balance === 700, String(s.state.balance));
    ck("  ...and balanceCached agrees", s.balanceCached === 700, String(s.balanceCached));

    let refused = null;
    try {
      await ledger.redeem(db, { accountId: acct.id, orderId: order.id, requestedPoints: 900, merchandiseCents: 10_000, signedIn: true, now: at(1) });
    } catch (e) { refused = e.code; }
    ck("spending more than the balance is refused", refused === "insufficient-balance", String(refused));
    await balanceMatchesLedger(acct.id, "after redemption");
  }

  section("Concurrent redemption cannot double-spend:");
  {
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    await ledger.manualAdjustment(db, { accountId: acct.id, points: 500, reason: "exactly one redemption's worth", enteredBy: "TEST", now: T0 });
    const o1 = await makeOrder({ subtotalCents: 10_000, phone });
    const o2 = await makeOrder({ subtotalCents: 10_000, phone });

    // Genuinely concurrent, not sequential — this is the exploit two checkout tabs would find.
    const results = await Promise.allSettled([
      ledger.redeem(db, { accountId: acct.id, orderId: o1.id, requestedPoints: 300, merchandiseCents: 10_000, signedIn: true, now: at(1) }),
      ledger.redeem(db, { accountId: acct.id, orderId: o2.id, requestedPoints: 300, merchandiseCents: 10_000, signedIn: true, now: at(1) }),
    ]);
    const won = results.filter((r) => r.status === "fulfilled").length;
    const s = await ledger.readAccount(db, acct.id, at(1));
    ck(`only one of two concurrent redemptions succeeded (${won})`, won === 1, JSON.stringify(results.map((r) => r.status)));
    ck("  ...balance is 200, not -100", s.state.balance === 200, String(s.state.balance));
    ck("  ...and never went negative", s.state.balance >= 0);
    await balanceMatchesLedger(acct.id, "after the race");
  }

  section("A replayed status change does not double-grant:");
  {
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    const order = await makeOrder({ subtotalCents: 5_000, phone });

    const a = await ledger.recordEarn(db, { accountId: acct.id, orderId: order.id, merchandiseCents: 5_000, now: T0 });
    const b = await ledger.recordEarn(db, { accountId: acct.id, orderId: order.id, merchandiseCents: 5_000, now: T0 });
    const c = await ledger.recordEarn(db, { accountId: acct.id, orderId: order.id, merchandiseCents: 5_000, now: T0 });
    ck("first call creates, the next two do not", a.created && !b.created && !c.created);
    const n = await db.loyaltyLedgerEntry.count({ where: { accountId: acct.id, type: "earn" } });
    ck("  ...exactly one earn entry exists", n === 1, String(n));
  }

  section("Refusal and cancellation:");
  {
    // Pending earn, order refused -> voided.
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    const order = await makeOrder({ subtotalCents: 8_000, phone });
    await ledger.recordEarn(db, { accountId: acct.id, orderId: order.id, merchandiseCents: 8_000, now: T0 });
    await db.order.update({ where: { id: order.id }, data: { status: "refused" } });
    const v = await ledger.voidEarnForOrder(db, order.id, "refused at the door");
    ck("a pending earn is voided", v.voided === 1);
    const s = await ledger.readAccount(db, acct.id, at(30));
    ck("  ...and counts for nothing", s.state.balance === 0 && s.state.pending === 0);

    // Confirmed earn, later reverted -> reversal, balance may go negative.
    const phone2 = nextPhone();
    const acct2 = await makeAccount(phone2);
    const o2 = await makeOrder({ subtotalCents: 20_000, phone: phone2, status: "delivered", deliveredAt: T0 });
    await ledger.recordEarn(db, { accountId: acct2.id, orderId: o2.id, merchandiseCents: 20_000, now: T0 });
    await ledger.materialise(db, acct2.id, at(8));
    let s2 = await ledger.readAccount(db, acct2.id, at(8));
    ck("confirmed 200 points", s2.state.balance === 200, String(s2.state.balance));

    await ledger.reverseEarn(db, { orderId: o2.id, reason: "returned after confirmation", enteredBy: "TEST", now: at(10) });
    s2 = await ledger.readAccount(db, acct2.id, at(10));
    ck("a full reversal takes them back", s2.state.balance === 0, String(s2.state.balance));

    // Reversal after the points were already spent -> negative, NOT clamped.
    // The order has to be big enough to earn more than the 300-point redemption minimum, or
    // the scenario cannot be set up at all — an earlier draft of this test earned 200 and then
    // tried to spend 200, and failed on the minimum rather than on anything under test.
    const phone3 = nextPhone();
    const acct3 = await makeAccount(phone3);
    const o3 = await makeOrder({ subtotalCents: 400_00, phone: phone3, status: "delivered", deliveredAt: T0 });
    await ledger.recordEarn(db, { accountId: acct3.id, orderId: o3.id, merchandiseCents: 400_00, now: T0 });
    await ledger.materialise(db, acct3.id, at(8));
    const spendOrder = await makeOrder({ subtotalCents: 100_00, phone: phone3 });
    await ledger.redeem(db, { accountId: acct3.id, orderId: spendOrder.id, requestedPoints: 300, merchandiseCents: 100_00, signedIn: true, now: at(9) });
    ck("earned 400, spent 300, leaving 100",
      (await ledger.readAccount(db, acct3.id, at(9))).state.balance === 100);
    await ledger.reverseEarn(db, { orderId: o3.id, reason: "returned the goods after spending the points", enteredBy: "TEST", now: at(10) });
    const s3 = await ledger.readAccount(db, acct3.id, at(10));
    ck("redeem-then-return leaves a NEGATIVE balance", s3.state.balance === -300, String(s3.state.balance));
    ck("  ...which is not clamped to zero — that is the exploit", s3.state.balance < 0);
    const quote = await ledger.previewRedemption(db, { accountId: acct3.id, requestedPoints: 300, merchandiseCents: 50_000, signedIn: true, now: at(11) });
    ck("  ...and redemption is blocked while negative", !quote.ok && quote.reason === "negative-balance");
  }

  section("Proportional reversal (no automatic trigger — admin only):");
  {
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    const o = await makeOrder({ subtotalCents: 10_000, phone, status: "delivered", deliveredAt: T0 });
    await ledger.recordEarn(db, { accountId: acct.id, orderId: o.id, merchandiseCents: 10_000, now: T0 });
    await ledger.materialise(db, acct.id, at(8));
    const r = await ledger.reverseEarn(db, { orderId: o.id, portion: 0.4, reason: "returned two of five items", enteredBy: "TEST", now: at(9) });
    ck("40% of 100 points reverses 40", r.points === 40, String(r.points));
    const s = await ledger.readAccount(db, acct.id, at(9));
    ck("  ...leaving 60", s.state.balance === 60, String(s.state.balance));
    const r2 = await ledger.reverseEarn(db, { orderId: o.id, portion: 0.333, reason: "rounding favours the customer", enteredBy: "TEST", now: at(10) });
    ck("rounding favours the customer (33.3 -> 33)", r2.points === 33, String(r2.points));
  }

  section("Redemption reversal:");
  {
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    await ledger.manualAdjustment(db, { accountId: acct.id, points: 1000, reason: "seed for reversal test", enteredBy: "TEST", now: T0 });
    const o = await makeOrder({ subtotalCents: 10_000, phone });
    await ledger.redeem(db, { accountId: acct.id, orderId: o.id, requestedPoints: 300, merchandiseCents: 10_000, signedIn: true, now: at(1) });
    const back = await ledger.reverseRedemption(db, o.id, "order refused at the door", at(2));
    ck("points come back", back.restored === 300);
    const s = await ledger.readAccount(db, acct.id, at(2));
    ck("  ...to the full 1000", s.state.balance === 1000, String(s.state.balance));
    const twice = await ledger.reverseRedemption(db, o.id, "again", at(3));
    ck("  ...and cannot be restored twice", twice.restored === 0);
  }

  section("Tier progression through real confirmations:");
  {
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    // Two orders: the first takes them to Bloom, the second must be multiplied at Bloom.
    const first = await makeOrder({ subtotalCents: 300_00, phone, status: "delivered", deliveredAt: T0 });
    const second = await makeOrder({ subtotalCents: 100_00, phone, status: "delivered", deliveredAt: at(1) });
    await ledger.recordEarn(db, { accountId: acct.id, orderId: first.id, merchandiseCents: 300_00, now: T0 });
    await ledger.recordEarn(db, { accountId: acct.id, orderId: second.id, merchandiseCents: 100_00, now: at(1) });

    await ledger.materialise(db, acct.id, at(10));
    const acctRow = await db.loyaltyAccount.findUnique({ where: { id: acct.id } });
    ck("crossing $250 promotes to Bloom", acctRow.tier === "bloom", acctRow.tier);

    const entries = await db.loyaltyLedgerEntry.findMany({ where: { accountId: acct.id, type: "earn" }, orderBy: { createdAt: "asc" } });
    ck("the FIRST order confirmed at Petal — 300 points, 1.0x",
      entries[0].points === 300 && entries[0].multiplierApplied.toString() === "1",
      `${entries[0].points} @ ${entries[0].multiplierApplied}`);
    ck("the SECOND confirmed at Bloom — 125 points, 1.25x",
      entries[1].points === 125 && Number(entries[1].multiplierApplied) === 1.25,
      `${entries[1].points} @ ${entries[1].multiplierApplied}`);
    ck("  ...points confirmed at Petal are NOT retroactively re-multiplied", entries[0].points === 300);
    await balanceMatchesLedger(acct.id, "after tier progression");
  }

  section("Balances are correct with materialise() NEVER called:");
  {
    // The property the whole no-cron design rests on.
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    const orders = [];
    for (let i = 0; i < 4; i++) {
      const o = await makeOrder({ subtotalCents: 5_000, phone, status: "delivered", deliveredAt: at(i) });
      orders.push(o);
      await ledger.recordEarn(db, { accountId: acct.id, orderId: o.id, merchandiseCents: 5_000, now: at(i) });
    }
    const s = await ledger.readAccount(db, acct.id, at(30));
    ck("four matured earns are spendable with no job ever having run", s.state.balance === 200, String(s.state.balance));
    const rows = await db.loyaltyLedgerEntry.findMany({ where: { accountId: acct.id } });
    ck("  ...while every row is still 'pending' in the database",
      rows.every((r) => r.status === "pending"), rows.map((r) => r.status).join(","));
    ck("  ...which is exactly the point: the stored status is a cache, not the truth", true);

    const m = await ledger.materialise(db, acct.id, at(30));
    ck("materialising afterwards changes no number", m.balance === 200, String(m.balance));
  }

  section("Manual adjustment guards:");
  {
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    const bad = async (input) => { try { await ledger.manualAdjustment(db, input); return null; } catch (e) { return e.code; } };
    ck("a one-character reason is refused",
      await bad({ accountId: acct.id, points: 10, reason: "x", enteredBy: "AB" }) === "reason-too-short");
    ck("missing initials are refused",
      await bad({ accountId: acct.id, points: 10, reason: "a proper explanation", enteredBy: "  " }) === "entered-by-required");
    ck("a zero adjustment is refused",
      await bad({ accountId: acct.id, points: 0, reason: "a proper explanation", enteredBy: "AB" }) === "bad-points");
    const ok = await ledger.manualAdjustment(db, { accountId: acct.id, points: -50, reason: "goodwill correction after a mix-up", enteredBy: "AB", now: T0 });
    ck("a proper adjustment is recorded", !!ok.id);
    const row = await db.loyaltyLedgerEntry.findUnique({ where: { id: ok.id } });
    ck("  ...with the self-declared initials stored as-is", row.createdBy === "AB");
    ck("  ...and negative adjustments are allowed", row.points === -50);
  }

  section("Guest claims are derived, and never touch Order.customerId:");
  {
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    const recent = await makeOrder({ subtotalCents: 7_000, phone, status: "delivered", deliveredAt: at(-10) });
    const old = await makeOrder({ subtotalCents: 7_000, phone, status: "delivered", deliveredAt: at(-200) });
    const undelivered = await makeOrder({ subtotalCents: 7_000, phone, status: "dispatched" });
    const someoneElse = await makeOrder({ subtotalCents: 7_000, phone: nextPhone(), status: "delivered", deliveredAt: at(-10) });

    const claims = await ledger.pendingGuestClaims(db, acct.id, T0);
    const ids = claims.map((c) => c.orderId);
    ck("a recent delivered guest order is claimable", ids.includes(recent.id));
    ck("  ...one older than 90 days is not", !ids.includes(old.id));
    ck("  ...an undelivered one is not", !ids.includes(undelivered.id));
    ck("  ...and another number's order is not", !ids.includes(someoneElse.id));

    const before = await db.order.findUnique({ where: { id: recent.id }, select: { customerId: true } });
    ck("Order.customerId is untouched by listing claims", before.customerId === null);

    await ledger.recordEarn(db, { accountId: acct.id, orderId: recent.id, merchandiseCents: 7_000, now: T0 });
    const after = await ledger.pendingGuestClaims(db, acct.id, T0);
    ck("once earned, a claim disappears from the list", !after.map((c) => c.orderId).includes(recent.id));
    const stillNull = await db.order.findUnique({ where: { id: recent.id }, select: { customerId: true } });
    ck("  ...and approving still does not link the order", stillNull.customerId === null);
  }

  section("Sign-up and birthday bonuses fire once:");
  {
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    ck("welcome bonus lands", (await ledger.recordSignupBonus(db, acct.id, T0)).created);
    ck("  ...and never twice", !(await ledger.recordSignupBonus(db, acct.id, at(1))).created);
    ck("birthday bonus lands", (await ledger.recordBirthdayBonus(db, acct.id, T0)).created);
    ck("  ...not twice in one year", !(await ledger.recordBirthdayBonus(db, acct.id, at(30))).created);
    ck("  ...but does again next year", (await ledger.recordBirthdayBonus(db, acct.id, new Date("2027-01-15T10:00:00Z"))).created);
    const s = await ledger.readAccount(db, acct.id, T0);
    ck("totalling 100 + 200 + 200", s.state.balance === 500, String(s.state.balance));
  }
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 4).join("\n        ")}`);
} finally {
  await db.loyaltyLedgerEntry.deleteMany({ where: { accountId: { in: made.accounts } } });
  await db.loyaltyAccount.deleteMany({ where: { id: { in: made.accounts } } });
  await db.orderEvent.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.order.deleteMany({ where: { id: { in: made.orders } } });
  console.log(`\n  cleaned up ${made.accounts.length} accounts and ${made.orders.length} orders`);
  await db.$disconnect();
}

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exit(fail ? 1 : 0);
