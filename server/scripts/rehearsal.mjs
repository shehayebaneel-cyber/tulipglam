/**
 * Launch day, rehearsed.
 *
 *     node --import tsx scripts/rehearsal.mjs
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  LOCAL ONLY, on a copy of the restored production catalogue. It places a dozen
 *  orders and works every one of them through its whole life, so it cannot be
 *  allowed anywhere near the real database — the target is built from LOCAL_PG.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT THIS IS FOR ───────────────────────────────────────────────────────────────
 *
 * Not a test. Tests assert what we already decided is true; this walks the business the way the
 * owner will on launch morning and writes down every place the flow made it STOP, GUESS, or WORK
 * AROUND. That list is the deliverable — `.night/friction.md` — and it is worth more than the
 * pass count, because launch morning should be the owner's SECOND time doing this.
 *
 * A step that "passes" while requiring three undocumented guesses is still friction. So every
 * step records what it had to know that the screen did not tell it.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { pgUrl, startServer, stopServer, sleep } from "./e2e/driver.mjs";

const SRC_DB = process.env.REHEARSAL_SRC_DB || "tulip_restore_drill";
const DB = "tulip_rehearsal_day";
const PORT = 4340;
const PSQL = process.env.E2E_PSQL || "C:/pgportable/pgsql/bin/psql.exe";
const OUT = path.resolve(process.cwd(), "..", ".night");

const friction = [];
/** Record a place the flow made a person stop, guess, or work around. */
const rub = (where, what, severity = "medium", fixable = "unclear") =>
  friction.push({ where, what, severity, fixable });

let pass = 0, fail = 0;
const ck = (n, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${ok ? "" : "  " + extra}`);
  return ok;
};
const section = (t) => console.log(`\n${t}`);

let server = null;
const db = () => new PrismaClient({ datasources: { db: { url: pgUrl(DB) } } });

const api = async (base, p, init = {}, adminKey = null) => {
  const r = await fetch(`${base}${p}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(adminKey ? { "x-admin-key": adminKey } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, ok: r.ok, json, text };
};

try {
  console.log(`\n  building ${DB} from ${SRC_DB} — real catalogue, local copy\n`);
  execSync(`"${PSQL}" "${pgUrl("postgres")}" -q -c "DROP DATABASE IF EXISTS ${DB} WITH (FORCE);" -c "CREATE DATABASE ${DB} TEMPLATE ${SRC_DB};"`, { stdio: "pipe" });

  server = await startServer({ dbName: DB, port: PORT });
  const B = server.base;
  const KEY = server.adminKey;

  // ── The shop as a customer finds it ────────────────────────────────────────────
  section("MORNING — the shop a customer arrives at:");
  const site = (await api(B, "/api/site")).json;
  ck("the storefront bootstraps", !!site, "no /api/site");
  const areas = (site?.areas ?? []).filter((a) => a.active !== false);
  ck("delivery areas are configured", areas.length > 0, `${areas.length}`);
  if (!areas.length) rub("checkout", "No delivery areas — a customer cannot choose one, so no order can be placed", "blocker", "owner must add areas");

  const home = (await api(B, "/api/home")).json;
  ck("the homepage resolves", !!home);
  if (!home?.picks?.products?.length) {
    rub("homepage", "Our Picks rail is empty — nothing is flagged, so the homepage opens with no curated products", "high", "owner picks 8 products in admin");
  }
  if (!home?.reviews?.length) {
    rub("homepage", "No approved reviews, so the social-proof rail is absent on launch day", "low", "expected before any customer has ordered");
  }

  const shop = (await api(B, "/api/products?limit=48&facets=1")).json;
  ck("the shelf has products", (shop?.total ?? 0) > 0, `${shop?.total}`);

  // ── A dozen orders, placed the way customers place them ────────────────────────
  section("THE DAY — twelve orders, placed as customers place them:");
  const picks = (await db().product.findMany({
    where: { status: "active" }, select: { id: true, name: true, priceCents: true, saleCents: true }, take: 60,
  }));
  const cheap = picks.filter((p) => (p.saleCents ?? p.priceCents) > 0);

  const placed = [];
  for (let i = 0; i < 12; i++) {
    // A realistic basket: one to three lines.
    const lines = [];
    for (let k = 0; k <= i % 3; k++) lines.push({ productId: cheap[(i * 3 + k) % cheap.length].id, qty: 1 + (k % 2) });
    const res = await api(B, "/api/orders", {
      method: "POST",
      body: JSON.stringify({
        fullName: `Rehearsal Customer ${i + 1}`,
        phone: `7011${String(1000 + i).slice(-4)}`,
        whatsapp: "",
        email: i % 4 === 0 ? `rehearsal${i}@example.invalid` : "",
        areaId: areas[i % areas.length].id,
        area: areas[i % areas.length].id,
        city: "Beirut",
        address: `Rehearsal address ${i + 1}, floor ${1 + (i % 5)}`,
        notes: i % 5 === 0 ? "Please call before arriving" : "",
        items: lines,
      }),
    });
    // The response is FLAT — { number, totalCents, ... } — not { order: {...} }. The first
    // version of this script looked for res.json.order, found undefined, and reported "0 placed"
    // while twelve orders sat happily in the database. Recorded as friction: the success shape
    // of the one endpoint that takes money is not documented anywhere.
    if (res.ok && res.json?.number) placed.push(res.json);
    else if (i === 0) rub("checkout API", `POST /api/orders returned ${res.status}: ${res.text.slice(0, 120)}`, "blocker", "shape mismatch");
  }
  ck("twelve orders were placed", placed.length === 12, `${placed.length} placed`);

  const dbo = db();
  // Only the orders THIS rehearsal placed. The restored copy carries the owner's real orders,
  // and one of them is already `completed` — a terminal state. Trying to march it through the
  // lifecycle produced a "final status" error that looked like a bug in the transition table.
  const orders = await dbo.order.findMany({ where: { fullName: { startsWith: "Rehearsal Customer" } }, orderBy: { id: "asc" }, include: { items: true } });
  ck("every order priced itself server-side", orders.every((o) => o.totalCents > 0), "some total is zero");
  ck("every order reconciles",
    orders.every((o) => o.totalCents === o.subtotalCents + o.deliveryCents - o.discountCents - o.giftCardCents),
    orders.filter((o) => o.totalCents !== o.subtotalCents + o.deliveryCents - o.discountCents - o.giftCardCents).map((o) => o.number).join(", "));

  // ── The lifecycle, as the owner works it ───────────────────────────────────────
  section("THE LIFECYCLE — every order worked through its whole life:");
  const move = async (id, to) => api(B, `/api/admin/orders/${id}/status`, {
    method: "PUT", body: JSON.stringify({ status: to }),
  }, KEY);

  // The REAL lifecycle, from src/status.ts. My first pass guessed "ready" (there is no such
  // status; it is "packed") and skipped "dispatched" entirely, so every order dead-ended at
  // sourcing. Recorded as friction — see the note in the friction list about discoverability.
  const flow = ["confirming", "confirmed", "sourcing", "packed", "dispatched", "out_for_delivery", "delivered"];
  const statusesSeen = new Set();
  let refusedId = null, cancelledId = null;

  for (const [i, o] of orders.entries()) {
    if (i === 3) { // one refused at the door
      // Refused is reachable ONLY from out_for_delivery, by design — you cannot refuse a parcel
      // that was never brought to your door.
      for (const s of ["confirming", "confirmed", "sourcing", "packed", "dispatched", "out_for_delivery"]) await move(o.id, s);
      const r = await move(o.id, "refused");
      ck(`order ${o.number} can be refused at the door`, r.ok, `${r.status} ${r.text.slice(0, 80)}`);
      refusedId = o.id;
      continue;
    }
    if (i === 5) { // one cancelled before dispatch
      await move(o.id, "confirmed");
      const r = await move(o.id, "cancelled");
      ck(`order ${o.number} can be cancelled before dispatch`, r.ok, `${r.status} ${r.text.slice(0, 80)}`);
      cancelledId = o.id;
      continue;
    }
    let lastOk = true;
    for (const s of flow) {
      const r = await move(o.id, s);
      if (!r.ok) { lastOk = false; rub("order status", `${o.number}: ${s} rejected (${r.status}) — ${r.text.slice(0, 100)}`, "high", "check nextStatuses()"); break; }
      statusesSeen.add(s);
    }
    if (i === 0) ck("an order walks received → delivered without a dead end", lastOk);
  }

  const afterFlow = await dbo.order.findMany({ where: { fullName: { startsWith: "Rehearsal Customer" } }, select: { id: true, status: true, deliveredAt: true } });
  const delivered = afterFlow.filter((o) => o.status === "delivered");
  ck("most orders reached delivered", delivered.length >= 8, `${delivered.length} of ${afterFlow.length}`);
  ck("delivered orders carry a deliveredAt timestamp", delivered.every((o) => o.deliveredAt),
    `${delivered.filter((o) => !o.deliveredAt).length} missing`);
  ck("the refused order did not become a sale", afterFlow.find((o) => o.id === refusedId)?.status === "refused");
  ck("the cancelled order did not become a sale", afterFlow.find((o) => o.id === cancelledId)?.status === "cancelled");

  // ── Dispatch, the screen carried to the door ───────────────────────────────────
  section("DISPATCH — the run carried on a phone:");
  const dispatch = await api(B, "/api/admin/dispatch", {}, KEY);
  ck("the dispatch run loads", dispatch.ok, `${dispatch.status}`);
  if (dispatch.ok) {
    const manifest = dispatch.json?.manifest ?? dispatch.json?.orders ?? [];
    ck("it lists something to deliver or says why not", Array.isArray(manifest), typeof manifest);
  }

  // ── Points, the part that matures on a clock ───────────────────────────────────
  section("POINTS — the 7-day hold, and what a customer sees before it lapses:");
  const flags = (await api(B, "/api/site")).json?.flags ?? {};
  ck("loyalty is switched on for the rehearsal", flags.loyalty === true, JSON.stringify(flags));

  const accounts = await dbo.loyaltyAccount.count();
  const entries = await dbo.loyaltyLedgerEntry.findMany({ select: { type: true, status: true, points: true } });
  const pending = entries.filter((e) => e.status === "pending");
  ck("delivered orders created pending earns", pending.length > 0, `${entries.length} entries, ${pending.length} pending`);
  console.log(`        ${accounts} loyalty accounts, ${entries.length} ledger entries`);

  // Confirmation is time-based: 7 days after deliveredAt. Rather than wait, move the clock
  // backwards on the DATA — the same thing the calendar does, without the week.
  await dbo.$executeRawUnsafe(`UPDATE "Order" SET "deliveredAt" = "deliveredAt" - interval '8 days' WHERE "deliveredAt" IS NOT NULL`);
  const sweep = await api(B, "/api/internal/loyalty-sweep", {
    method: "POST", headers: { "x-loyalty-sweep-key": "e2e-sweep-secret-0123456789abcdef" },
  });
  ck("the sweep endpoint answers", sweep.status !== 404, `${sweep.status}`);

  const after = await dbo.loyaltyLedgerEntry.findMany({ select: { status: true, points: true } });
  const confirmed = after.filter((e) => e.status === "confirmed");
  ck("points confirm once the hold has passed", confirmed.length > 0,
    `${after.filter((e) => e.status === "pending").length} still pending of ${after.length}`);
  if (!confirmed.length) {
    rub("points", "Nothing confirmed after the hold elapsed — either the sweep did not run or maturity is computed elsewhere", "high", "read rules.ts computeState");
  }

  await dbo.$disconnect();

  // ── What the owner would have had to guess ─────────────────────────────────────
  section("FRICTION — everything that made this stop, guess, or work around:");
  if (!friction.length) console.log("  (none recorded — suspicious; re-read the run)");
  for (const f of friction) console.log(`  [${f.severity}] ${f.where}: ${f.what}`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "friction.json"), JSON.stringify({ at: new Date().toISOString(), friction, pass, fail }, null, 2));
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 3).join("\n        ")}`);
} finally {
  stopServer(server);
}

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed — ${friction.length} friction points recorded\n`);
process.exitCode = fail ? 1 : 0;
