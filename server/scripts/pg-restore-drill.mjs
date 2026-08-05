/**
 * The restore drill, against today's real production data.
 *
 *     node --import tsx scripts/restore-drill.mjs
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  PRODUCTION IS READ ONLY HERE. The only thing this does to it is `pg_dump`,
 *  which takes no locks that block writers and issues no writes of its own. Every
 *  write in this script targets the LOCAL cluster. There is no code path that can
 *  restore over production — the restore target is built from LOCAL_PG, which
 *  cannot be pointed at a remote host.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * ── WHY THIS RUN MATTERS MORE THAN THE LAST ONE ────────────────────────────────────
 *
 * BACKUP.md was written in the Neon era, when `pg_dump` was not available and the backup path
 * was JSON. That drill ran on SYNTHETIC data and still found two real bugs — JSON has no date
 * type, and a column parser split `numeric(4,2)` on the comma. Synthetic data found those; only
 * real data can find what real data breaks.
 *
 * After Stage C this stops being a nicety. Neon's undelete goes away and this becomes the only
 * safety net the business has.
 *
 * ── WHAT "PROVED" MEANS HERE ───────────────────────────────────────────────────────
 *
 * Not "pg_restore exited 0". The drill only passes if the STORE RUNS on the restored copy:
 * an API server boots against it, the homepage returns products, search works, a product page
 * resolves, and the row counts match the source table by table.
 */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { LOCAL_PG, pgUrl, startServer, stopServer, recorder } from "./e2e/driver.mjs";

const PG18 = process.env.PG18_BIN || "C:/pgportable/v18/pgsql/bin";
const PG_DUMP = path.join(PG18, "pg_dump.exe");
const PSQL = path.join(PG18, "psql.exe");
const RESTORE_DB = "tulip_restore_drill";
const PORT = 4320;
const OUT_DIR = path.resolve(process.cwd(), "..", ".night", "backup");

const r = recorder();
const started = Date.now();

/** Tables whose row counts must survive the round trip. Data, not schema. */
const TABLES = [
  "Product", "ProductImage", "ProductVariant", "Category", "Brand",
  "Order", "OrderItem", "OrderEvent", "Customer", "Address",
  "Coupon", "GiftCard", "Review", "Setting", "DeliveryArea",
  "LoyaltyAccount", "LoyaltyLedgerEntry", "ProductRequest", "OutboxMessage",
];

async function countAll(url) {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const out = {};
  for (const t of TABLES) {
    try {
      const rows = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`);
      out[t] = rows[0].n;
    } catch { out[t] = null; } // table may not exist in this schema version
  }
  await db.$disconnect();
  return out;
}

let server = null;
try {
  const PROD = process.env.DATABASE_URL;
  if (!PROD) throw new Error("DATABASE_URL not set — nothing to dump");
  if (!fs.existsSync(PG_DUMP)) throw new Error(`pg_dump not found at ${PG_DUMP}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  r.section("1. the dump — production is only ever READ:");

  // Version check FIRST. pg_dump refuses a server newer than itself, and finding that out
  // during a real incident is the worst possible time. This is the check BACKUP.md was missing.
  const dumpVersion = execFileSync(PG_DUMP, ["--version"], { encoding: "utf8" }).trim();
  const probe = new PrismaClient({ datasources: { db: { url: PROD } } });
  const [{ server_version }] = await probe.$queryRawUnsafe("SHOW server_version");
  await probe.$disconnect();
  const dumpMajor = Number(dumpVersion.match(/(\d+)\./)?.[1] ?? 0);
  const serverMajor = Number(String(server_version).match(/^(\d+)/)?.[1] ?? 0);
  r.ck(`pg_dump (${dumpMajor}) is at least as new as the server (${serverMajor})`,
    dumpMajor >= serverMajor, `${dumpVersion} vs server ${server_version}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dumpFile = path.join(OUT_DIR, `prod-${stamp}.dump`);

  const t0 = Date.now();
  execFileSync(PG_DUMP, [
    PROD,
    "--format=custom",          // pg_restore can be selective and parallel from this
    "--no-owner", "--no-privileges", // the restore target has different roles
    "--file", dumpFile,
  ], { stdio: "pipe", maxBuffer: 1024 * 1024 * 64 });
  const dumpMs = Date.now() - t0;
  const bytes = fs.statSync(dumpFile).size;
  r.ck("pg_dump produced a file", bytes > 0, `${bytes} bytes`);
  console.log(`        ${(bytes / 1024 / 1024).toFixed(1)} MB in ${(dumpMs / 1000).toFixed(1)}s -> ${path.basename(dumpFile)}`);

  const sourceCounts = await countAll(PROD);
  const sourceTotal = Object.values(sourceCounts).reduce((n, v) => n + (v ?? 0), 0);
  console.log(`        source rows: ${sourceTotal}`);

  r.section("2. the restore — into a LOCAL database, never production:");
  execSync(`"${PSQL}" "${pgUrl("postgres")}" -q -c "DROP DATABASE IF EXISTS ${RESTORE_DB} WITH (FORCE);" -c "CREATE DATABASE ${RESTORE_DB};"`, { stdio: "pipe" });

  const t1 = Date.now();
  let restoreWarnings = "";
  try {
    execFileSync(path.join(PG18, "pg_restore.exe"), [
      "--dbname", pgUrl(RESTORE_DB),
      "--no-owner", "--no-privileges",
      "--jobs", "4",
      dumpFile,
    ], { stdio: "pipe", maxBuffer: 1024 * 1024 * 64 });
  } catch (e) {
    // pg_restore exits non-zero on warnings too; keep them and judge on the data.
    restoreWarnings = String(e.stderr ?? e.message).slice(0, 800);
  }
  const restoreMs = Date.now() - t1;
  console.log(`        restored in ${(restoreMs / 1000).toFixed(1)}s${restoreWarnings ? " (with warnings)" : ""}`);
  if (restoreWarnings) console.log(`        ${restoreWarnings.split("\n").slice(0, 4).join("\n        ")}`);

  r.section("3. row counts, table by table — a restore that loses rows is not a restore:");
  const restoredCounts = await countAll(pgUrl(RESTORE_DB));
  let mismatched = [];
  for (const t of TABLES) {
    if (sourceCounts[t] === null) continue;
    if (sourceCounts[t] !== restoredCounts[t]) mismatched.push(`${t}: ${sourceCounts[t]} -> ${restoredCounts[t]}`);
  }
  r.ck("every table has the same row count as production", mismatched.length === 0, mismatched.join("; "));
  console.log(`        ${TABLES.filter((t) => sourceCounts[t] !== null).length} tables, ${sourceTotal} rows`);

  r.section("4. the extension and index search depends on survived:");
  const rdb = new PrismaClient({ datasources: { db: { url: pgUrl(RESTORE_DB) } } });
  const ext = await rdb.$queryRawUnsafe(`SELECT extversion FROM pg_extension WHERE extname='pg_trgm'`);
  r.ck("pg_trgm exists on the restored copy", ext.length === 1, JSON.stringify(ext));
  const idx = await rdb.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE indexname='Product_searchText_trgm_idx'`);
  r.ck("the trigram index came back with it", idx.length === 1, JSON.stringify(idx));

  r.section("5. THE ACTUAL TEST — does the store run on the restored copy:");
  server = await startServer({ dbName: RESTORE_DB, port: PORT });
  const base = server.base;

  const health = await fetch(`${base}/api/health`).then((x) => x.ok).catch(() => false);
  r.ck("an API server boots against the restored database", health);

  const home = await fetch(`${base}/api/home`).then((x) => x.json()).catch(() => null);
  r.ck("the homepage payload resolves", !!home, "no response");

  const shop = await fetch(`${base}/api/products?limit=12`).then((x) => x.json()).catch(() => null);
  r.ck("the shop returns the restored catalogue", (shop?.total ?? 0) > 0, `total ${shop?.total}`);
  // Written properly on the second pass. The first version was
  //   (shop.total === (x !== null ? undefined : -1)) || shop.total > 0
  // which is `false || shop.total > 0` — the same check as the line above it, wearing a longer
  // name. A check written to confirm what you already believe will confirm it.
  const activeInRestore = await rdb.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "Product" WHERE status = 'active'`);
  r.ck("the shop's total equals the restored active-product count",
    (shop?.total ?? -1) === activeInRestore[0].n,
    `shop says ${shop?.total}, database has ${activeInRestore[0].n} active`);

  const search = await fetch(`${base}/api/products?q=shampo&limit=5`).then((x) => x.json()).catch(() => null);
  r.ck("search works on the restored copy", (search?.total ?? 0) > 0, `total ${search?.total}`);
  r.ck("...and returns the right kind of thing",
    (search?.products ?? []).some((p) => /shampoo/i.test(p.name)),
    (search?.products ?? []).slice(0, 2).map((p) => p.name).join(", "));

  const firstSlug = shop?.products?.[0]?.slug;
  if (firstSlug) {
    const prod = await fetch(`${base}/api/products/${firstSlug}`).then((x) => x.json()).catch(() => null);
    r.ck("a product page resolves from restored data", !!prod?.slug, JSON.stringify(prod)?.slice(0, 80));
  }

  await rdb.$disconnect();

  r.section("6. the numbers this drill exists to produce:");
  console.log(`        dump          ${(dumpMs / 1000).toFixed(1)}s   ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`        restore       ${(restoreMs / 1000).toFixed(1)}s`);
  console.log(`        total drill   ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`        rows          ${sourceTotal}`);

  fs.writeFileSync(path.join(OUT_DIR, "last-drill.json"), JSON.stringify({
    at: new Date().toISOString(),
    dumpBytes: bytes, dumpMs, restoreMs,
    sourceCounts, restoredCounts,
    pgDump: dumpVersion, serverVersion: server_version,
    passed: r.fail === 0,
  }, null, 2));
} catch (e) {
  r.ck(`unexpected: ${String(e.message).split("\n")[0]}`, false);
} finally {
  stopServer(server);
}

console.log(`\n${r.fail ? `${r.fail} FAILED, ` : ""}${r.pass} passed\n`);
process.exitCode = r.fail ? 1 : 0;
