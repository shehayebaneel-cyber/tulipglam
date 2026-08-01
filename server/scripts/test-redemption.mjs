/**
 * Redemption at checkout — built complete, deployed invisible.
 *
 *     node --import tsx scripts/test-redemption.mjs            # invisibility + structure
 *     node --import tsx scripts/test-redemption.mjs --write    # + real orders that spend points
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. --write places REAL orders on a reserved
 *  phone range and deletes them and everything they created.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Two questions, and the first one matters more tonight:
 *
 *   1. With the flag OFF, is the feature completely absent? Not disabled — absent. The store
 *      is about to be shown to real people and a visible-but-dead discount is a promise with a
 *      date nobody has set.
 *   2. With the flag ON, is the money right, and can it be double-spent?
 */
const { PrismaClient } = await import("@prisma/client");
const { spawn } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
const { readFileSync } = await import("node:fs");

const WRITE = process.argv.includes("--write");
let pass = 0, fail = 0;
const ck = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SWEEP = "test-sweep-secret-that-is-long-enough-32";

function boot(port, env) {
  const p = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), COMING_SOON: "false", LOYALTY_SWEEP_SECRET: SWEEP, NODE_ENV: "development", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  p.stdout.on("data", (d) => { log += d; });
  p.stderr.on("data", (d) => { log += d; });
  return { proc: p, log: () => log };
}
const waitFor = async (base) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

const db = new PrismaClient();
const made = { orders: [], accounts: [], customers: [], products: [] };

try {
  // ════════════════════════════════════════════════ 1. INVISIBLE while off

  section("With redemption OFF, the feature does not exist:");
  {
    const s = boot(4381, { LOYALTY_ENABLED: "true", LOYALTY_REDEMPTION_ENABLED: "false" });
    try {
      const base = "http://127.0.0.1:4381";
      ck("a server with earning on and redemption off boots", await waitFor(base), s.log().slice(-300));

      const prev = await fetch(`${base}/api/loyalty/redeem-preview`, {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer nonsense" },
        body: JSON.stringify({ merchandiseCents: 10000, points: 300 }),
      });
      ck("the preview endpoint is unauthenticated-first (401 before 404)", prev.status === 401, String(prev.status));
    } finally { s.proc.kill(); }

    // The component is the thing a customer would actually see.
    const panel = readFileSync(new URL("../../web/src/components/RedeemPoints.tsx", import.meta.url), "utf8");
    const code = panel.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ck("the panel returns null unless the server says redemption is on", /if\s*\(!enabled[^)]*\)\s*return null/.test(code));
    ck("  ...and there is no disabled state to render instead", !/disabled|coming soon|soon/i.test(code));

    const checkout = readFileSync(new URL("../../web/src/pages/Checkout.tsx", import.meta.url), "utf8");
    const ccode = checkout.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ck("checkout only mounts it behind redemptionEnabled", /rewards\?\.redemptionEnabled\s*&&/.test(ccode));
    ck("  ...and shows no points line in the totals when nothing was applied", /pointsOff\s*>\s*0\s*&&/.test(ccode));
  }

  if (!WRITE) {
    console.log("\n(order tests skipped — pass --write to run them against the database)");
  } else {
    // ════════════════════════════════════════════════ 2. the money, with it ON

    const ledger = await import("../src/loyalty/ledger.ts");
    const stamp = Date.now().toString(36).toUpperCase();
    const s = boot(4382, { LOYALTY_ENABLED: "true", LOYALTY_REDEMPTION_ENABLED: "true" });
    const BASE = "http://127.0.0.1:4382";

    try {
      ck("a server with redemption ON boots", await waitFor(BASE), s.log().slice(-400));

      const product = await db.product.findFirst({
        where: { status: "active", priceCents: { gte: 1000 } },
        select: { id: true, priceCents: true },
      });
      const area = await db.deliveryArea.findFirst({ where: { active: true } });
      if (!product) throw new Error("no product to order");

      async function customerWithPoints(points, phone) {
        const reg = await fetch(`${BASE}/api/auth/register`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: `redeem-${stamp}-${made.customers.length}@tulipglam-test.invalid`, password: "not-a-real-password-1", fullName: "Redeem Test", phone }),
        });
        const body = await reg.json();
        made.customers.push(body.customer.id);
        const acct = await ledger.getOrCreateAccount(db, phone);
        made.accounts.push(acct.id);
        await ledger.linkCustomerToAccount(db, { accountId: acct.id, customerId: body.customer.id, approvedBy: "TEST" });
        await ledger.manualAdjustment(db, { accountId: acct.id, points, reason: "balance for the redemption test", enteredBy: "TEST" });
        return { token: body.token, accountId: acct.id, customerId: body.customer.id, phone };
      }

      async function order(token, qty, redeemPoints, phone) {
        const r = await fetch(`${BASE}/api/orders`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            items: [{ productId: product.id, qty }],
            fullName: "Redeem Test", phone, whatsapp: phone,
            areaId: area?.id, city: "Beirut", address: "Somewhere", notes: "",
            redeemPoints,
          }),
        });
        const body = await r.json();
        if (body.number) {
          const row = await db.order.findUnique({ where: { number: body.number } });
          if (row) made.orders.push(row.id);
          return { status: r.status, body, row };
        }
        return { status: r.status, body, row: null };
      }

      section("Points come off the goods, and the arithmetic is the server's:");
      {
        const phone = "+96171400001";
        const me = await customerWithPoints(5000, phone);
        const qty = 4;
        const goods = product.priceCents * qty;

        const { status, body, row } = await order(me.token, qty, 300, phone);
        ck("the order is placed", status === 200 && !!body.number, JSON.stringify(body).slice(0, 140));
        ck("300 points is $9.00 off", body.pointsDiscountCents === 900, String(body.pointsDiscountCents));
        ck("  ...recorded on the order row", row.pointsDiscountCents === 900);
        ck("  ...and the total is goods − points + delivery",
          row.totalCents === goods - 900 + row.deliveryCents,
          `goods=${goods} points=900 delivery=${row.deliveryCents} total=${row.totalCents}`);
        ck("  ...delivery was NOT discounted by points", row.deliveryCents === (await db.deliveryArea.findUnique({ where: { id: area.id } })).feeCents || row.deliveryCents === 0);

        const spend = await db.loyaltyLedgerEntry.findFirst({ where: { orderId: row.id, type: "redeem" } });
        ck("a redeem entry exists against the order", !!spend && spend.points === -300, JSON.stringify(spend?.points));
        ck("  ...confirmed immediately — points are spent, not pending", spend.status === "confirmed");
        const state = await ledger.readAccount(db, me.accountId, new Date());
        ck("  ...and the balance dropped by exactly 300", state.state.balance === 4700, String(state.state.balance));
      }

      section("The earn is computed on what was actually paid for the goods:");
      {
        const phone = "+96171400002";
        const me = await customerWithPoints(5000, phone);
        const qty = 4;
        const goods = product.priceCents * qty;
        const { row } = await order(me.token, qty, 300, phone);

        const earn = await db.loyaltyLedgerEntry.findFirst({ where: { orderId: row.id, type: "earn" } });
        const expected = Math.floor((goods - 900) / 100);
        ck("earning excludes the points discount, so points cannot be farmed",
          earn?.points === expected, `earned ${earn?.points}, expected ${expected} from ${goods - 900}c`);
      }

      section("The cap is the server's, whatever the browser asks for:");
      {
        const phone = "+96171400003";
        const me = await customerWithPoints(100000, phone);
        const qty = 2;
        const goods = product.priceCents * qty;
        // Ask for far more than half the basket.
        const { row, body } = await order(me.token, qty, 90000, phone);
        ck("a greedy request is capped at 50% of the goods",
          body.pointsDiscountCents <= Math.floor(goods / 2),
          `asked 90000 points, got ${body.pointsDiscountCents}c off ${goods}c`);
        ck("  ...and the order still went through", !!row);
        ck("  ...at the price the server decided", row.totalCents === goods - row.pointsDiscountCents + row.deliveryCents);
      }

      section("Asking for points you do not have is not an error:");
      {
        const phone = "+96171400004";
        const me = await customerWithPoints(100, phone); // below the 300 minimum
        const { status, row, body } = await order(me.token, 3, 300, phone);
        ck("the order still completes", status === 200 && !!row, JSON.stringify(body).slice(0, 120));
        ck("  ...at full price", body.pointsDiscountCents === 0, String(body.pointsDiscountCents));
        const spend = await db.loyaltyLedgerEntry.findFirst({ where: { orderId: row.id, type: "redeem" } });
        ck("  ...with no redeem entry written", !spend);
        const state = await ledger.readAccount(db, me.accountId, new Date());
        ck("  ...and the balance untouched", state.state.balance === 100, String(state.state.balance));
      }

      section("Two checkouts racing cannot spend the same points twice:");
      {
        const phone = "+96171400005";
        const me = await customerWithPoints(400, phone); // enough for ONE 300-point redemption
        const [a, b] = await Promise.all([
          order(me.token, 3, 300, phone),
          order(me.token, 3, 300, phone),
        ]);
        const discounts = [a.body.pointsDiscountCents ?? 0, b.body.pointsDiscountCents ?? 0];
        const spent = discounts.filter((d) => d > 0).length;
        ck("exactly one of them got the discount", spent === 1, JSON.stringify(discounts));

        const state = await ledger.readAccount(db, me.accountId, new Date());
        ck("  ...and the balance never went below what was earned",
          state.state.balance === 100, `balance=${state.state.balance}, expected 100`);
        const entries = await db.loyaltyLedgerEntry.findMany({ where: { accountId: me.accountId, type: "redeem" } });
        ck("  ...with exactly one redeem entry", entries.length === 1, String(entries.length));
        ck("  ...and BOTH orders exist — a losing race is not a lost sale",
          !!a.row && !!b.row, `${!!a.row} / ${!!b.row}`);
      }
    } finally { s.proc.kill(); }
  }
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 6).join("\n        ")}`);
} finally {
  await db.loyaltyLedgerEntry.deleteMany({ where: { OR: [{ accountId: { in: made.accounts } }, { orderId: { in: made.orders } }] } });
  await db.loyaltyClaimDecision.deleteMany({ where: { accountId: { in: made.accounts } } });
  await db.loyaltyAccount.deleteMany({ where: { id: { in: made.accounts } } });
  await db.orderEvent.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.order.deleteMany({ where: { id: { in: made.orders } } });
  await db.customer.deleteMany({ where: { id: { in: made.customers } } });
  await db.$disconnect();
  if (made.orders.length) console.log(`\n  cleaned up ${made.orders.length} orders, ${made.accounts.length} accounts, ${made.customers.length} customers`);
  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}
