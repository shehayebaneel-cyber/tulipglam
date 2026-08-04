/**
 * Rebuild the searchable text for every product, and the index behind it.
 *
 *     npx tsx scripts/rebuild-search.ts            # dry run — shows what would change
 *     npx tsx scripts/rebuild-search.ts --write    # rebuilds
 *
 * Run after any import, and after a bulk change to names, brands, categories or tags. The
 * importers call `refreshSearchText` themselves, so this is for hand edits and first setup.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  `searchText` is DERIVED. Nothing else reads it, nothing is lost by rebuilding it,
 *  and no other column is ever written here.
 * ══════════════════════════════════════════════════════════════════════════════════
 */
import { PrismaClient } from "@prisma/client";
import { refreshSearchText, ensureSearchIndex } from "../src/searchIndex.js";

const db = new PrismaClient();
const WRITE = process.argv.includes("--write");

async function main() {
  if (WRITE) {
    await ensureSearchIndex(db);
    console.log("  extension and index ensured");
  }

  const r = await refreshSearchText(db, { write: WRITE });

  console.log(`\n${WRITE ? "REBUILT" : "DRY RUN"}`);
  console.log(`  products scanned   ${r.scanned}`);
  console.log(`  searchText changed ${r.changed}`);
  if (r.samples.length) {
    console.log(`\n  samples:`);
    for (const s of r.samples) console.log(`    ${s.name.slice(0, 40).padEnd(42)}-> ${s.text.slice(0, 90)}`);
  }
  if (!WRITE) console.log(`\n  Nothing was written. Re-run with --write.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  // finally, with no process.exit() above it — that pattern once left test rows in production.
  .finally(async () => { await db.$disconnect(); });
