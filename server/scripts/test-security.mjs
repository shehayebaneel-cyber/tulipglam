/**
 * The three pre-existing security findings, fixed.
 *
 *     node --import tsx scripts/test-security.mjs            # boot assertions only
 *     node --import tsx scripts/test-security.mjs --write    # + a real order and customers
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. --write creates one order and two
 *  customers with obviously-fake sentinel values, and deletes them.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * ── HOW THESE ASSERTIONS ARE WRITTEN ───────────────────────────────────────────────
 *
 * From the requirement's words, before touching the code — and where the requirement is about
 * ABSENCE, against the actual output rather than a list of field names I guessed.
 *
 * That distinction is not pedantry. A test in this project asserted that the rewards page
 * contained no "Redeem", no "redeemable" and no "Spend your points", and passed, while the
 * page's largest label read "Available to spend". It confirmed the shape of my assumption
 * instead of the requirement. So the PII test below plants SENTINEL VALUES in the order and
 * asserts none of them appears anywhere in the response body — which cannot be fooled by a
 * field I forgot to think of, including one added next year.
 */
const { PrismaClient } = await import("@prisma/client");
const { spawn } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");

const WRITE = process.argv.includes("--write");
let pass = 0, fail = 0;
const ck = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GOOD_JWT = "a-perfectly-adequate-jwt-secret-value-64-chars-long-for-testing!!";

function boot(port, env) {
  const p = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), COMING_SOON: "false", LOYALTY_ENABLED: "false", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve) => {
    let out = "", settled = false;
    const done = (code) => { if (settled) return; settled = true; clearTimeout(t); p.kill(); resolve({ code, out }); };
    const watch = (d) => { out += d; if (out.includes("TulipGlam API on")) done(null); };
    p.stdout.on("data", watch);
    p.stderr.on("data", watch);
    const t = setTimeout(() => done(null), 30_000);
    p.on("exit", (code) => { if (!settled) { settled = true; clearTimeout(t); resolve({ code, out }); } });
  });
}

// ════════════════════════════════════════════════════ JWT_SECRET
//
// Requirement, verbatim: "refuse to start without a real value, 24+ chars ... it doesn't get
// to have a default."

section("The server refuses to start without a real JWT_SECRET:");
{
  const missing = await boot(4351, { JWT_SECRET: "" });
  ck("no JWT_SECRET exits 1", missing.code === 1, `exit=${missing.code}`);
  ck("  ...and says how to generate one", missing.out.includes("randomBytes"), missing.out.slice(-160));

  const short = await boot(4351, { JWT_SECRET: "abcdefghij" });
  ck("a 10-character secret exits 1", short.code === 1, `exit=${short.code}`);
  ck("  ...naming the actual length", short.out.includes("10 characters"), short.out.slice(-160));

  // The old fallback chain, both links.
  const asAdmin = await boot(4351, { JWT_SECRET: "the-very-same-value-as-the-admin-key-abc", ADMIN_KEY: "the-very-same-value-as-the-admin-key-abc" });
  ck("a secret equal to ADMIN_KEY exits 1", asAdmin.code === 1, `exit=${asAdmin.code}`);
  ck("  ...explaining that leaking one would give away both", asAdmin.out.includes("both"), asAdmin.out.slice(-200));

  const oldConstant = await boot(4351, { JWT_SECRET: "tulip-dev-secret" });
  ck("the old hardcoded value exits 1", oldConstant.code === 1, `exit=${oldConstant.code}`);

  const good = await boot(4351, { JWT_SECRET: GOOD_JWT });
  ck("a real secret boots", good.code === null, `exit=${good.code} ${good.out.slice(-200)}`);

  // Unconditional, unlike the coming-soon and loyalty guards: there is no flag that makes a
  // weak signing key acceptable, so it must not be possible to switch this off.
  const noFlags = await boot(4351, { JWT_SECRET: "", COMING_SOON: "false", LOYALTY_ENABLED: "false" });
  ck("no feature flag can switch the assertion off", noFlags.code === 1, `exit=${noFlags.code}`);
}

// ════════════════════════════════════════════════════ the rest needs a live server

const db = new PrismaClient();
const made = { orders: [], customers: [] };
const PORT = 4352;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), COMING_SOON: "false", LOYALTY_ENABLED: "false", JWT_SECRET: GOOD_JWT },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`${BASE}/api/health`)).ok; } catch { /* not up */ }
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  ck("test server is up", up, serverLog.slice(-300));
  if (!up) throw new Error("server never came up");

  // ════════════════════════════════════════════════════ registration enumeration
  //
  // Requirement: "identical response either way". See the caveat printed at the end — a
  // successful registration must return a token, so the STATUS cannot be identical. What is
  // achievable, and asserted here, is that the refusal reveals nothing about the address.

  section("Registration does not confirm whether an address is already registered:");
  {
    const stamp = Date.now().toString(36);
    const reg = (email) => fetch(`${BASE}/api/auth/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "not-a-real-password-1", fullName: "Sec Test", phone: "" }),
    });

    const email = `sec-${stamp}@tulipglam-test.invalid`;
    const first = await reg(email);
    const firstBody = await first.json();
    if (firstBody.customer) made.customers.push(firstBody.customer.id);
    ck("a fresh address registers", first.status === 200 && !!firstBody.token);

    const second = await reg(email);
    const secondBody = await second.json();
    ck("a taken address is refused", second.status === 400);
    ck("  ...without naming the address or saying it exists",
      !/already ha[sv]e? an account with this email|this email already/i.test(secondBody.error)
      && !secondBody.error.includes(email),
      secondBody.error);
    ck("  ...and the message is the same one a malformed attempt would get",
      secondBody.error.startsWith("We couldn’t create an account with those details"), secondBody.error);
    ck("  ...while still telling the real owner what to do", /sign in or reset/i.test(secondBody.error));

    // Racing two registrations on one address must land on the SAME message, or the race is
    // itself the oracle.
    const raceEmail = `sec-race-${stamp}@tulipglam-test.invalid`;
    const raced = await Promise.all([reg(raceEmail), reg(raceEmail)]);
    const bodies = await Promise.all(raced.map((r) => r.json()));
    for (const b of bodies) if (b.customer) made.customers.push(b.customer.id);
    const winners = bodies.filter((b) => b.token).length;
    ck("two registrations racing produce exactly one account", winners === 1, `${winners} succeeded`);
    const loser = bodies.find((b) => !b.token);
    ck("  ...and the loser gets the same non-committal message",
      loser.error.startsWith("We couldn’t create an account with those details"), loser.error);
  }

  if (!WRITE) {
    console.log("\n(order tests skipped — pass --write to run them against the database)");
  } else {
    // ════════════════════════════════════════════════════ order tracking PII
    //
    // Requirement: "GET /api/orders/:number returning full PII unauthenticated — fix now ...
    // Whatever legitimate use it serves (order tracking?) needs to survive the fix."

    section("Tracking an order reveals no personal data to someone who is not its owner:");
    {
      const stamp = Date.now().toString(36).toUpperCase();
      // Sentinels: distinctive enough that finding one anywhere in the response body is proof,
      // and finding none is proof of absence regardless of what the fields are called.
      const SENTINELS = {
        fullName: `ZZNAME${stamp}`,
        phone: `+9617099${stamp.slice(0, 4)}`,
        whatsapp: `+9617088${stamp.slice(0, 4)}`,
        email: `zzmail${stamp}@tulipglam-test.invalid`,
        address: `ZZSTREET${stamp} building 4`,
        notes: `ZZNOTE${stamp} leave with the concierge`,
      };
      const order = await db.order.create({
        data: {
          number: `TG-SEC${stamp.slice(0, 3)}`, status: "dispatched",
          ...SENTINELS,
          area: "Beirut", city: "Beirut",
          subtotalCents: 5_000, discountCents: 0, pointsDiscountCents: 0,
          deliveryCents: 300, totalCents: 5_300, paymentMethod: "cod",
          events: { create: { status: "received", note: "Order placed" } },
        },
      });
      made.orders.push(order.id);

      const anon = await fetch(`${BASE}/api/orders/${order.number}`);
      ck("the endpoint still answers without a token — guest tracking survives", anon.status === 200, String(anon.status));
      const raw = await anon.text();
      const body = JSON.parse(raw);

      // The assertion that cannot be fooled by a field I did not think of.
      for (const [field, value] of Object.entries(SENTINELS)) {
        ck(`  no trace of the order's ${field} anywhere in the response`, !raw.includes(value),
          raw.length > 400 ? `${raw.slice(0, 200)}…` : raw);
      }

      // And the legitimate use is intact.
      ck("  the status is there", body.status === "dispatched");
      ck("  the timeline is there", Array.isArray(body.events) && body.events.length > 0);
      ck("  the money is there", body.totalCents === 5_300 && body.subtotalCents === 5_000);
      ck("  the district is there, so the customer can recognise the order", body.city === "Beirut");
      ck("  and the page is told it is the reduced view", body.redacted === true);

      section("The signed-in owner still sees everything:");
      {
        const stamp2 = Date.now().toString(36);
        const r = await fetch(`${BASE}/api/auth/register`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: `owner-${stamp2}@tulipglam-test.invalid`, password: "not-a-real-password-1", fullName: "Owner", phone: "" }),
        });
        const owner = await r.json();
        made.customers.push(owner.customer.id);
        await db.order.update({ where: { id: order.id }, data: { customerId: owner.customer.id } });

        const mine = await fetch(`${BASE}/api/orders/${order.number}`, { headers: { authorization: `Bearer ${owner.token}` } });
        const mineRaw = await mine.text();
        ck("the owner gets their own address back", mineRaw.includes(SENTINELS.address));
        ck("  ...and their phone", mineRaw.includes(SENTINELS.phone));
        ck("  ...and is not told it is redacted", JSON.parse(mineRaw).redacted === undefined);

        // A DIFFERENT signed-in customer is not the owner and must get the reduced view.
        const other = await fetch(`${BASE}/api/auth/register`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: `other-${stamp2}@tulipglam-test.invalid`, password: "not-a-real-password-1", fullName: "Other", phone: "" }),
        });
        const otherBody = await other.json();
        made.customers.push(otherBody.customer.id);
        const theirs = await fetch(`${BASE}/api/orders/${order.number}`, { headers: { authorization: `Bearer ${otherBody.token}` } });
        const theirsRaw = await theirs.text();
        ck("another signed-in customer gets the reduced view", JSON.parse(theirsRaw).redacted === true);
        for (const [field, value] of Object.entries(SENTINELS)) {
          ck(`  ...with no ${field} either`, !theirsRaw.includes(value));
        }
      }
    }
  }
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 5).join("\n        ")}`);
} finally {
  server.kill();
  await db.orderEvent.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.order.deleteMany({ where: { id: { in: made.orders } } });
  await db.customer.deleteMany({ where: { id: { in: made.customers } } });
  await db.$disconnect();

  console.log(`
  ─────────────────────────────────────────────────────────────────────────────
  NOT FIXED, AND NOT FIXABLE HERE: registration still answers 200 for a new
  address and 400 for a taken one. A successful registration has to return a
  session token, so the two responses cannot be made identical the way the
  gate's wrong-key path can. Closing that last gap needs an email channel —
  always answer "check your inbox", then send either a welcome or a "you
  already have an account" message — and SMTP is unconfigured. Flagged rather
  than papered over.
  ─────────────────────────────────────────────────────────────────────────────`);

  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}
