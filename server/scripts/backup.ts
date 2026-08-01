/**
 * Take a backup of everything that cannot be rebuilt.
 *
 *     npx tsx scripts/backup.ts              # writes ./backups/tulipglam-<stamp>.json.gz
 *     npx tsx scripts/backup.ts --dir "D:\backups"
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  READ-ONLY. This script never writes to the database. It is safe to run at any
 *  time, against production, while customers are ordering.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT IS WORTH BACKING UP, AND WHAT IS NOT ──────────────────────────────────────
 *
 * The catalogue is REPRODUCIBLE. 9,672 products, their images, variants and categories all come
 * from three importers with their source data committed in ../dali-import, ../beesline-import
 * and ../feel22-import. Losing them costs an afternoon of re-running `npm run import:*`.
 *
 * Orders, customers, loyalty ledgers, gift cards, coupons, launch signups and settings are NOT
 * reproducible. Lose those and the business has no record of who bought what, who is owed
 * points, or what a gift card is worth. That asymmetry is why this backs up the transactional
 * tables in full and deliberately skips the catalogue: a backup nobody runs because it takes
 * twenty minutes and produces 800 MB is worse than one that runs in seconds.
 *
 * If you DO want the catalogue too, pass --everything. It is slower and much larger, and you
 * almost certainly do not need it.
 *
 * ── WHY NOT pg_dump ────────────────────────────────────────────────────────────────
 *
 * Because it is not installed on this machine and getting it there is a dependency the owner
 * would have to maintain. This produces a logical dump through the same client the application
 * uses, which means it needs nothing beyond `npm install` — and the restore path is proven by
 * `restore-drill.ts` rather than assumed.
 */
import { PrismaClient } from "@prisma/client";
import { gzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const db = new PrismaClient();
const EVERYTHING = process.argv.includes("--everything");
const dirArg = process.argv.indexOf("--dir");
const OUT_DIR = dirArg >= 0 ? process.argv[dirArg + 1] : path.resolve("backups");

/**
 * Order matters on RESTORE, not here — parents before children, so a restore can insert in
 * this order without tripping a foreign key. Keep it that way when adding a table.
 */
const IRREPLACEABLE = [
  "setting",
  "deliveryArea",
  "customer",
  "address",
  "passwordReset",
  "coupon",
  "giftCard",
  "launchSignup",
  "order",
  "orderItem",
  "orderEvent",
  "loyaltyAccount",
  "loyaltyLedgerEntry",
  "loyaltyClaimDecision",
  "review",
] as const;

/** Rebuildable from the importers. Included only with --everything. */
const CATALOGUE = ["category", "brand", "product", "productImage", "productVariant"] as const;

async function main() {
  const tables = EVERYTHING ? [...IRREPLACEABLE, ...CATALOGUE] : [...IRREPLACEABLE];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const payload: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  console.log(`\nBacking up ${tables.length} tables${EVERYTHING ? " (including the catalogue)" : ""}…\n`);
  for (const t of tables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (db as any)[t];
    if (!model?.findMany) { console.log(`  ! no model "${t}" — skipped`); continue; }
    const rows = await model.findMany();
    payload[t] = rows;
    counts[t] = rows.length;
    console.log(`  ${t.padEnd(22)} ${String(rows.length).padStart(7)} rows`);
  }

  const body = {
    // Everything a restore needs to know it is looking at the right thing.
    meta: {
      takenAt: new Date().toISOString(),
      scope: EVERYTHING ? "everything" : "irreplaceable-only",
      tables,
      counts,
      // Not the URL — that carries the password. Just enough to tell two databases apart.
      database: (process.env.DATABASE_URL ?? "").replace(/\/\/[^@]*@/, "//***@").split("?")[0],
      note: EVERYTHING ? "" : "Catalogue excluded — rebuild it with npm run import:dali / :beesline / :feel22",
    },
    data: payload,
  };

  const file = path.join(OUT_DIR, `tulipglam-${stamp}.json.gz`);
  // Dates serialise to ISO strings through JSON; the restore parses them back. Gzip because a
  // year of orders as JSON is mostly repeated field names and compresses roughly ten to one.
  fs.writeFileSync(file, gzipSync(Buffer.from(JSON.stringify(body), "utf8"), { level: 9 }));

  const kb = Math.round(fs.statSync(file).size / 1024);
  const total = Object.values(counts).reduce((n, c) => n + c, 0);
  console.log(`\n  ${total} rows -> ${file}  (${kb} KB compressed)`);
  console.log(`\n  Verify it before you trust it:  npx tsx scripts/restore-drill.ts "${file}"\n`);

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("\nBACKUP FAILED:", e);
  await db.$disconnect();
  process.exit(1);
});
