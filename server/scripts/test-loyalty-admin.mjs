/**
 * Stage 6: the loyalty admin surface.
 *
 *     node --import tsx scripts/test-loyalty-admin.mjs            # gate + structure
 *     node --import tsx scripts/test-loyalty-admin.mjs --write    # + real accounts and orders
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. --write creates its own accounts, orders
 *  and customers on a reserved phone range and deletes every one of them.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Two things this file cares about more than the rest.
 *
 * THE GATE. Every one of these routes does something the customer API refuses — search by
 * phone, expose raw entry types, move points. The only thing standing in front of them is the
 * x-admin-key header, so "is it actually applied" is asserted per route rather than assumed
 * from the router being mounted.
 *
 * THE VOCABULARY DIRECTION. `present.ts` keeps machinery away from customers; this surface is
 * supposed to show it. Both directions are asserted, because a test that only checks one of them
 * would pass if the two payloads were accidentally swapped.
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
const PORT = 4361;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_KEY = "test-admin-key-long-enough-for-this";

const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: ROOT,
  env: {
    ...process.env, PORT: String(PORT), COMING_SOON: "false",
    LOYALTY_ENABLED: "true", LOYALTY_SWEEP_SECRET: "test-sweep-secret-that-is-long-enough-32",
    ADMIN_KEY, NODE_ENV: "development",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => { log += d; });
server.stderr.on("data", (d) => { log += d; });

const db = new PrismaClient();
const made = { accounts: [], orders: [], customers: [] };

const asAdmin = (path, init = {}) =>
  fetch(`${BASE}/api/admin${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-admin-key": ADMIN_KEY, ...(init.headers ?? {}) },
  });

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`${BASE}/api/health`)).ok; } catch { /* not up */ }
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  ck("test server is up", up, log.slice(-400));
  if (!up) throw new Error("server never came up");

  // ══════════════════════════════════════════════ the gate

  section("Every loyalty admin route is behind the admin key:");
  {
    const routes = [
      ["GET", "/loyalty/dashboard"],
      ["GET", "/loyalty/accounts?q=03123456"],
      ["GET", "/loyalty/accounts/1"],
      ["POST", "/loyalty/accounts/1/adjust"],
      ["POST", "/loyalty/accounts/1/claims/1"],
      ["POST", "/loyalty/accounts/1/link"],
      ["POST", "/loyalty/accounts/1/materialise"],
    ];
    for (const [method, path] of routes) {
      const none = await fetch(`${BASE}/api/admin${path}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
      ck(`  ${method} ${path.split("?")[0]} without a key is 401`, none.status === 401, String(none.status));
    }
    const wrong = await fetch(`${BASE}/api/admin/loyalty/dashboard`, { headers: { "x-admin-key": "not-the-key" } });
    ck("  a wrong key is 401 too", wrong.status === 401, String(wrong.status));

    // The customer route must NOT accept the admin key — they are different audiences and an
    // admin key is not a customer identity.
    const crossed = await fetch(`${BASE}/api/loyalty/me`, { headers: { "x-admin-key": ADMIN_KEY } });
    ck("  the admin key does not open the CUSTOMER endpoint", crossed.status === 401, String(crossed.status));
  }

  section("The dashboard reports what the programme costs:");
  {
    const d = await (await asAdmin("/loyalty/dashboard")).json();
    ck("it answers with the key", typeof d.outstandingPoints === "number", JSON.stringify(d).slice(0, 120));
    ck("  a point is worth 3 cents", d.centsPerPoint === 3, String(d.centsPerPoint));
    ck("  liability is points times that", d.liabilityCents === Math.round(d.outstandingPoints * 3),
      `${d.outstandingPoints} pts -> ${d.liabilityCents}c`);
    ck("  pending is reported separately, not as a liability", typeof d.pendingLiabilityCents === "number" && d.pendingPoints >= 0);
    ck("  every tier appears, including empty ones", d.tiers.length === 3, JSON.stringify(d.tiers));
    ck("  the month is named rather than implied", typeof d.monthLabel === "string" && d.monthLabel.length > 0, d.monthLabel);
    ck("  liability is never negative", d.liabilityCents >= 0, String(d.liabilityCents));
  }

  if (!WRITE) {
    console.log("\n(account tests skipped — pass --write to run them against the database)");
  } else {
    const ledger = await import("../src/loyalty/ledger.ts");
    const stamp = Date.now().toString(36).toUpperCase();
    let seq = 0;
    const nextPhone = () => `+9617130${String(++seq).padStart(4, "0")}`;

    section("Lookup finds an account however the number is typed:");
    {
      const phone = nextPhone();
      const acct = await ledger.getOrCreateAccount(db, phone);
      made.accounts.push(acct.id);

      const local = phone.replace("+961", "0");
      const spaced = `${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
      for (const [label, term] of [["E.164", phone], ["local 0-prefixed", local], ["with spaces", spaced]]) {
        const r = await (await asAdmin(`/loyalty/accounts?q=${encodeURIComponent(term)}`)).json();
        ck(`  ${label} finds it`, r.accounts.some((a) => a.id === acct.id), JSON.stringify(r.accounts.map((a) => a.id)));
      }
      const r = await (await asAdmin(`/loyalty/accounts?q=${encodeURIComponent("+9611234567")}`)).json();
      ck("  a different number does not", !r.accounts.some((a) => a.id === acct.id));
      const empty = await (await asAdmin("/loyalty/accounts?q=")).json();
      ck("  an empty search returns nothing rather than everything", empty.accounts.length === 0);
    }

    section("The account view shows stored AND derived, and says which is the truth:");
    {
      const phone = nextPhone();
      const acct = await ledger.getOrCreateAccount(db, phone);
      made.accounts.push(acct.id);
      await db.loyaltyAccount.update({ where: { id: acct.id }, data: { tier: "bouquet", tierEarnedAt: new Date("2026-01-01T00:00:00Z") } });

      const order = await db.order.create({
        data: {
          number: `AD${stamp}1`, status: "delivered", deliveredAt: new Date("2026-06-01T10:00:00Z"),
          phone, fullName: "Admin Test",
          subtotalCents: 400_00, discountCents: 0, pointsDiscountCents: 0,
          deliveryCents: 0, totalCents: 400_00,
        },
      });
      made.orders.push(order.id);
      await ledger.recordEarn(db, { accountId: acct.id, orderId: order.id, merchandiseCents: 400_00, now: new Date("2026-06-01T10:00:00Z") });

      const d = await (await asAdmin(`/loyalty/accounts/${acct.id}`)).json();
      ck("derived balance reflects the matured earn at the promised rate", d.derived.balance === 600, String(d.derived.balance));
      ck("  ...while the stored cache is still behind", d.stored.balanceCached === 0, String(d.stored.balanceCached));
      ck("  ...and the view says what the sweep would write", d.derived.pendingWrites.confirm === 1,
        JSON.stringify(d.derived.pendingWrites));

      // The raw vocabulary IS the point here — the opposite of the customer payload.
      const blob = JSON.stringify(d);
      for (const word of ["multiplierApplied", "dedupeKey", "enteredBy", "status", "reason"]) {
        ck(`  raw field "${word}" is present, deliberately`, blob.includes(word));
      }
      ck("  the entry type is the internal one, not a translation",
        d.entries.some((e) => e.type === "earn"), JSON.stringify(d.entries.map((e) => e.type)));
      ck("  the phone is shown, because an operator needs it", blob.includes(phone));

      // Running the sweep by hand must not change any customer-visible number.
      const before = d.derived.balance;
      await asAdmin(`/loyalty/accounts/${acct.id}/materialise`, { method: "POST" });
      const after = await (await asAdmin(`/loyalty/accounts/${acct.id}`)).json();
      ck("materialising by hand changes no balance", after.derived.balance === before, `${before} -> ${after.derived.balance}`);
      ck("  ...it only brings the cache into step", after.stored.balanceCached === after.derived.balance,
        `${after.stored.balanceCached} vs ${after.derived.balance}`);
      ck("  ...and there is then nothing left to write", after.derived.pendingWrites.confirm === 0);
    }

    section("Corrections require initials and a real reason:");
    {
      const acct = await ledger.getOrCreateAccount(db, nextPhone());
      made.accounts.push(acct.id);
      const adjust = (body) => asAdmin(`/loyalty/accounts/${acct.id}/adjust`, { method: "POST", body: JSON.stringify(body) });

      const noInitials = await adjust({ points: 50, reason: "a long enough reason", enteredBy: "" });
      ck("no initials is refused", noInitials.status === 400, String(noInitials.status));
      const shortReason = await adjust({ points: 50, reason: "x", enteredBy: "AB" });
      ck("a one-character reason is refused", shortReason.status === 400);
      ck("  ...saying why", (await shortReason.json()).code === "reason-too-short");
      const zero = await adjust({ points: 0, reason: "a long enough reason", enteredBy: "AB" });
      ck("a zero adjustment is refused", zero.status === 400);

      const ok = await adjust({ points: 250, reason: "goodwill after a delivery mix-up", enteredBy: "AB" });
      ck("a proper correction lands", ok.status === 200, String(ok.status));
      const d = await (await asAdmin(`/loyalty/accounts/${acct.id}`)).json();
      ck("  ...and shows up in the balance", d.derived.balance === 250, String(d.derived.balance));
      ck("  ...attributed to whoever typed their initials", d.entries[0].enteredBy === "AB", d.entries[0].enteredBy);
      ck("  ...with the reason kept verbatim", d.entries[0].reason === "goodwill after a delivery mix-up", d.entries[0].reason);

      const neg = await adjust({ points: -100, reason: "reversing the goodwill, wrong account", enteredBy: "AB" });
      ck("a negative correction is allowed", neg.status === 200);
      const d2 = await (await asAdmin(`/loyalty/accounts/${acct.id}`)).json();
      ck("  ...and nets off", d2.derived.balance === 150, String(d2.derived.balance));
      ck("  ...without editing the original entry", d2.entries.length === 2, String(d2.entries.length));
    }

    section("The guest back-fill queue is derived, and a decision sticks:");
    {
      const phone = nextPhone();
      const acct = await ledger.getOrCreateAccount(db, phone);
      made.accounts.push(acct.id);
      const guest = await db.order.create({
        data: {
          number: `AD${stamp}2`, status: "delivered", deliveredAt: new Date(Date.now() - 5 * 864e5),
          phone, fullName: "Guest Shopper", customerId: null,
          subtotalCents: 150_00, discountCents: 0, pointsDiscountCents: 0,
          deliveryCents: 0, totalCents: 150_00,
        },
      });
      made.orders.push(guest.id);

      let d = await (await asAdmin(`/loyalty/accounts/${acct.id}`)).json();
      const claim = d.claims.guest.find((c) => c.orderId === guest.id);
      ck("the matching guest order appears as a claim", !!claim, JSON.stringify(d.claims.guest.map((c) => c.number)));
      ck("  ...with no decision against it yet", claim.decision === null);
      ck("  ...and says what it matched on, so it can be sanity-checked", claim.matchedOn === "phone");

      const rule = (decision, body = {}) => asAdmin(`/loyalty/accounts/${acct.id}/claims/${guest.id}`, {
        method: "POST",
        body: JSON.stringify({ decision, decidedBy: "AB", note: "confirmed with the customer on WhatsApp", ...body }),
      });

      ck("a decision without initials is refused", (await rule("approved", { decidedBy: "" })).status === 400);
      ck("a decision without a note is refused", (await rule("approved", { note: "" })).status === 400);
      ck("an invented decision word is refused", (await rule("maybe")).status === 400);

      const approved = await rule("approved");
      ck("approving grants the points", approved.status === 200 && (await approved.json()).granted === 150);

      d = await (await asAdmin(`/loyalty/accounts/${acct.id}`)).json();
      const after = d.claims.guest.find((c) => c.orderId === guest.id);
      ck("  ...and the claim now carries the decision", after === undefined || after.decision !== null,
        JSON.stringify(after));

      // The double-click.
      const twice = await rule("approved");
      ck("approving a second time is refused, not paid twice", twice.status === 400, String(twice.status));
      ck("  ...naming the reason", (await twice.json()).code === "already-decided");
      const d3 = await (await asAdmin(`/loyalty/accounts/${acct.id}`)).json();
      const earns = d3.entries.filter((e) => e.type === "earn" && e.orderId === guest.id);
      ck("  ...leaving exactly one earn on the order", earns.length === 1, String(earns.length));

      // And the order itself is untouched — approving is a ledger decision, not an orders one.
      const orderRow = await db.order.findUnique({ where: { id: guest.id }, select: { customerId: true } });
      ck("Order.customerId is never touched by approving a claim", orderRow.customerId === null);
    }

    section("A rejection is recorded, so the claim does not come back:");
    {
      const phone = nextPhone();
      const acct = await ledger.getOrCreateAccount(db, phone);
      made.accounts.push(acct.id);
      const guest = await db.order.create({
        data: {
          number: `AD${stamp}3`, status: "delivered", deliveredAt: new Date(Date.now() - 3 * 864e5),
          phone, fullName: "Not Them", customerId: null,
          subtotalCents: 90_00, discountCents: 0, pointsDiscountCents: 0,
          deliveryCents: 0, totalCents: 90_00,
        },
      });
      made.orders.push(guest.id);

      const r = await asAdmin(`/loyalty/accounts/${acct.id}/claims/${guest.id}`, {
        method: "POST",
        body: JSON.stringify({ decision: "rejected", decidedBy: "AB", note: "different person, same household number" }),
      });
      ck("rejecting is accepted", r.status === 200);
      ck("  ...and grants nothing", (await r.json()).granted === 0);

      const d = await (await asAdmin(`/loyalty/accounts/${acct.id}`)).json();
      const claim = d.claims.guest.find((c) => c.orderId === guest.id);
      ck("  ...the claim still shows, but ruled on rather than outstanding",
        claim && claim.decision && claim.decision.decision === "rejected", JSON.stringify(claim?.decision));
      ck("  ...with the note kept", claim.decision.note === "different person, same household number");
      ck("  ...and no points moved", d.derived.balance === 0, String(d.derived.balance));
    }

    section("Signed-in orders from before the programme have their own queue:");
    {
      const phone = nextPhone();
      const customer = await db.customer.create({
        data: { email: `admin-${stamp}@tulipglam-test.invalid`, passwordHash: "x", fullName: "Pre Launch", phone },
      });
      made.customers.push(customer.id);
      const acct = await ledger.getOrCreateAccount(db, phone);
      made.accounts.push(acct.id);
      await ledger.linkCustomerToAccount(db, { accountId: acct.id, customerId: customer.id, approvedBy: "TEST" });

      const old = await db.order.create({
        data: {
          number: `AD${stamp}4`, status: "delivered", deliveredAt: new Date("2026-04-01T10:00:00Z"),
          phone, fullName: "Pre Launch", customerId: customer.id,
          subtotalCents: 220_00, discountCents: 20_00, pointsDiscountCents: 0,
          deliveryCents: 0, totalCents: 200_00,
        },
      });
      made.orders.push(old.id);

      const d = await (await asAdmin(`/loyalty/accounts/${acct.id}`)).json();
      const row = d.claims.signedIn.find((c) => c.orderId === old.id);
      ck("the order appears in the signed-in queue", !!row, JSON.stringify(d.claims.signedIn.map((c) => c.number)));
      ck("  ...not in the guest queue, which only covers unattached orders",
        !d.claims.guest.some((c) => c.orderId === old.id));
      ck("  ...priced on merchandise after the discount", row.merchandiseCents === 200_00, String(row.merchandiseCents));
      ck("  ...and says the identity is already settled", row.matchedOn === "signed-in at checkout");

      const r = await asAdmin(`/loyalty/accounts/${acct.id}/claims/${old.id}`, {
        method: "POST",
        body: JSON.stringify({ decision: "approved", decidedBy: "AB", note: "placed before launch, honouring it" }),
      });
      ck("approving it grants on the discounted merchandise", (await r.json()).granted === 200);

      // It was delivered in April, so the hold is long over — the customer must not serve it again.
      const d2 = await (await asAdmin(`/loyalty/accounts/${acct.id}`)).json();
      ck("  ...and it is spendable immediately, not held for another 7 days",
        d2.derived.balance === 200 && d2.derived.pending === 0,
        `balance=${d2.derived.balance} pending=${d2.derived.pending}`);
    }

    section("Neither queue offers an order that already earned:");
    {
      const phone = nextPhone();
      const acct = await ledger.getOrCreateAccount(db, phone);
      made.accounts.push(acct.id);
      const order = await db.order.create({
        data: {
          number: `AD${stamp}5`, status: "delivered", deliveredAt: new Date(Date.now() - 2 * 864e5),
          phone, fullName: "Already Paid", customerId: null,
          subtotalCents: 60_00, discountCents: 0, pointsDiscountCents: 0,
          deliveryCents: 0, totalCents: 60_00,
        },
      });
      made.orders.push(order.id);
      await ledger.recordEarn(db, { accountId: acct.id, orderId: order.id, merchandiseCents: 60_00 });

      const d = await (await asAdmin(`/loyalty/accounts/${acct.id}`)).json();
      ck("an order with an earn is not offered again", !d.claims.guest.some((c) => c.orderId === order.id));
    }
  }
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 5).join("\n        ")}`);
} finally {
  server.kill();
  await db.loyaltyClaimDecision.deleteMany({ where: { accountId: { in: made.accounts } } });
  await db.loyaltyLedgerEntry.deleteMany({ where: { OR: [{ accountId: { in: made.accounts } }, { orderId: { in: made.orders } }] } });
  await db.loyaltyAccount.deleteMany({ where: { id: { in: made.accounts } } });
  await db.orderEvent.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.order.deleteMany({ where: { id: { in: made.orders } } });
  await db.customer.deleteMany({ where: { id: { in: made.customers } } });
  await db.$disconnect();
  if (made.accounts.length) console.log(`\n  cleaned up ${made.accounts.length} accounts, ${made.orders.length} orders, ${made.customers.length} customers`);
  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}
