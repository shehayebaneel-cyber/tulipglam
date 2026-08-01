/**
 * Stages 4 + 5: the customer API and what the rewards page is allowed to know.
 *
 *     node --import tsx scripts/test-loyalty-rewards.mjs            # structure + flags
 *     node --import tsx scripts/test-loyalty-rewards.mjs --write    # + real customers/orders
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. --write creates its own customers, orders
 *  and loyalty accounts on a reserved phone range and deletes every one of them.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * The centre of this file is OWNERSHIP. After an account takeover was found in
 * `getOrCreateAccount` — a customerId bound to a phone the caller supplied, 1,200 points moved
 * in a test against the live database — "the customer endpoint only ever returns your own
 * account" is not something to assume. It is asserted here, over real HTTP, with a second
 * customer actively trying to reach the first one's data.
 */
process.env.LOYALTY_ENABLED = "true";

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
const SECRET = "test-sweep-secret-that-is-long-enough-32";

function boot(port, env) {
  const p = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), COMING_SOON: "false", LOYALTY_SWEEP_SECRET: SECRET, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  p.stdout.on("data", (d) => { log += d; });
  p.stderr.on("data", (d) => { log += d; });
  return { proc: p, log: () => log };
}
async function waitFor(base) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ════════════════════════════════════════════════════ structural: no enumeration surface

section("There is no endpoint that can be pointed at somebody else's account:");
{
  const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const routes = [...src.matchAll(/app\.(get|post|put|patch|delete)\(\s*"(\/api\/loyalty[^"]*)"/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`);

  ck("exactly one customer-facing loyalty route exists", routes.length === 1, routes.join(", "));
  ck("  ...and it is GET /api/loyalty/me", routes[0] === "GET /api/loyalty/me", String(routes[0]));
  ck("  ...with no path parameter to point somewhere else", !/\/api\/loyalty\/[^"]*:/.test(src));

  // A lookup endpoint is the classic enumeration surface: "is this number registered" answered
  // for anyone who asks. There must not be one, by any of its usual names.
  const forbidden = /\/api\/loyalty\/(lookup|find|check|search|by-phone|phone|account)/;
  ck("  ...and no lookup/check/by-phone endpoint anywhere", !forbidden.test(src));

  const handler = src.slice(src.indexOf('app.get("/api/loyalty/me"'), src.indexOf('// ============================================================ INTERNAL'));
  ck("the handler reads customerId from the token", handler.includes("requireCustomer") && handler.includes("customerId"));
  ck("  ...and never touches req.query or req.params", !handler.includes("req.query") && !handler.includes("req.params"));
  ck("  ...and never looks an account up by phone", !/findUnique\(\s*\{\s*where:\s*\{\s*phoneE164/.test(handler));
}

section("Nothing offers to spend points while redemption is off:");
{
  // ── HOW THIS IS WRITTEN, AND WHY IT CHANGED ─────────────────────────────────────
  //
  // The previous version listed six words I guessed — "Redeem", "redeemable", "Spend your
  // points", "coming soon", "disabled" — and passed, while the page's largest label read
  // "Available to spend". It tested the shape of my assumption, not the requirement.
  //
  // So: scan EVERY string the server sends, and match on the CONCEPT (points being exchanged
  // for something) rather than on particular spellings. And then assert the inverse — with the
  // flag on, these same patterns MUST fire. A check that cannot be made to fail is not a check,
  // and this one is now proven to have teeth in both directions.
  const OFFERS_TO_SPEND = [
    /available to spend/i,
    /\bredeem/i,
    /spend[^.]{0,24}\bpoints?\b/i,
    /\bpoints?\b[^.]{0,24}\b(to spend|you can spend|towards|off your)/i,
    /cash in/i,
    /\bdiscount\b[^.]{0,20}\bpoints?\b/i,
  ];
  const stringsIn = (v, out = []) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => stringsIn(x, out));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => stringsIn(x, out));
    return out;
  };
  globalThis.__spendPatterns = OFFERS_TO_SPEND;
  globalThis.__stringsIn = stringsIn;

  // The component must not hardcode the flag-sensitive copy at all — it renders what the
  // server decided, so the rule lives in one place and cannot be edited away in JSX.
  const page = readFileSync(new URL("../../web/src/pages/Rewards.tsx", import.meta.url), "utf8");
  const rendered = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ck("  the balance heading comes from the server", rendered.includes("data.availableHeading"));
  ck("  the note under it comes from the server", rendered.includes("data.availableNote"));
  ck("  the expiry sentence comes from the server", rendered.includes("data.expiryNote"));
  const hardcoded = OFFERS_TO_SPEND.filter((re) => re.test(rendered));
  ck("  and the component hardcodes none of that vocabulary itself", hardcoded.length === 0, String(hardcoded));
}

section("The page does no arithmetic:");
{
  const page = readFileSync(new URL("../../web/src/pages/Rewards.tsx", import.meta.url), "utf8");
  const rendered = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // Named checks, not a clever regex. JSX is full of slashes — closing tags, class names, URLs —
  // so a general "no division" pattern needs so many exceptions that it stops meaning anything.
  // These name the specific ways money and dates get recomputed in a component.
  ck("no cents-to-dollars conversion", !rendered.includes("/ 100") && !rendered.includes("toFixed"));
  ck("no Math.* anywhere", !rendered.includes("Math."));
  ck("no date formatting", !rendered.includes("toLocaleDateString") && !rendered.includes("Intl.") && !rendered.includes("new Date"));
  ck("no use of the shared money helper", !rendered.includes("usd(") && !/\busd\b/.test(rendered));
  ck("no comparison of a spend figure against a threshold",
    !rendered.includes("thresholdCents") && !rendered.includes("Cents >") && !rendered.includes("Cents <"));
  ck("  ...it renders the server's percent verbatim", rendered.includes("data.next.percent"));
  ck("  ...and the server's labels, not its raw numbers",
    rendered.includes("availableLabel") && rendered.includes("toGoLabel") && rendered.includes("atLabel"));
}

// ════════════════════════════════════════════════════ the flag, off

section("With LOYALTY_ENABLED off, the programme does not exist:");
const offServer = boot(4341, { LOYALTY_ENABLED: "false", LOYALTY_SWEEP_SECRET: "" });
try {
  const base = "http://127.0.0.1:4341";
  ck("the server boots with the flag off and no secret", await waitFor(base), offServer.log().slice(-300));

  const me = await fetch(`${base}/api/loyalty/me`, { headers: { authorization: "Bearer nonsense" } });
  ck("/api/loyalty/me is unauthenticated-first, so a bad token is 401", me.status === 401, String(me.status));

  const site = await (await fetch(`${base}/api/site`)).json();
  ck("the site flag is false, so no Rewards link is rendered", site.flags.loyalty === false, JSON.stringify(site.flags));
} finally {
  offServer.proc.kill();
}

// ════════════════════════════════════════════════════ the real thing

const db = new PrismaClient();
const made = { customers: [], accounts: [], orders: [] };
const onServer = boot(4342, { LOYALTY_ENABLED: "true" });
const BASE = "http://127.0.0.1:4342";

try {
  ck("a server with the flag on boots", await waitFor(BASE), onServer.log().slice(-400));

  const site = await (await fetch(`${BASE}/api/site`)).json();
  ck("the site flag is true", site.flags.loyalty === true);

  const noAuth = await fetch(`${BASE}/api/loyalty/me`);
  ck("no token is refused", noAuth.status === 401, String(noAuth.status));

  if (!WRITE) {
    console.log("\n(customer tests skipped — pass --write to run them against the database)");
  } else {
    const ledger = await import("../src/loyalty/ledger.ts");
    const stamp = Date.now().toString(36);

    async function register(n) {
      const email = `rewards-${stamp}-${n}@tulipglam-test.invalid`;
      const r = await fetch(`${BASE}/api/auth/register`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "not-a-real-password-1", fullName: `Test ${n}`, phone: "" }),
      });
      const body = await r.json();
      if (body.customer) made.customers.push(body.customer.id);
      return body;
    }
    const rewardsAs = async (token, suffix = "") =>
      fetch(`${BASE}/api/loyalty/me${suffix}`, { headers: { authorization: `Bearer ${token}` } });

    const alice = await register("alice");
    const mallory = await register("mallory");
    ck("two customers registered", !!alice.token && !!mallory.token);

    // Alice has an account with real history: a delivered order, a bonus, and a pending order.
    const alicePhone = "+96171200001";
    const acct = await ledger.getOrCreateAccount(db, alicePhone);
    made.accounts.push(acct.id);
    await ledger.linkCustomerToAccount(db, { accountId: acct.id, customerId: alice.customer.id, approvedBy: "TEST" });

    const delivered = await db.order.create({
      data: {
        number: `RW${stamp}A`, status: "delivered", deliveredAt: new Date("2026-06-01T10:00:00Z"),
        phone: alicePhone, fullName: "Test alice",
        subtotalCents: 300_00, discountCents: 0, pointsDiscountCents: 0,
        deliveryCents: 300, totalCents: 300_00 + 300,
      },
    });
    made.orders.push(delivered.id);
    await ledger.recordEarn(db, { accountId: acct.id, orderId: delivered.id, merchandiseCents: 300_00, now: new Date("2026-06-01T10:00:00Z") });

    const inFlight = await db.order.create({
      data: {
        number: `RW${stamp}B`, status: "dispatched",
        phone: alicePhone, fullName: "Test alice",
        subtotalCents: 120_00, discountCents: 0, pointsDiscountCents: 0,
        deliveryCents: 300, totalCents: 120_00 + 300,
      },
    });
    made.orders.push(inFlight.id);
    await ledger.recordEarn(db, { accountId: acct.id, orderId: inFlight.id, merchandiseCents: 120_00 });
    await ledger.recordSignupBonus(db, acct.id);

    section("Alice sees her own account:");
    {
      const r = await rewardsAs(alice.token);
      ck("200", r.status === 200, String(r.status));
      const v = await r.json();
      ck("  linked", v.linked === true);
      ck("  the delivered order's points are available", v.available > 0, String(v.available));
      // 150, not 120. The $300 delivered order had already matured Alice into Bloom by the time
      // the second order was PLACED, so it was quoted 1.25x and the pending figure shows the
      // promised rate — which is the whole point of stamping the multiplier at placement, and
      // what stops a customer watching a pending number turn into a different confirmed one.
      ck("  the in-flight order is pending at the rate it was promised", v.pending === 150, String(v.pending));
      ck("  ...which is the multiplied figure, not the base points", v.pending !== 120);
      ck("  pending and available are different numbers", v.pending !== v.available);
      ck("  the pending figure comes with an explanation", v.pendingNote.length > 0, v.pendingNote);
      ck("  the tier is named", typeof v.tier.label === "string" && v.tier.label.length > 0, v.tier.label);
      ck("  progress to the next tier is a server-computed percent",
        v.next === null || (Number.isInteger(v.next.percent) && v.next.percent >= 0 && v.next.percent <= 100),
        JSON.stringify(v.next));
      ck("  redemption is reported off", v.redemptionEnabled === false);

      // Every string in the payload, against the concept rather than a guessed spelling.
      const offending = globalThis.__stringsIn(v)
        .filter((s) => globalThis.__spendPatterns.some((re) => re.test(s)));
      ck("  and NOTHING in the payload offers to spend points", offending.length === 0, JSON.stringify(offending));
      ck("  the heading describes what the number is, not what it will do",
        v.availableHeading === "Points earned", v.availableHeading);
      ck("  the expiry sentence states the real rule — confirmed activity only",
        v.expiryNote === "" || (/Confirmed orders extend this/.test(v.expiryNote) && !/spend/i.test(v.expiryNote)),
        v.expiryNote);
      ck("  the three facts are present", v.facts.length === 3, JSON.stringify(v.facts.map((f) => f.key)));
      ck("  ...the COD hold", v.facts.some((f) => f.title.includes("7 days after delivery")));
      ck("  ...the placement rate", v.facts.some((f) => f.title.includes("rate you see when you order")));
      ck("  ...the tier crossing", v.facts.some((f) => f.title.includes("applies from your next order")));

      section("History is in the customer's language:");
      ck("  the welcome bonus reads as one", v.history.some((h) => h.title === "Welcome bonus"), JSON.stringify(v.history.map((h) => h.title)));
      ck("  orders are named by their number", v.history.some((h) => h.title.includes(delivered.number)));
      ck("  a pending entry says when it confirms", v.history.some((h) => h.tone === "waiting" && h.detail.length > 0),
        JSON.stringify(v.history.filter((h) => h.tone === "waiting")));
      ck("  a matured earn is not ALSO shown as pending", !v.history.some((h) => h.tone === "waiting" && h.detail === "confirming shortly"), JSON.stringify(v.history.filter((h)=>h.tone==="waiting")));
      ck("  history keys are not ledger primary keys", v.history.every((h) => /^[0-9]+$/.test(h.key) && Number(h.key) < 100), JSON.stringify(v.history.map((h)=>h.key)));
      ck("  every entry has a signed label", v.history.every((h) => /^[+−]\d+ points$/.test(h.pointsLabel)),
        JSON.stringify(v.history.map((h) => h.pointsLabel)));
      ck("  every entry has a formatted date", v.history.every((h) => h.atLabel && !h.atLabel.includes("T")));

      const blob = JSON.stringify(v);
      for (const word of ["redemptionReversal", "manualAdjustment", "dedupeKey", "earnOrderId", "balanceCached", "multiplierApplied", "accountId", "phoneE164"]) {
        ck(`  no internal vocabulary leaks: "${word}"`, !blob.includes(word));
      }
      ck("  the raw admin reason is not exposed", !blob.includes("Welcome bonus\",\"reason"));
      ck("  no phone number reaches the payload", !blob.includes(alicePhone) && !blob.includes("71200001"));
    }

    section("Mallory cannot reach Alice's account, however she asks:");
    {
      const own = await rewardsAs(mallory.token);
      ck("her own view is the empty state", own.status === 200);
      const v = await own.json();
      ck("  linked is false", v.linked === false);
      ck("  zero points", v.available === 0 && v.pending === 0);
      ck("  but the programme is still explained", v.facts.length === 3);
      ck("  and a tier is still named", v.tier.label.length > 0, v.tier.label);

      // Every shape of "give me that one instead".
      const attempts = [
        `?accountId=${acct.id}`,
        `?customerId=${alice.customer.id}`,
        `?phone=${encodeURIComponent(alicePhone)}`,
        `?id=${acct.id}`,
        `?email=${encodeURIComponent(alice.customer.email)}`,
      ];
      for (const q of attempts) {
        const r = await rewardsAs(mallory.token, q);
        const body = await r.json();
        ck(`  ${q} still returns HER account`, body.linked === false && body.available === 0,
          JSON.stringify({ linked: body.linked, available: body.available }));
      }

      // The empty view must be byte-identical to a brand-new customer's, so the existence of
      // an account is not observable by diffing responses.
      const carol = await register("carol");
      const fresh = await (await rewardsAs(carol.token)).json();
      ck("  the empty view is identical for any account-less customer",
        JSON.stringify(fresh) === JSON.stringify(v));

      const alicesOwn = await (await rewardsAs(alice.token)).json();
      ck("  while Alice's own view is different", JSON.stringify(alicesOwn) !== JSON.stringify(v));
    }

    section("...and the same check FIRES when redemption is switched on:");
    {
      // A check that cannot fail is not a check. The presenter is pure, so the cheapest honest
      // way to prove these patterns have teeth is to build the same view with the flag on and
      // watch them catch it. If this section ever goes quiet, the section above is vacuous.
      const onServer = boot(4343, { LOYALTY_ENABLED: "true", LOYALTY_REDEMPTION_ENABLED: "true" });
      try {
        const base = "http://127.0.0.1:4343";
        ck("a server with redemption ON boots", await waitFor(base), onServer.log().slice(-300));
        const r = await fetch(`${base}/api/loyalty/me`, { headers: { authorization: `Bearer ${alice.token}` } });
        const v = await r.json();
        ck("  redemption is reported on", v.redemptionEnabled === true);
        const hits = globalThis.__stringsIn(v)
          .filter((s) => globalThis.__spendPatterns.some((re) => re.test(s)));
        ck("  the payload NOW offers to spend points", hits.length > 0, JSON.stringify(hits));
        ck("  the heading changes to say so", v.availableHeading === "Available to spend", v.availableHeading);
        ck("  and the expiry sentence mentions redemptions too",
          v.expiryNote === "" || /redemptions extend this/i.test(v.expiryNote), v.expiryNote);
      } finally {
        onServer.proc.kill();
      }
    }

    section("Auto-link on first read — only when there is nothing to steal:");
    {
      const freshPhone = "+96171200055";
      const dave = await register("dave");
      await db.customer.update({ where: { id: dave.customer.id }, data: { phone: freshPhone } });

      const before = await db.loyaltyAccount.findUnique({ where: { phoneE164: freshPhone } });
      ck("no account exists for the phone beforehand", before === null);

      const v = await (await rewardsAs(dave.token)).json();
      const after = await db.loyaltyAccount.findUnique({ where: { phoneE164: freshPhone } });
      if (after) made.accounts.push(after.id);
      ck("first read opens and links an account", after !== null && after.customerId === dave.customer.id,
        JSON.stringify(after && { id: after.id, customerId: after.customerId }));
      ck("  ...and the page is no longer the empty state", v.linked === true);

      // The bonus arrives in the same motion — not on a later visit.
      ck("  ...with the welcome bonus already granted", v.available === 100, String(v.available));
      ck("  ...shown as a welcome bonus, not an adjustment",
        v.history.some((h) => h.title === "Welcome bonus"), JSON.stringify(v.history.map((h) => h.title)));

      // Idempotent: reading again must not grant a second bonus or re-link.
      const again = await (await rewardsAs(dave.token)).json();
      ck("reading again grants nothing further", again.available === 100, String(again.available));
      ck("  ...and leaves exactly one welcome bonus",
        again.history.filter((h) => h.title === "Welcome bonus").length === 1);
    }

    section("Auto-link refuses anything with history:");
    {
      // Alice's phone already has an account with a balance — precisely the takeover shape.
      const eve = await register("eve");
      await db.customer.update({ where: { id: eve.customer.id }, data: { phone: alicePhone } });
      const v = await (await rewardsAs(eve.token)).json();
      const acctRow = await db.loyaltyAccount.findUnique({ where: { phoneE164: alicePhone } });
      ck("a phone with an existing account is NOT linked", v.linked === false);
      ck("  ...and its owner is untouched", acctRow.customerId === alice.customer.id,
        `customerId=${acctRow.customerId}, expected ${alice.customer.id}`);
      ck("  ...so no points move", v.available === 0);

      // A phone with delivered orders but no account — the pre-launch case.
      const preLaunchPhone = "+96171200077";
      const preOrder = await db.order.create({
        data: {
          number: `RW${stamp}P`, status: "delivered", deliveredAt: new Date("2026-05-01T10:00:00Z"),
          phone: preLaunchPhone, fullName: "Pre Launch",
          subtotalCents: 100_00, discountCents: 0, pointsDiscountCents: 0,
          deliveryCents: 0, totalCents: 100_00,
        },
      });
      made.orders.push(preOrder.id);
      const frank = await register("frank");
      await db.customer.update({ where: { id: frank.customer.id }, data: { phone: preLaunchPhone } });
      const fv = await (await rewardsAs(frank.token)).json();
      const noAccount = await db.loyaltyAccount.findUnique({ where: { phoneE164: preLaunchPhone } });
      ck("a phone with delivered orders is NOT auto-linked", fv.linked === false && noAccount === null,
        JSON.stringify({ linked: fv.linked, account: !!noAccount }));
      ck("  ...it goes to the admin queue instead, so no bonus either", fv.available === 0);

      // An unusable phone must not open anything.
      const gina = await register("gina");
      await db.customer.update({ where: { id: gina.customer.id }, data: { phone: "12" } });
      const gv = await (await rewardsAs(gina.token)).json();
      ck("an unusable phone links nothing", gv.linked === false);
    }

    section("Two first-reads racing on one fresh phone produce ONE account and ONE link:");
    {
      // The same class of race fixed three times already in this ledger. Stated as a test
      // because a check-then-create is only atomic if the database is the thing deciding.
      const racePhone = "+96171200099";
      const a = await register("race-a");
      const b = await register("race-b");
      await db.customer.update({ where: { id: a.customer.id }, data: { phone: racePhone } });
      await db.customer.update({ where: { id: b.customer.id }, data: { phone: racePhone } });

      const [va, vb] = await Promise.all([
        rewardsAs(a.token).then((r) => r.json()),
        rewardsAs(b.token).then((r) => r.json()),
      ]);

      const accounts = await db.loyaltyAccount.findMany({ where: { phoneE164: racePhone } });
      accounts.forEach((x) => made.accounts.push(x.id));
      ck("exactly one account exists for the phone", accounts.length === 1, String(accounts.length));
      ck("  ...owned by exactly one of the two", [a.customer.id, b.customer.id].includes(accounts[0].customerId),
        String(accounts[0].customerId));
      ck("  ...and exactly one of them sees it linked", [va.linked, vb.linked].filter(Boolean).length === 1,
        JSON.stringify([va.linked, vb.linked]));
      ck("  ...the loser is not given somebody else's account", (va.linked ? vb : va).available === 0);
      ck("  ...and only one welcome bonus was granted", (va.linked ? va : vb).available === 100);

      // The same customer double-submitting must be idempotent, not a second account.
      const [c1, c2] = await Promise.all([
        rewardsAs(a.token).then((r) => r.json()),
        rewardsAs(a.token).then((r) => r.json()),
      ]);
      const stillOne = await db.loyaltyAccount.count({ where: { phoneE164: racePhone } });
      ck("one customer reading twice at once stays at one account", stillOne === 1, String(stillOne));
      ck("  ...and one bonus", c1.available === c2.available && c1.available <= 100, `${c1.available}/${c2.available}`);
    }

    section("A token for a deleted customer cannot resurrect an account:");
    {
      const ghost = await register("ghost");
      await db.customer.delete({ where: { id: ghost.customer.id } });
      made.customers = made.customers.filter((id) => id !== ghost.customer.id);
      const r = await rewardsAs(ghost.token);
      ck("the response is the empty view or a refusal, never someone else's data",
        r.status === 401 || r.status === 404 || (await r.clone().json()).linked === false, String(r.status));
    }
  }
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 5).join("\n        ")}`);
} finally {
  onServer.proc.kill();
  await db.loyaltyLedgerEntry.deleteMany({ where: { OR: [{ accountId: { in: made.accounts } }, { orderId: { in: made.orders } }] } });
  await db.loyaltyAccount.deleteMany({ where: { id: { in: made.accounts } } });
  await db.orderEvent.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.order.deleteMany({ where: { id: { in: made.orders } } });
  await db.customer.deleteMany({ where: { id: { in: made.customers } } });
  await db.$disconnect();
  if (made.customers.length) console.log(`\n  cleaned up ${made.customers.length} customers, ${made.accounts.length} accounts, ${made.orders.length} orders`);
  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}
