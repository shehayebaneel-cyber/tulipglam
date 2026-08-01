/**
 * Stage 3: the order hooks and the sweep endpoint.
 *
 *     node --import tsx scripts/test-loyalty-hooks.mjs            # pure + auth, no writes
 *     node --import tsx scripts/test-loyalty-hooks.mjs --write    # + real orders against Neon
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. --write places REAL orders on a reserved
 *  phone range, then deletes them and everything they created. It never touches a row
 *  it did not make.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * This file boots its OWN server on a spare port with the loyalty flags on, because the
 * behaviour under test only exists when they are, and the dev server runs with them off. That
 * also means the sweep endpoint's auth is tested against a real HTTP stack — headers, status
 * codes and body bytes — rather than by calling the handler directly, which is the only way to
 * check the thing that actually matters: that a wrong key is indistinguishable from a 404.
 */
// Set BEFORE any loyalty module is imported — config.ts reads the environment once, at import
// time, so flipping a flag afterwards has no effect on a module that is already loaded.
process.env.LOYALTY_ENABLED = "true";
process.env.LOYALTY_REDEMPTION_ENABLED = "true";

const { PrismaClient } = await import("@prisma/client");
const { spawn } = await import("node:child_process");
// fileURLToPath, not `new URL(...).pathname` — this repo lives under "projects website", and a
// pathname percent-encodes the space into %20, which spawn then cannot find.
const { fileURLToPath } = await import("node:url");

const WRITE = process.argv.includes("--write");
let pass = 0, fail = 0;
const ck = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};
const section = (t) => console.log(`\n${t}`);

const PORT = 4331;
const SECRET = "test-sweep-secret-that-is-long-enough-32";
const BASE = `http://127.0.0.1:${PORT}`;

// ════════════════════════════════════════════════════ safely() — the failure isolation

section("safely() never lets a hook failure escape:");
{
  const { safely } = await import("../src/loyalty/hooks.ts");

  ck("a successful hook returns its value", (await safely("ok", async () => 42)) === 42);
  ck("a throwing hook returns null instead of throwing",
    (await safely("boom", async () => { throw new Error("ledger exploded"); })) === null);
  ck("a rejected promise is caught too",
    (await safely("reject", () => Promise.reject(new Error("connection reset")))) === null);
  ck("a synchronous throw inside the callback is caught",
    (await safely("sync", () => { throw new TypeError("cannot read properties of null"); })) === null);

  const started = Date.now();
  const hung = await safely("hang", () => new Promise(() => {})); // never settles
  const waited = Date.now() - started;
  ck("a hook that never settles times out rather than hanging checkout", hung === null);
  ck("  ...within a few seconds, not indefinitely", waited < 8000, `${waited}ms`);
}

// ════════════════════════════════════════════════════ the sweep endpoint's auth

// ════════════════════════════════════════════════════ the boot guard

section("The server refuses to boot with an unusable sweep secret:");
{
  const boot = (env) => new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, PORT: "4332", COMING_SOON: "false", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let settled = false;
    const done = (code) => { if (settled) return; settled = true; clearTimeout(t); p.kill(); resolve({ code, out }); };
    const watch = (d) => {
      out += d;
      // A server that boots successfully never exits, so stop as soon as it says it is
      // listening. Waiting out a timer instead would leave it holding a Neon connection while
      // the next server starts, and the free tier's pool is small enough that the extra one
      // makes real queries fail — which reads as a bug in whatever runs next.
      if (out.includes("TulipGlam API on")) done(null);
    };
    p.stdout.on("data", watch);
    p.stderr.on("data", watch);
    const t = setTimeout(() => done(null), 30_000);
    p.on("exit", (code) => { if (!settled) { settled = true; clearTimeout(t); resolve({ code, out }); } });
  });

  const missing = await boot({ LOYALTY_ENABLED: "true", LOYALTY_SWEEP_SECRET: "" });
  ck("a missing secret with the flag ON exits 1", missing.code === 1, `exit=${missing.code}`);
  ck("  ...saying which variable and how to generate one",
    missing.out.includes("LOYALTY_SWEEP_SECRET") && missing.out.includes("randomBytes"), missing.out.slice(-200));

  const short = await boot({ LOYALTY_ENABLED: "true", LOYALTY_SWEEP_SECRET: "too-short" });
  ck("a short secret with the flag ON exits 1", short.code === 1, `exit=${short.code}`);
  ck("  ...naming the actual length", short.out.includes("9 characters"), short.out.slice(-200));

  // The half that matters most: the guard must not take production down in the state the site
  // is in almost all the time, which is with the programme switched off.
  const off = await boot({ LOYALTY_ENABLED: "false", LOYALTY_SWEEP_SECRET: "" });
  ck("with the flag OFF, a missing secret does NOT stop the server", off.code === null, `exit=${off.code}`);
}

section("Booting a server with the loyalty flags on…");
const server = spawn(
  process.execPath,
  ["--import", "tsx", "src/index.ts"],
  {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      PORT: String(PORT),
      LOYALTY_ENABLED: "true",
      LOYALTY_SWEEP_SECRET: SECRET,
      COMING_SOON: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const db = new PrismaClient();
const made = { orders: [], accounts: [] };

try {
  const up = await waitForServer();
  ck("the server boots with LOYALTY_ENABLED and a valid secret", up, serverLog.slice(-500));
  if (!up) throw new Error("server never came up");

  section("The sweep endpoint is invisible without the right key:");
  {
    const sweep = (headers) => fetch(`${BASE}/api/internal/loyalty-sweep`, { method: "POST", headers });

    const nokey = await sweep({});
    const wrong = await sweep({ "x-loyalty-sweep-key": "not-the-secret-but-the-same-length!!" });
    const nearly = await sweep({ "x-loyalty-sweep-key": SECRET.slice(0, -1) });
    const empty = await sweep({ "x-loyalty-sweep-key": "" });

    ck("no key is a 404", nokey.status === 404, String(nokey.status));
    ck("a wrong key is a 404", wrong.status === 404, String(wrong.status));
    ck("a key that is right but for the last character is a 404", nearly.status === 404, String(nearly.status));
    ck("an empty key is a 404", empty.status === 404, String(empty.status));

    const bodies = await Promise.all([nokey, wrong, nearly, empty].map((r) => r.text()));
    ck("  ...all with an empty body", bodies.every((b) => b === ""), JSON.stringify(bodies));
    ck("  ...and nothing cacheable", [nokey, wrong, nearly, empty].every((r) => r.headers.get("cache-control") === "no-store"));
    ck("  ...byte-identical to each other, so a near miss reveals nothing",
      new Set(bodies).size === 1 && new Set([nokey, wrong, nearly, empty].map((r) => r.status)).size === 1);

    // The 404 must match what the gate itself gives an unknown path, or the endpoint's existence
    // is detectable by comparing it with one.
    const unknown = await fetch(`${BASE}/api/internal/does-not-exist`, { method: "POST" });
    ck("a wrong key looks exactly like a path that does not exist",
      unknown.status === wrong.status, `${unknown.status} vs ${wrong.status}`);

    const ok = await sweep({ "x-loyalty-sweep-key": SECRET });
    ck("the right key works", ok.status === 200, `${ok.status} — server log: ${serverLog.slice(-400)}`);
    const report = await ok.json();
    ck("  ...and reports what it did", typeof report.scanned === "number" && typeof report.remaining === "number",
      JSON.stringify(report));
    ck("  ...without being cacheable either", ok.headers.get("cache-control") === "no-store");

    const wrongMethod = await fetch(`${BASE}/api/internal/loyalty-sweep`, {
      method: "GET", headers: { "x-loyalty-sweep-key": SECRET },
    });
    ck("GET does not run it — a write endpoint is POST only", wrongMethod.status !== 200, String(wrongMethod.status));
  }

  if (!WRITE) {
    console.log("\n(order-hook tests skipped — pass --write to run them against the database)");
  } else {
    // ════════════════════════════════════════════════ the order hooks, over real HTTP

    const product = await db.product.findFirst({
      where: { status: "active", priceCents: { gt: 0 } },
      select: { id: true, priceCents: true, name: true },
    });
    if (!product) throw new Error("no active product to order");

    let phoneSeq = 0;
    const nextPhone = () => `+9617100${String(++phoneSeq).padStart(4, "0")}`;

    async function placeOrder({ phone, qty = 3 }) {
      const r = await fetch(`${BASE}/api/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [{ productId: product.id, qty }],
          fullName: "Hook Test", phone, whatsapp: phone,
          area: "", city: "Beirut", address: "Somewhere", notes: "",
        }),
      });
      const body = await r.json();
      if (r.ok && body.number) {
        const row = await db.order.findUnique({ where: { number: body.number } });
        if (row) made.orders.push(row.id);
        return { status: r.status, body, row };
      }
      return { status: r.status, body, row: null };
    }

    section("Placing an order records a pending earn:");
    {
      const phone = nextPhone();
      const { status, body, row } = await placeOrder({ phone });
      ck("the order is placed", status === 200 && !!body.number, JSON.stringify(body).slice(0, 160));

      const account = await db.loyaltyAccount.findUnique({ where: { phoneE164: phone } });
      ck("an account was opened for the phone", !!account);
      if (account) made.accounts.push(account.id);

      const entry = await db.loyaltyLedgerEntry.findFirst({ where: { orderId: row.id, type: "earn" } });
      ck("  ...with a pending earn against the order", !!entry && entry.status === "pending");
      ck("  ...for the merchandise value, not the total with delivery",
        entry.points === Math.floor((row.subtotalCents - row.discountCents) / 100),
        `${entry?.points} points for ${row.subtotalCents}c subtotal`);
      ck("  ...and nothing spendable yet", entry.points > 0 && entry.status !== "confirmed");

      // A signed-in login is NOT bound from a checkout phone — the takeover fix, at the hook level.
      ck("  ...and no login is bound to it", account.customerId === null);
    }

    section("A loyalty failure does not cost the sale — the throw is real, not mocked:");
    {
      // "12" cannot be a Lebanese number, so getOrCreateAccount throws inside the hook on the
      // genuine checkout path. No stubbing: this is the production code failing for real.
      const { status, body, row } = await placeOrder({ phone: "12" });
      ck("the order still lands", status === 200 && !!body.number, JSON.stringify(body).slice(0, 160));
      ck("  ...with the customer's money correct", row && row.totalCents > 0);
      const entries = await db.loyaltyLedgerEntry.findMany({ where: { orderId: row.id } });
      ck("  ...and simply no ledger entry", entries.length === 0, `${entries.length} entries`);
      ck("  ...and no account opened on an unusable number", !(await db.loyaltyAccount.findFirst({ where: { phoneE164: { contains: "12" }, createdAt: { gte: new Date(Date.now() - 60_000) } } })));
    }

    section("Delivery stamps deliveredAt exactly once:");
    {
      const phone = nextPhone();
      const { row } = await placeOrder({ phone });
      const account = await db.loyaltyAccount.findUnique({ where: { phoneE164: phone } });
      if (account) made.accounts.push(account.id);

      const { onOrderStatusChanged } = await import("../src/loyalty/hooks.ts");
      const first = new Date("2026-03-01T09:00:00Z");
      await onOrderStatusChanged(db, { orderId: row.id, to: "delivered", at: first });
      const afterFirst = await db.order.findUnique({ where: { id: row.id }, select: { deliveredAt: true } });
      ck("deliveredAt is set", afterFirst.deliveredAt?.getTime() === first.getTime());

      // An admin re-saving "Delivered" must not push the maturity window forward.
      await onOrderStatusChanged(db, { orderId: row.id, to: "delivered", at: new Date("2026-03-08T09:00:00Z") });
      const afterSecond = await db.order.findUnique({ where: { id: row.id }, select: { deliveredAt: true } });
      ck("  ...and a second 'Delivered' does NOT move it", afterSecond.deliveredAt?.getTime() === first.getTime(),
        String(afterSecond.deliveredAt));
    }

    section("A terminal status kills the pending earn:");
    {
      const { onOrderStatusChanged } = await import("../src/loyalty/hooks.ts");
      for (const status of ["cancelled", "refused", "unavailable"]) {
        const phone = nextPhone();
        const { row } = await placeOrder({ phone });
        const account = await db.loyaltyAccount.findUnique({ where: { phoneE164: phone } });
        if (account) made.accounts.push(account.id);

        await onOrderStatusChanged(db, { orderId: row.id, to: status });
        const entry = await db.loyaltyLedgerEntry.findFirst({ where: { orderId: row.id, type: "earn" } });
        ck(`${status} voids the pending earn`, entry?.status === "void", String(entry?.status));

        const ledger = await import("../src/loyalty/ledger.ts");
        const state = await ledger.readAccount(db, account.id, new Date());
        ck(`  ...leaving nothing pending`, state.state.pending === 0 && state.state.balance === 0,
          `pending=${state.state.pending} balance=${state.state.balance}`);
      }
    }

    section("Removing a line re-prices the pending earn:");
    {
      const phone = nextPhone();
      const { row } = await placeOrder({ phone, qty: 4 });
      const account = await db.loyaltyAccount.findUnique({ where: { phoneE164: phone } });
      if (account) made.accounts.push(account.id);

      const before = await db.loyaltyLedgerEntry.findFirst({ where: { orderId: row.id, type: "earn" } });
      const { repricePendingEarn } = await import("../src/loyalty/ledger.ts");

      const halved = Math.floor(row.subtotalCents / 2);
      const r = await repricePendingEarn(db, row.id, halved);
      ck("the earn is re-priced downward", r.repriced && r.basePoints === Math.floor(halved / 100),
        `${before.points} -> ${r.basePoints}`);
      const after = await db.loyaltyLedgerEntry.findFirst({ where: { orderId: row.id, type: "earn" } });
      ck("  ...on the row itself", after.points === Math.floor(halved / 100), String(after.points));
      ck("  ...still pending, never confirmed by a re-price", after.status === "pending");
      ck("  ...and the reason says why", after.reason.includes("re-priced"), after.reason);

      // A confirmed earn is out of scope — that is a reversal, with a reason attached.
      await db.loyaltyLedgerEntry.update({ where: { id: after.id }, data: { status: "confirmed" } });
      const noop = await repricePendingEarn(db, row.id, 1_00);
      ck("a confirmed earn is NOT re-priced", !noop.repriced);
      const untouched = await db.loyaltyLedgerEntry.findUnique({ where: { id: after.id } });
      ck("  ...and its points are untouched", untouched.points === after.points, String(untouched.points));
    }

    section("The sweep and a redemption can run at the same time:");
    {
      const ledger = await import("../src/loyalty/ledger.ts");
      const { runSweep } = await import("../src/loyalty/sweep.ts");
      const phone = nextPhone();
      const acct = await ledger.getOrCreateAccount(db, phone);
      made.accounts.push(acct.id);
      await ledger.manualAdjustment(db, {
        accountId: acct.id, points: 5000, reason: "balance for the concurrency test", enteredBy: "TEST",
      });

      const order = await db.order.create({
        data: {
          number: `HOOK${Date.now().toString(36).toUpperCase()}`, status: "received",
          phone, fullName: "Concurrency Test",
          subtotalCents: 200_00, discountCents: 0, pointsDiscountCents: 0,
          deliveryCents: 0, totalCents: 200_00,
        },
      });
      made.orders.push(order.id);

      // Fire them together. The redemption must win or retry — never surface a raw 500, and
      // never lose points to a conflict.
      const [redeemed] = await Promise.all([
        ledger.redeem(db, {
          accountId: acct.id, orderId: order.id, requestedPoints: 300,
          merchandiseCents: 200_00, signedIn: true,
        }),
        runSweep(db),
        runSweep(db),
      ]);
      ck("the redemption succeeds despite concurrent sweeps", redeemed.points === 300, JSON.stringify(redeemed));

      const state = await ledger.readAccount(db, acct.id, new Date());
      ck("  ...and exactly 300 points left the account", state.state.balance === 4700, String(state.state.balance));
      const spends = await db.loyaltyLedgerEntry.findMany({ where: { orderId: order.id, type: "redeem" } });
      ck("  ...recorded once, not twice", spends.length === 1, String(spends.length));
    }
  }
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 5).join("\n        ")}`);
} finally {
  await db.loyaltyLedgerEntry.deleteMany({ where: { OR: [{ accountId: { in: made.accounts } }, { orderId: { in: made.orders } }] } });
  await db.loyaltyAccount.deleteMany({ where: { id: { in: made.accounts } } });
  await db.orderEvent.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.order.deleteMany({ where: { id: { in: made.orders } } });
  await db.$disconnect();
  server.kill();
  if (made.orders.length) console.log(`\n  cleaned up ${made.accounts.length} accounts and ${made.orders.length} orders`);
  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}
