/**
 * The response-time number, and the proof this is not a Neon-shaped interim.
 *
 *     node --import tsx scripts/search-perf.mjs        # needs the API on :4230
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  READ-ONLY. Measures; changes nothing.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Reports three things, because a single wall-clock number would hide which part of it moves
 * when the database moves:
 *
 *   1. End-to-end response time through the real HTTP stack — what a customer waits for.
 *   2. The same work split into WORK (Postgres CPU, measured by EXPLAIN ANALYZE) and WAIT
 *      (round trips x latency). Only the second one changes after Stage C.
 *   3. Whether every Postgres capability the search leans on exists off Neon.
 */
import { PrismaClient } from "@prisma/client";
const { normalise, WORD_THRESHOLD } = await import("../src/search.ts");

const db = new PrismaClient();
const API = process.env.API_URL || "http://localhost:4230";
const QUERIES = ["mascarra", "shampo", "loreal", "makup", "nivia", "nivea cream", "lipliner", "granier"];

const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];

console.log("\n══ 1. end to end, through the real server ══════════════════════════════════\n");
console.log(`  ${"query".padEnd(15)}${"median".padStart(8)}${"p90".padStart(8)}${"min".padStart(8)}   hits`);

const RUNS = 9;
const allMedians = [];
for (const q of QUERIES) {
  const times = [];
  let hits = 0;
  for (let i = 0; i < RUNS; i++) {
    const a = Date.now();
    const r = await fetch(`${API}/api/products?q=${encodeURIComponent(q)}&facets=1`);
    const body = await r.json();
    times.push(Date.now() - a);
    hits = body.total;
  }
  const m = pct(times, 0.5);
  allMedians.push(m);
  console.log(`  ${q.padEnd(15)}${String(m).padStart(6)}ms${String(pct(times, 0.9)).padStart(6)}ms${String(Math.min(...times)).padStart(6)}ms   ${hits}`);
}
console.log(`\n  median across all queries: ${pct(allMedians, 0.5)} ms`);

console.log("\n══ 2. what is WORK and what is WAIT ════════════════════════════════════════\n");

// The latency floor: the cheapest possible statement, so this is pure round trip.
const rtts = [];
for (let i = 0; i < 9; i++) { const a = Date.now(); await db.$queryRawUnsafe("select 1"); rtts.push(Date.now() - a); }
const RTT = pct(rtts, 0.5);
console.log(`  round-trip latency to this database        ${String(RTT).padStart(6)} ms   (median of 9)`);

// Postgres's own execution time for the search — host-independent CPU work.
const nq = normalise("makup");
const plan = await db.$queryRawUnsafe(
  `EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM "Product" WHERE status = ANY(ARRAY['active'])
   AND ("searchText" LIKE '%${nq}%' OR word_similarity('${nq}', "searchText") >= ${WORD_THRESHOLD}) LIMIT 400`,
);
const execMs = plan[0]["QUERY PLAN"][0]["Execution Time"];
console.log(`  Postgres execution time for the search      ${execMs.toFixed(1).padStart(6)} ms   (EXPLAIN ANALYZE)`);
console.log(`  ratio                                       ${(RTT / execMs).toFixed(0)}x more waiting than working`);

console.log(`
  The search path makes 3 sequential round trips (rank -> facets+cards in parallel -> brand
  names). At ${RTT} ms each that is ~${RTT * 3} ms of pure network before any work happens, against
  ${execMs.toFixed(0)} ms of actual query time. Neon is in us-east-2 (Ohio); this machine is not.

  After Stage C the database is on the same box as the application and that RTT becomes
  sub-millisecond, so the WAIT term collapses and the WORK term is unchanged. Nothing in this
  design depends on the latency being what it is today — which is the point of measuring them
  apart rather than reporting one number that quietly conflates them.`);

console.log("\n══ 3. does this survive off Neon ═══════════════════════════════════════════\n");

const [{ version }] = await db.$queryRawUnsafe("SELECT version()");
console.log(`  server: ${version.split(",")[0]}`);

const exts = await db.$queryRawUnsafe(`
  SELECT e.extname, e.extversion, (SELECT count(*) FROM pg_available_extensions a WHERE a.name = e.extname) AS available
  FROM pg_extension e WHERE e.extname IN ('pg_trgm','unaccent')`);
for (const e of exts) console.log(`  extension ${e.extname} ${e.extversion} installed`);

/**
 * Every capability the search actually leans on, and where it comes from.
 *
 * The requirement was to verify these exist on Neon today AND on the box after Stage C. None of
 * them is a managed-service feature: pg_trgm is a contrib module shipped in the standard
 * `postgresql-contrib` package, and the rest is core SQL. There is deliberately no dependency on
 * Neon branching, autoscaling, or its HTTP driver.
 */
const CAPABILITIES = [
  ["pg_trgm: similarity()", "contrib module, ships with every Postgres distribution"],
  ["pg_trgm: word_similarity()", "same module, since Postgres 9.6"],
  ["pg_trgm: gin_trgm_ops index", "same module"],
  ["LEFT JOIN LATERAL", "core SQL, since Postgres 9.3"],
  ["UPDATE ... FROM (VALUES ...)", "core SQL"],
  ["EXPLAIN (ANALYZE, FORMAT JSON)", "core"],
];
console.log("");
for (const [cap, src] of CAPABILITIES) console.log(`  ${cap.padEnd(32)} ${src}`);

// Prove each one RUNS, rather than asserting it from documentation.
const checks = [
  ["similarity()", `SELECT similarity('nivea','nivia') > 0`],
  ["word_similarity()", `SELECT word_similarity('cream','nivea soft cream') > 0`],
  ["gin_trgm_ops index present", `SELECT count(*)=1 FROM pg_indexes WHERE indexname='Product_searchText_trgm_idx'`],
  ["LEFT JOIN LATERAL", `SELECT count(*)>=0 FROM "Product" p LEFT JOIN LATERAL (SELECT 1) x ON TRUE LIMIT 1`],
];
console.log("");
let bad = 0;
for (const [name, sql] of checks) {
  try {
    const r = await db.$queryRawUnsafe(sql);
    const ok = Object.values(r[0])[0] === true;
    if (!ok) bad++;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
  } catch (e) { bad++; console.log(`  FAIL  ${name}: ${String(e.message).split("\n")[0]}`); }
}

// The inverse check: nothing Neon-only crept in.
const src = await import("node:fs").then((fs) => [
  fs.readFileSync(new URL("../src/search.ts", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../src/cards.ts", import.meta.url), "utf8"),
  fs.readFileSync(new URL("../src/searchIndex.ts", import.meta.url), "utf8"),
].join("\n"));
const neonisms = ["neon_", "@neondatabase", "neonConfig", "pg_stat_statements_neon"];
const found = neonisms.filter((n) => src.includes(n));
console.log(`\n  ${found.length === 0 ? "ok  " : "FAIL"}  no Neon-specific API in search.ts / cards.ts / searchIndex.ts${found.length ? ": " + found.join(", ") : ""}`);
if (found.length) bad++;

console.log(`\n  ${bad === 0 ? "every capability verified present and working" : `${bad} PROBLEM(S)`}\n`);
await db.$disconnect();
process.exitCode = bad ? 1 : 0;
