/**
 * How much launch does the current shape survive?
 *
 *     node --import tsx scripts/load-test.mjs
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  LOCAL ONLY. It runs against a database restored from the production dump, on the
 *  local cluster, behind a server this script starts itself. It refuses to run
 *  against any host that is not 127.0.0.1 — hammering Neon would be both a bad
 *  measurement and a bad thing to do to the live store.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * ── WHY THE NUMBER IS WORTH HAVING ─────────────────────────────────────────────────
 *
 * "Launch plus one Instagram post" is a burst, not a ramp. The question is not average
 * throughput, it is: what breaks FIRST, and at what concurrency. Answering it locally now, on
 * real catalogue data, gives a shape to compare against after Stage C — at which point the same
 * script on the real box turns the number into a promise.
 *
 * ── THE ONE THAT MATTERS MOST: CGNAT ───────────────────────────────────────────────
 *
 * A large share of Lebanese mobile traffic shares egress IPs. If the rate limiter keys on an IP
 * that hundreds of customers share, the first busy minute locks out the whole country. The
 * limiter was built CGNAT-aware; this measures whether that is still true under load, which is
 * the only way to know.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { LOCAL_PG, pgUrl, startServer, stopServer, sleep } from "./e2e/driver.mjs";

if (LOCAL_PG.host !== "127.0.0.1" && LOCAL_PG.host !== "localhost") {
  console.error("refusing to load-test a non-local host");
  process.exit(1);
}

const SRC_DB = process.env.LOAD_SRC_DB || "tulip_restore_drill"; // the restored production copy
const DB = "tulip_load";
const PORT = 4330;
const PSQL = process.env.E2E_PSQL || "C:/pgportable/pgsql/bin/psql.exe";
const OUT = path.resolve(process.cwd(), "..", ".night");

const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const fmt = (n) => String(Math.round(n)).padStart(5);

/** One timed request. Never throws — a failure is a data point, not a crash. */
async function hit(url, init) {
  const t = Date.now();
  try {
    const r = await fetch(url, init);
    const body = await r.text();
    return { ms: Date.now() - t, status: r.status, ok: r.ok, bytes: body.length };
  } catch (e) {
    return { ms: Date.now() - t, status: 0, ok: false, err: String(e.message).slice(0, 60) };
  }
}

/** Run `total` requests with at most `conc` in flight. */
async function swarm(makeReq, { total, conc }) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      results.push(await makeReq(i));
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, worker));
  const wall = Date.now() - t0;
  const oks = results.filter((r) => r.ok);
  const lat = oks.map((r) => r.ms);
  return {
    total, conc, wall,
    rps: +(results.length / (wall / 1000)).toFixed(1),
    ok: oks.length,
    failed: results.length - oks.length,
    statuses: results.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {}),
    p50: pct(lat, 0.5), p90: pct(lat, 0.9), p99: pct(lat, 0.99), max: Math.max(0, ...lat),
  };
}

const row = (label, s) =>
  `  ${label.padEnd(34)}${String(s.conc).padStart(4)}  ${fmt(s.rps)}/s  p50 ${fmt(s.p50)}  p90 ${fmt(s.p90)}  p99 ${fmt(s.p99)}  ${s.failed ? `${s.failed} FAILED` : "ok"}`;

let server = null;
const report = { at: new Date().toISOString(), phases: {} };

try {
  // A copy of the restored production data, so the load test cannot corrupt the drill's evidence.
  console.log(`\n  preparing ${DB} from ${SRC_DB} (real catalogue, local copy)…`);
  execSync(`"${PSQL}" "${pgUrl("postgres")}" -q -c "DROP DATABASE IF EXISTS ${DB} WITH (FORCE);" -c "CREATE DATABASE ${DB} TEMPLATE ${SRC_DB};"`, { stdio: "pipe" });

  const db = new PrismaClient({ datasources: { db: { url: pgUrl(DB) } } });
  const activeCount = await db.product.count({ where: { status: "active" } });
  // `id`, not `slug` — POST /api/orders prices from `items[].productId`. The first version of
  // this test sent slugs and every checkout came back 400, which read as "checkout collapses
  // under load" when it had never been reached at all.
  const sample = await db.product.findMany({ where: { status: "active" }, select: { slug: true, id: true }, take: 40 });
  const areas = await db.deliveryArea.findMany({ where: { active: true }, select: { id: true } });
  await db.$disconnect();
  console.log(`  ${activeCount} active products, ${areas.length} delivery areas\n`);

  server = await startServer({ dbName: DB, port: PORT });
  const B = server.base;
  await hit(`${B}/api/health`); // warm the pool

  console.log("══ 1. browsing — the shelf a burst lands on ════════════════════════════════");
  console.log(`  ${"scenario".padEnd(34)}conc     rps   p50    p90    p99`);
  for (const conc of [1, 5, 20, 50]) {
    const s = await swarm(() => hit(`${B}/api/products?limit=48&facets=1`), { total: conc * 6, conc });
    report.phases[`browse_c${conc}`] = s;
    console.log(row("GET /api/products (48 + facets)", s));
  }

  console.log("\n══ 2. searching — the most expensive read a customer makes ═════════════════");
  const terms = ["shampo", "mascarra", "loreal", "nivea cream", "makup", "lipliner", "granier", "perfum"];
  for (const conc of [1, 5, 20, 50]) {
    const s = await swarm((i) => hit(`${B}/api/products?q=${encodeURIComponent(terms[i % terms.length])}&facets=1`), { total: conc * 6, conc });
    report.phases[`search_c${conc}`] = s;
    console.log(row("GET /api/products?q= (typo terms)", s));
  }

  console.log("\n══ 3. product pages — what an Instagram link opens ═════════════════════════");
  for (const conc of [10, 40]) {
    const s = await swarm((i) => hit(`${B}/api/products/${sample[i % sample.length].slug}`), { total: conc * 6, conc });
    report.phases[`product_c${conc}`] = s;
    console.log(row("GET /api/products/:slug", s));
  }

  console.log("\n══ 4. simultaneous checkouts — money under contention ══════════════════════");
  const mkOrder = (i) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullName: `Load Test ${i}`,
      phone: `7010${String(1000 + i).slice(-4)}`,
      area: areas[0]?.id,
      areaId: areas[0]?.id,
      city: "Beirut",
      address: "Load test address, floor 1",
      items: [{ productId: sample[i % sample.length].id, qty: 1 }],
    }),
  });
  for (const conc of [5, 20]) {
    const s = await swarm((i) => hit(`${B}/api/orders`, mkOrder(i)), { total: conc * 3, conc });
    report.phases[`checkout_c${conc}`] = s;
    console.log(row("POST /api/orders", s));
    if (s.failed) console.log(`        statuses: ${JSON.stringify(s.statuses)}`);
  }

  console.log("\n══ 5. CGNAT — hundreds of customers behind ONE egress IP ═══════════════════");
  console.log("  Lebanese mobile shares egress IPs. If the limiter keys on that IP, the first");
  console.log("  busy minute locks out the country. Every request below claims the SAME IP.\n");
  const SHARED = "196.201.128.44"; // an ordinary-looking single shared egress address
  for (const conc of [20, 60]) {
    const s = await swarm(() => hit(`${B}/api/products?limit=24`, { headers: { "x-forwarded-for": SHARED } }), { total: conc * 5, conc });
    report.phases[`cgnat_browse_c${conc}`] = s;
    const limited = s.statuses["429"] ?? 0;
    console.log(row(`browse, all from ${SHARED}`, s));
    console.log(`        429s: ${limited} of ${s.total}${limited ? "  <-- customers behind this IP are being blocked" : "  (nobody blocked)"}`);
  }
  const sOrders = await swarm((i) => hit(`${B}/api/orders`, {
    ...mkOrder(1000 + i),
    headers: { "content-type": "application/json", "x-forwarded-for": SHARED },
  }), { total: 30, conc: 10 });
  report.phases.cgnat_orders = sOrders;
  console.log(row(`checkout, all from ${SHARED}`, sOrders));
  console.log(`        statuses: ${JSON.stringify(sOrders.statuses)}  429s: ${sOrders.statuses["429"] ?? 0}`);

  /**
   * The limiter itself, which the checks above never reached.
   *
   * Browsing and checkout carry NO limiter — it is applied only to the endpoints where guessing
   * is the attack (login, register, reset, product-request, launch-signup). So "0 of 300 blocked"
   * above says nothing about CGNAT; it says those routes are unlimited. The honest question is:
   * on a route that IS limited, how many requests does one shared egress IP get before the
   * people behind it start seeing 429?
   *
   * Login is capped at 60 per 15 minutes per IP. Behind carrier-grade NAT that one address can
   * be an entire apartment block.
   */
  console.log("\n  the limiter itself — login is capped at 60 per IP per 15 minutes:");
  const loginReq = (i) => ({
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": SHARED },
    body: JSON.stringify({ email: `shared-cgnat-${i}@example.invalid`, password: "not-a-real-password" }),
  });
  const results = [];
  let firstBlockAt = null;
  for (let i = 0; i < 90; i++) {
    const res = await hit(`${B}/api/auth/login`, loginReq(i));
    results.push(res);
    if (res.status === 429 && firstBlockAt === null) firstBlockAt = i + 1;
  }
  const blocked = results.filter((x) => x.status === 429).length;
  report.phases.cgnat_limiter = { attempts: results.length, blocked, firstBlockAt };
  console.log(`    90 login attempts from one shared IP -> ${blocked} blocked, first 429 at attempt ${firstBlockAt ?? "never"}`);
  console.log(`    meaning: everyone behind ${SHARED} shares one allowance of ~${firstBlockAt ? firstBlockAt - 1 : "?"} sign-ins per 15 minutes`);

  console.log("\n══ 6. mixed burst — what a post actually looks like ════════════════════════");
  const mix = (i) => {
    const n = i % 10;
    if (n < 5) return hit(`${B}/api/products?limit=48&facets=1`);
    if (n < 7) return hit(`${B}/api/products/${sample[i % sample.length].slug}`);
    if (n < 9) return hit(`${B}/api/products?q=${encodeURIComponent(terms[i % terms.length])}`);
    return hit(`${B}/api/home`);
  };
  for (const conc of [25, 75, 150]) {
    const s = await swarm(mix, { total: conc * 4, conc });
    report.phases[`mixed_c${conc}`] = s;
    console.log(row("mixed storefront traffic", s));
    if (s.failed) console.log(`        statuses: ${JSON.stringify(s.statuses)}`);
  }

  const db2 = new PrismaClient({ datasources: { db: { url: pgUrl(DB) } } });
  report.ordersCreated = await db2.order.count();
  await db2.$disconnect();
  console.log(`\n  orders created during the run: ${report.ordersCreated} (in ${DB}, never production)`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "load-test.json"), JSON.stringify(report, null, 2));
  console.log(`  wrote .night/load-test.json\n`);
} catch (e) {
  console.error(`\n  load test failed: ${e.message}\n`);
  process.exitCode = 1;
} finally {
  stopServer(server);
}
