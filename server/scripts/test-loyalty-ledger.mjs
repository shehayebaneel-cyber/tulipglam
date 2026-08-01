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

// ── Fixture defaults are deliberately NON-IDENTITY ──────────────────────────────────
//
// The multiplier bug below survived a full test suite because every fixture used a Petal
// account, where the multiplier is 1.0 and multiplying by it is indistinguishable from not
// multiplying at all. An identity value turns a test into a tautology.
//
// So: accounts are Bloom or Bouquet unless the test is specifically about Petal, orders carry a
// non-zero discount, and no quantity is 1 where 2 would do. If you add a fixture here, pick
// values where getting the arithmetic wrong produces a different number.
const HELD_PETAL = { tier: "petal", earnedAt: T0 };
const HELD_BLOOM = { tier: "bloom", earnedAt: T0 };
const HELD_BOUQUET = { tier: "bouquet", earnedAt: T0 };

const order = (id, deliveredAt, status = "delivered") => [id, { id, status, deliveredAt }];
const earn = (id, points, orderId, when, over = {}) =>
  ({ id, type: "earn", status: "pending", points, orderId, createdAt: when, confirmedAt: null, ...over });

section("computeState — the lazy read, with no job ever having run:");
{
  const orders = new Map([order(1, T0)]);
  const money = new Map([[1, 10_000]]);
  const pendingEarn = [earn(1, 100, 1, T0)];

  const before = rules.computeState(pendingEarn, orders, money, HELD_PETAL, at(3));
  ck("inside the hold: pending, not spendable", before.balance === 0 && before.pending === 100);
  ck("  ...and nothing is planned", before.plan.confirm.length === 0);

  const after = rules.computeState(pendingEarn, orders, money, HELD_PETAL, at(8));
  ck("after the hold: spendable even though the row still says pending", after.balance === 100 && after.pending === 0,
    `balance=${after.balance} pending=${after.pending}`);
  ck("  ...and it is planned for materialising", after.plan.confirm.length === 1);
  ck("  ...at the same figure the read path already reported", after.plan.confirm[0].finalPoints === after.balance);

  const undelivered = new Map([order(1, null, "dispatched")]);
  const never = rules.computeState(pendingEarn, undelivered, money, HELD_PETAL, at(400));
  ck("an order never delivered never becomes spendable", never.balance === 0 && never.pending === 100);

  const voided = rules.computeState([earn(1, 100, 1, T0, { status: "void" })], orders, money, HELD_PETAL, at(30));
  ck("a void entry counts for nothing", voided.balance === 0 && voided.pending === 0);
}

section("The derived balance applies the multiplier — REGRESSION, this was live:");
{
  // A Bouquet customer's matured $600 order read as 600 points on the read path and 900 on the
  // write path, because only materialise() multiplied. The customer saw two thirds of what they
  // were owed until something happened to call a sweep that, by design, may never run.
  const orders = new Map([order(1, T0)]);
  const money = new Map([[1, 600_00]]);
  const entries = [earn(1, 600, 1, T0)];

  const bouquet = rules.computeState(entries, orders, money, HELD_BOUQUET, at(10));
  ck("a matured earn is spendable at the TIER rate, not the base rate", bouquet.balance === 900,
    `balance=${bouquet.balance}, expected 900 (600 x 1.5)`);
  ck("  ...and the plan says the same number", bouquet.plan.confirm[0].finalPoints === 900);
  ck("  ...so read and write cannot disagree", bouquet.balance === bouquet.plan.confirm[0].finalPoints);
  ck("  ...with the multiplier recorded for the audit trail", bouquet.plan.confirm[0].multiplier === 1.5);

  const bloom = rules.computeState(entries, orders, money, HELD_BLOOM, at(10));
  ck("Bloom gets 1.25x", bloom.balance === 750, `balance=${bloom.balance}`);
  const petal = rules.computeState(entries, orders, money, HELD_PETAL, at(10));
  ck("Petal gets the base points", petal.balance === 600);
}

section("An order cannot buy the tier that pays it — REGRESSION:");
{
  // The first implementation counted matured-but-unconfirmed spend toward the multiplier basis,
  // so a single $400 order pushed the customer past $250 and then paid ITSELF 1.25x.
  const orders = new Map([order(1, T0), order(2, at(1))]);
  const money = new Map([[1, 400_00], [2, 100_00]]);

  const alone = rules.computeState([earn(1, 400, 1, T0)], orders, money, HELD_PETAL, at(10));
  ck("a $400 order pays itself 1.0x, not 1.25x", alone.balance === 400, `balance=${alone.balance}`);
  ck("  ...though it does move the progress bar", alone.windowSpendCents === 400_00);
  ck("  ...and the tier it earned is now in force", alone.tier === "bloom");

  const both = rules.computeState([earn(1, 400, 1, T0), earn(2, 100, 2, at(1))], orders, money, HELD_PETAL, at(10));
  ck("the NEXT order gets the tier the first one bought", both.balance === 400 + 125,
    `balance=${both.balance}, expected 525 (400 at 1.0x, then 100 at 1.25x)`);
  ck("  ...ordered by maturity, not by row id", both.plan.confirm[0].tier === "petal" && both.plan.confirm[1].tier === "bloom");
}

section("Confirmation is stamped at MATURITY, not at sweep time — REGRESSION:");
{
  // Stamping `now` meant the act of running the sweep moved the expiry clock, so an account gave
  // different answers depending on whether anything had touched it. That is the scheduler
  // dependency this design exists to avoid, arriving through the back door.
  const orders = new Map([order(1, T0)]);
  const money = new Map([[1, 300_00]]);
  const entries = [earn(1, 300, 1, T0)];
  const maturity = rules.maturesAt({ id: 1, status: "delivered", deliveredAt: T0 });

  const early = rules.computeState(entries, orders, money, HELD_BLOOM, at(8));
  const late = rules.computeState(entries, orders, money, HELD_BLOOM, at(300));
  ck("confirmedAt is the maturity date whenever you look", early.plan.confirm[0].confirmedAt.getTime() === maturity.getTime());
  ck("  ...and does not move when you look later", late.plan.confirm[0].confirmedAt.getTime() === maturity.getTime());
  ck("  ...so the expiry date is the same either way", early.expiresAt.getTime() === late.expiresAt.getTime());
  ck("  ...and so is the balance", early.balance === late.balance && early.balance === 375);
}

section("Expiry is APPLIED, not merely noticed — REGRESSION, this was the worst one:");
{
  // hasLapsed was computed and thrown away; balance never subtracted. Since the sweep may never
  // run — the entire premise — expired points stayed spendable indefinitely, and a 300-point
  // redemption then reset the clock and resurrected the rest for another twelve months.
  const orders = new Map();
  const money = new Map();
  const confirmedEarn = (id, points, when) =>
    ({ id, type: "earn", status: "confirmed", points, orderId: null, createdAt: when, confirmedAt: when });

  const live = rules.computeState([confirmedEarn(1, 500, T0)], orders, money, HELD_BLOOM, at(30));
  ck("expiry is 12 months after the confirmed earn",
    live.expiresAt.getTime() === rules.addMonths(T0, 12).getTime(), String(live.expiresAt));
  ck("not lapsed at 11 months", !rules.computeState([confirmedEarn(1, 500, T0)], orders, money, HELD_BLOOM, at(334)).hasLapsed);
  ck("  ...and still spendable", rules.computeState([confirmedEarn(1, 500, T0)], orders, money, HELD_BLOOM, at(334)).balance === 500);

  const dead = rules.computeState([confirmedEarn(1, 500, T0)], orders, money, HELD_BLOOM, at(400));
  ck("lapsed at 12 months", dead.hasLapsed);
  ck("  ...and the BALANCE IS ZERO without any job having run", dead.balance === 0, `balance=${dead.balance}`);
  ck("  ...with an expiry entry planned so the points never vanish unexplained", dead.plan.expire.length === 1);
  ck("  ...for the full amount", dead.plan.expire[0].points === 500);
  ck("  ...dated when it fell due, not when it was noticed",
    dead.plan.expire[0].dueAt.getTime() === rules.addMonths(T0, 12).getTime());

  // A pending earn must NOT hold the clock open — otherwise placing orders you never accept
  // would keep a balance alive forever.
  const withPending = [confirmedEarn(1, 500, T0), earn(2, 999, 7, at(300))];
  const st = rules.computeState(withPending, new Map([order(7, null, "dispatched")]), money, HELD_BLOOM, at(400));
  ck("a pending earn does NOT reset the expiry clock", st.hasLapsed, `expiresAt=${st.expiresAt}`);
  ck("  ...and the confirmed part is gone", st.balance === 0);
  ck("  ...while the pending part survives to mature later", st.pending === 999);

  const withRedeem = [
    confirmedEarn(1, 500, T0),
    { id: 2, type: "redeem", status: "confirmed", points: -300, orderId: null, createdAt: at(200), confirmedAt: at(200) },
  ];
  const sr = rules.computeState(withRedeem, orders, money, HELD_BLOOM, at(370));
  ck("a redemption DOES reset it", !sr.hasLapsed && sr.expiresAt.getTime() === rules.addMonths(at(200), 12).getTime());
  ck("  ...and the remainder is still spendable", sr.balance === 200);

  // The exploit as reported, end to end: expired points must not be spendable, and spending
  // them must not resurrect the rest. Redemption reads the same balance, so once the lapse is
  // applied rather than merely flagged, the quote refuses on its own.
  const quote = rules.quoteRedemption({
    requestedPoints: 300, balance: dead.balance, merchandiseCents: 60_00,
    redemptionEnabled: true, signedIn: true, refusalCount: 0,
  });
  ck("expired points cannot be redeemed", !quote.ok && quote.reason === "insufficient-balance", String(quote.reason));
  ck("  ...and nothing is offered", quote.maxPoints === 0);

  // Points granted after the lapse date must not be destroyed retroactively.
  const lateBonus = [
    confirmedEarn(1, 500, T0),
    { id: 2, type: "manualAdjustment", status: "confirmed", points: 200, orderId: null, createdAt: at(500), confirmedAt: at(500) },
  ];
  const lb = rules.computeState(lateBonus, orders, money, HELD_BLOOM, at(520));
  ck("a bonus granted AFTER the lapse survives it", lb.balance === 200, `balance=${lb.balance}`);
  ck("  ...and only the lapsed part is written off", lb.plan.expire[0].points === 500);
}

section("A reversed order stops counting toward the tier — REGRESSION:");
{
  // The points were clawed back but the spend stayed, so returning everything kept Bloom — free
  // delivery and 1.25x — for a full twelve months.
  const orders = new Map([order(1, T0)]);
  const money = new Map([[1, 300_00]]);
  const confirmed = earn(1, 300, 1, T0, { status: "confirmed", confirmedAt: at(7) });

  const kept = rules.computeState([confirmed], orders, money, HELD_PETAL, at(30));
  ck("before the return, the spend counts", kept.windowSpendCents === 300_00 && kept.qualifiesFor === "bloom");

  const returned = rules.computeState(
    [confirmed, { id: 2, type: "reversal", status: "confirmed", points: -300, orderId: 1, createdAt: at(20), confirmedAt: at(20) }],
    orders, money, HELD_PETAL, at(30));
  ck("after a full return the points are gone", returned.balance === 0);
  ck("  ...and so is the tier progress", returned.windowSpendCents === 0, `windowSpend=${returned.windowSpendCents}`);
  ck("  ...so they no longer qualify for Bloom", returned.qualifiesFor === "petal");

  const half = rules.computeState(
    [confirmed, { id: 2, type: "reversal", status: "confirmed", points: -150, orderId: 1, createdAt: at(20), confirmedAt: at(20) }],
    orders, money, HELD_PETAL, at(30));
  ck("a half return leaves half the spend", half.windowSpendCents === 150_00, `windowSpend=${half.windowSpendCents}`);

  // The hold rule still protects a tier already granted — this is a demotion question, not a
  // spend question, and the customer keeps Bloom until its anniversary.
  const heldBloom = rules.computeState(
    [confirmed, { id: 2, type: "reversal", status: "confirmed", points: -300, orderId: 1, createdAt: at(20), confirmedAt: at(20) }],
    orders, money, HELD_BLOOM, at(30));
  ck("a tier already held is not revoked mid-cycle by a return", heldBloom.tier === "bloom");
}

section("Money that is not a whole number of cents is refused — REGRESSION:");
{
  ck("parseCents takes a plain integer", rules.parseCents(1234) === 1234);
  ck("  ...and a numeric string", rules.parseCents("1234") === 1234);
  ck("  ...trimmed", rules.parseCents("  1234  ") === 1234);
  ck("rejects a decimal", rules.parseCents("12.34") === null);
  ck("rejects exponent notation", rules.parseCents("1e3") === null);
  ck("rejects the empty string", rules.parseCents("") === null);
  ck("rejects undefined", rules.parseCents(undefined) === null);
  ck("rejects null", rules.parseCents(null) === null);
  ck("rejects NaN", rules.parseCents(NaN) === null);
  ck("rejects Infinity", rules.parseCents(Infinity) === null);
  ck("rejects a non-integer number", rules.parseCents(12.5) === null);
  ck("keeps zero, which is a legitimate amount", rules.parseCents(0) === 0);
  ck("keeps a negative, which callers check separately", rules.parseCents("-500") === -500);

  // The cap is `requested > capPoints`. With NaN in the basket every comparison is false, so the
  // cap did not fail loudly — it evaporated, and 100,000 points ($3,000) went through.
  const nan = rules.quoteRedemption({
    requestedPoints: 100_000, balance: 100_000, merchandiseCents: NaN,
    redemptionEnabled: true, signedIn: true, refusalCount: 0,
  });
  ck("a NaN basket is refused outright", !nan.ok && nan.reason === "bad-input");
  ck("  ...rather than skipping the cap", nan.maxPoints === 0);
  const undef = rules.quoteRedemption({
    requestedPoints: 100_000, balance: 100_000, merchandiseCents: undefined,
    redemptionEnabled: true, signedIn: true, refusalCount: 0,
  });
  ck("an undefined basket is refused too", !undef.ok && undef.reason === "bad-input");
  ck("merchandiseCentsOf refuses a malformed order rather than returning NaN",
    rules.merchandiseCentsOf({ subtotalCents: NaN, discountCents: 0, pointsDiscountCents: 0 }) === 0);
}

section("The 50% cap belongs to the ORDER, not to the call — REGRESSION:");
{
  // Enforced per invocation, two redemptions of $30 landed on one $60 basket and covered all
  // of it. The caller must read `alreadyRedeemedCentsOnOrder` inside the same transaction as
  // the write, or this is check-then-act with extra steps.
  const q = (over) => rules.quoteRedemption({
    balance: 2000, merchandiseCents: 60_00, redemptionEnabled: true, signedIn: true, refusalCount: 0, ...over,
  });

  const first = q({ requestedPoints: 1000 });
  ck("the first $30 against a $60 basket is allowed", first.ok && first.cents === 30_00);
  const second = q({ requestedPoints: 1000, alreadyRedeemedCentsOnOrder: 30_00 });
  ck("a second $30 on the SAME order is refused", !second.ok && second.reason === "over-cap");
  ck("  ...with nothing left to offer", second.maxPoints === 0);

  const partial = q({ requestedPoints: 1000, alreadyRedeemedCentsOnOrder: 10_00 });
  ck("a partial prior redemption leaves the remainder", partial.maxPoints === 600, `maxPoints=${partial.maxPoints}`);
  // $20 of cap left, but points are sold in blocks of 100 worth $3, and $20 is not a multiple
  // of $3 — so the offer floors to $18. Under the cap, never over it.
  ck("  ...floored to a whole block, under the cap", rules.pointsToCents(partial.maxPoints) === 18_00);
  ck("  ...and never over it", rules.pointsToCents(partial.maxPoints) <= 20_00);
}

// ════════════════════════════════════════════════════ THE SERVICE (database)

if (!WRITE) {
  console.log("\n(service tests skipped — pass --write to run them against the database)");
  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}

const db = new PrismaClient();
const TAG = `LOYT${Date.now().toString(36).toUpperCase()}`;
const made = { orders: [], accounts: [], customers: [] };
let phoneSeq = 0;

/** True when the call was refused. A silent success where a refusal was due is the bug. */
async function refuses(fn) {
  try { await fn(); return false; } catch { return true; }
}
const nextPhone = () => `+9617000${String(++phoneSeq).padStart(4, "0")}`;

async function makeOrder({ subtotalCents, status = "received", deliveredAt = null, discountCents = 0, pointsDiscountCents = 0, phone = "" }) {
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
/**
 * The invariant that must hold after every single operation.
 *
 * The reported balance is the confirmed rows, plus what the plan is about to confirm, minus what
 * the plan is about to expire. Read-only: it must not materialise, or it would change the state
 * the tests that follow are inspecting.
 */
async function balanceMatchesLedger(accountId, label, now = new Date()) {
  const { state } = await ledger.readAccount(db, accountId, now);
  const confirmedOnly = (await db.loyaltyLedgerEntry.findMany({ where: { accountId, status: "confirmed" } }))
    .reduce((n, r) => n + r.points, 0);
  const planned = state.plan.confirm.reduce((n, c) => n + c.finalPoints, 0);
  const expiring = state.plan.expire.reduce((n, x) => n + x.points, 0);
  ck(`${label} — ledger sum reconciles`, state.balance === confirmedOnly + planned - expiring,
    `state=${state.balance} confirmed=${confirmedOnly} planned=+${planned} expiring=-${expiring}`);
}

/**
 * The property the whole architecture was signed off on: writing the plan down must not change
 * any number a customer can see. If materialising moves the balance, the read path and the write
 * path have drifted again and the no-cron claim is false.
 */
async function sweepChangesNothing(accountId, label, now = new Date()) {
  const before = await ledger.readAccount(db, accountId, now);
  await ledger.materialise(db, accountId, now);
  const after = await ledger.readAccount(db, accountId, now);
  const confirmedSum = (await db.loyaltyLedgerEntry.findMany({ where: { accountId, status: "confirmed" } }))
    .reduce((n, r) => n + r.points, 0);
  ck(`${label} — the sweep does not move the balance`, before.state.balance === after.state.balance,
    `before=${before.state.balance} after=${after.state.balance}`);
  ck(`${label} — and afterwards the stored rows sum to it`, after.state.balance === confirmedSum,
    `balance=${after.state.balance} confirmedSum=${confirmedSum}`);
  // Running it a second time must be a no-op, not a second helping.
  const twice = await ledger.materialise(db, accountId, now);
  const final = await ledger.readAccount(db, accountId, now);
  ck(`${label} — running it twice changes nothing`, final.state.balance === after.state.balance,
    `${after.state.balance} -> ${final.state.balance} (confirmed=${twice.confirmed}, expired=${twice.expiredPoints})`);
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
    //
    // On a BLOOM account, deliberately. The original version of this test used the schema default
    // — Petal, multiplier 1.0 — and passed for eighteen months of imaginary time while the read
    // path was quietly reporting base points and the write path was reporting multiplied ones.
    // Multiplying by 1.0 is indistinguishable from not multiplying at all, so the assertion was
    // true for the wrong reason. At 1.25x the two answers differ and the test can actually fail.
    const phone = nextPhone();
    const acct = await makeAccount(phone);
    await db.loyaltyAccount.update({ where: { id: acct.id }, data: { tier: "bloom", tierEarnedAt: T0 } });
    const orders = [];
    for (let i = 0; i < 4; i++) {
      const o = await makeOrder({ subtotalCents: 5_000, phone, status: "delivered", deliveredAt: at(i) });
      orders.push(o);
      await ledger.recordEarn(db, { accountId: acct.id, orderId: o.id, merchandiseCents: 5_000, now: at(i) });
    }
    const EXPECTED = 4 * Math.floor(50 * 1.25); // 4 x 62 = 248, NOT the 200 base points
    const s = await ledger.readAccount(db, acct.id, at(30));
    ck("four matured earns are spendable with no job ever having run", s.state.balance === EXPECTED, String(s.state.balance));
    ck("  ...at the Bloom rate, which only the read path could have applied", s.state.balance !== 200);
    const rows = await db.loyaltyLedgerEntry.findMany({ where: { accountId: acct.id } });
    ck("  ...while every row is still 'pending' in the database",
      rows.every((r) => r.status === "pending"), rows.map((r) => r.status).join(","));
    ck("  ...and still holding BASE points, because the stored value is a cache, not the truth",
      rows.every((r) => r.points === 50), rows.map((r) => r.points).join(","));

    const m = await ledger.materialise(db, acct.id, at(30));
    ck("materialising afterwards changes no number", m.balance === EXPECTED, String(m.balance));
    const afterRows = await db.loyaltyLedgerEntry.findMany({ where: { accountId: acct.id } });
    ck("  ...it only makes the database agree", afterRows.every((r) => r.points === 62 && r.status === "confirmed"),
      afterRows.map((r) => `${r.points}/${r.status}`).join(","));
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
    const JAN = 1; // T0 is 15 January 2026
    ck("welcome bonus lands", (await ledger.recordSignupBonus(db, acct.id, T0)).created);
    ck("  ...and never twice", !(await ledger.recordSignupBonus(db, acct.id, at(1))).created);
    ck("birthday bonus lands in the birth month",
      (await ledger.recordBirthdayBonus(db, { accountId: acct.id, birthMonth: JAN, now: T0 })).created);
    ck("  ...not twice in one year",
      !(await ledger.recordBirthdayBonus(db, { accountId: acct.id, birthMonth: JAN, now: at(10) })).created);
    ck("  ...but does again next year",
      (await ledger.recordBirthdayBonus(db, { accountId: acct.id, birthMonth: JAN, now: new Date("2027-01-15T10:00:00Z") })).created);
    const s = await ledger.readAccount(db, acct.id, T0);
    ck("totalling 100 + 200 + 200", s.state.balance === 500, String(s.state.balance));

    // The old version keyed only on the calendar year and never looked at the month, so 400
    // points could be collected five weeks apart across a year boundary.
    const other = await makeAccount(nextPhone());
    ck("a birthday bonus outside the birth month is not granted",
      !(await ledger.recordBirthdayBonus(db, { accountId: other.id, birthMonth: 6, now: T0 })).created);
    ck("  ...and no birth month on file grants nothing",
      !(await ledger.recordBirthdayBonus(db, { accountId: other.id, birthMonth: null, now: T0 })).created);
    ck("  ...leaving the balance at zero", (await ledger.readAccount(db, other.id, T0)).state.balance === 0);
  }

  section("Once-only writes survive being raced — REGRESSION, all three were read-then-write:");
  {
    const acct = await makeAccount(nextPhone());
    const all = (rs) => rs.filter((r) => r.status === "fulfilled" && r.value.created).length;

    const signups = await Promise.allSettled(
      Array.from({ length: 5 }, () => ledger.recordSignupBonus(db, acct.id, T0)));
    ck("five concurrent welcome bonuses grant exactly one", all(signups) === 1, `${all(signups)} granted`);

    const birthdays = await Promise.allSettled(
      Array.from({ length: 5 }, () => ledger.recordBirthdayBonus(db, { accountId: acct.id, birthMonth: 1, now: T0 })));
    ck("five concurrent birthday bonuses grant exactly one", all(birthdays) === 1, `${all(birthdays)} granted`);

    const s = await ledger.readAccount(db, acct.id, T0);
    ck("  ...so the balance is 300, not 1500", s.state.balance === 300, String(s.state.balance));
    await balanceMatchesLedger(acct.id, "after racing the bonuses", T0);
  }

  section("Reversals are idempotent — REGRESSION:");
  {
    const acct = await makeAccount(nextPhone());
    const ord = await makeOrder({ subtotalCents: 300_00, deliveredAt: T0, status: "delivered" });
    await ledger.recordEarn(db, { accountId: acct.id, orderId: ord.id, merchandiseCents: 300_00, now: T0 });
    await ledger.materialise(db, acct.id, at(10));
    const earned = (await ledger.readAccount(db, acct.id, at(10))).state.balance;
    ck("the order confirmed", earned === 300, String(earned));

    const first = await ledger.reverseEarn(db, { orderId: ord.id, reason: "returned in full", enteredBy: "TEST", now: at(11) });
    const second = await ledger.reverseEarn(db, { orderId: ord.id, reason: "returned in full", enteredBy: "TEST", now: at(11) });
    ck("the first reversal claws the points back", first.points === 300);
    ck("a repeated reversal claws back nothing", second.points === 0, `${second.points}`);
    const afterRev = await ledger.readAccount(db, acct.id, at(12));
    ck("  ...so the balance is 0, not -300", afterRev.state.balance === 0, String(afterRev.state.balance));
    ck("  ...and the returned order no longer counts toward the tier", afterRev.state.windowSpendCents === 0);

    const redemptionOrder = await makeOrder({ subtotalCents: 200_00, deliveredAt: null, status: "received" });
    await db.loyaltyLedgerEntry.create({
      data: { accountId: acct.id, orderId: redemptionOrder.id, type: "redeem", status: "confirmed",
              points: -300, confirmedAt: at(13), reason: "test redemption" },
    });
    const back1 = await ledger.reverseRedemption(db, redemptionOrder.id, "order cancelled", at(14));
    const back2 = await ledger.reverseRedemption(db, redemptionOrder.id, "order cancelled", at(14));
    ck("a cancelled order gives the points back", back1.restored === 300);
    ck("  ...exactly once, however many times the status change fires", back2.restored === 0, `${back2.restored}`);
    await balanceMatchesLedger(acct.id, "after the reversals", at(15));
  }

  section("Linking a login is admin-gated — REGRESSION, this was an account takeover:");
  {
    const victimPhone = nextPhone();
    const victim = await makeAccount(victimPhone);
    await ledger.manualAdjustment(db, { accountId: victim.id, points: 1200, reason: "the victim's earned balance", enteredBy: "TEST", now: T0 });

    const attacker = await db.customer.create({
      data: { email: `t-${TAG}-a@tulipglam-test.invalid`, passwordHash: "x", fullName: "A", phone: "" },
    });
    made.customers.push(attacker.id);

    // The whole shape of the exploit: lookup used to take a customerId and bind it.
    const looked = await ledger.getOrCreateAccount(db, victimPhone, { customerId: attacker.id });
    const row = await db.loyaltyAccount.findUnique({ where: { id: victim.id } });
    ck("lookup finds the account", looked.id === victim.id);
    ck("  ...and CANNOT bind a login to it", row.customerId === null, `customerId=${row.customerId}`);
    ck("  ...so the balance stays with its owner", (await ledger.readAccount(db, victim.id, T0)).state.balance === 1200);

    const owner = await db.customer.create({
      data: { email: `t-${TAG}-o@tulipglam-test.invalid`, passwordHash: "x", fullName: "O", phone: "" },
    });
    made.customers.push(owner.id);
    ck("an admin can link it deliberately",
      (await ledger.linkCustomerToAccount(db, { accountId: victim.id, customerId: owner.id, approvedBy: "TEST" })).linked);
    let threw = null;
    try {
      await ledger.linkCustomerToAccount(db, { accountId: victim.id, customerId: attacker.id, approvedBy: "TEST" });
    } catch (e) { threw = e.code; }
    ck("  ...and a second login cannot take it over", threw === "already-linked", String(threw));
    ck("  ...linking without initials is refused", await refuses(() =>
      ledger.linkCustomerToAccount(db, { accountId: victim.id, customerId: owner.id, approvedBy: "  " })));
  }

  section("The sweep changes nothing a customer can see:");
  {
    // The property the architecture was signed off on, checked end to end against the database
    // rather than in the abstract. A Bouquet account, because Petal's 1.0x hides a multiplier bug.
    const acct = await makeAccount(nextPhone());
    await db.loyaltyAccount.update({ where: { id: acct.id }, data: { tier: "bouquet", tierEarnedAt: T0 } });
    const ord = await makeOrder({ subtotalCents: 400_00, deliveredAt: T0, status: "delivered" });
    await ledger.recordEarn(db, { accountId: acct.id, orderId: ord.id, merchandiseCents: 400_00, now: T0 });

    const read = await ledger.readAccount(db, acct.id, at(10));
    ck("a Bouquet customer's matured order reads at 1.5x before any write", read.state.balance === 600,
      `balance=${read.state.balance}, expected 600`);
    await sweepChangesNothing(acct.id, "Bouquet earn", at(10));

    const stored = await db.loyaltyLedgerEntry.findFirst({ where: { orderId: ord.id, type: "earn" } });
    ck("  ...and the stored row now says 600 too", stored.points === 600, String(stored.points));
    ck("  ...stamped at maturity, not at sweep time",
      stored.confirmedAt.getTime() === rules.maturesAt({ id: ord.id, status: "delivered", deliveredAt: T0 }).getTime());
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
  await db.customer.deleteMany({ where: { id: { in: made.customers } } });
  console.log(`\n  cleaned up ${made.accounts.length} accounts and ${made.orders.length} orders`);
  await db.$disconnect();
}

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exit(fail ? 1 : 0);
