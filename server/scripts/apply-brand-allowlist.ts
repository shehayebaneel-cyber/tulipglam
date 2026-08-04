/**
 * Hide every product whose brand is not on the owner's list.
 *
 *     npx tsx scripts/apply-brand-allowlist.ts            # dry run — prints, changes nothing
 *     npx tsx scripts/apply-brand-allowlist.ts --write    # applies it
 *
 * The list is `prisma/brands-we-sell.txt`, one brand per line. Edit that, re-run this.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. This is a bulk status change over
 *  thousands of rows, so it prints the full picture first and writes only when told.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Reversible: nothing is deleted. Put a brand back in the file, run again, and its products
 * return — see `restore` below, which is the same operation pointed the other way.
 */
import { PrismaClient } from "@prisma/client";
import { applyBrandAllowlist, loadAllowlist } from "../prisma/brandAllowlist.js";

const db = new PrismaClient();
const WRITE = process.argv.includes("--write");

async function main() {
  const allow = loadAllowlist();
  const result = await applyBrandAllowlist(db, { write: false });

  console.log(`${WRITE ? "APPLYING" : "DRY RUN"} — brand allowlist\n`);
  console.log(`  brands on your list        ${allow.size}`);
  console.log(`  brands kept visible        ${result.keptBrands}`);
  console.log(`  brands hidden              ${result.hiddenBrands}`);
  console.log("");

  /**
   * A name in the file matching no brand is a stop, not a warning.
   *
   * It means either a typo or a brand the catalogue does not carry — and the consequence of
   * shrugging is that a brand the owner meant to KEEP gets hidden with the other 336, which is
   * exactly the failure this whole script is trying to avoid.
   */
  if (result.unmatched.length) {
    console.log(`  ✖ ${result.unmatched.length} name(s) in the list match no brand in the catalogue:`);
    for (const n of result.unmatched) console.log(`      ${n}`);
    console.log("\n  Fix the spelling in prisma/brands-we-sell.txt, or remove the line. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  const before = await db.product.count({ where: { status: "active" } });

  /**
   * The projection has to count ACTIVE products specifically.
   *
   * The first version printed "6,662 active -> about -223", because it subtracted `toHide` —
   * every product not already hidden, including the 1,771 marked `unavailable` — from the
   * active count alone. Two different populations, one subtraction, a negative number of
   * products in a shop. The arithmetic refusing to reconcile is what made it visible.
   */
  const keptIds = (await db.brand.findMany({ where: { name: { in: [...allow] } }, select: { id: true } })).map((b) => b.id);
  const activeAfter = await db.product.count({ where: { status: "active", brandId: { in: keptIds } } });

  console.log(`  products to hide           ${result.toHide.toLocaleString()}`);
  console.log(`  already hidden anyway      ${result.alreadyHidden.toLocaleString()}  (retired sections, broken prices)`);
  console.log("");
  console.log(`  storefront: ${before.toLocaleString()} active products  ->  ${activeAfter.toLocaleString()}`);
  console.log("");

  // What the shop still covers afterwards. A range is only a range if the departments a
  // customer opens still have something in them.
  const kept = await db.product.findMany({
    where: { status: { not: "hidden" }, brand: { name: { in: [...allow] } } },
    select: { category: { select: { name: true, parent: { select: { name: true } } } } },
  });
  const byDept = new Map<string, number>();
  for (const p of kept) {
    const d = p.category?.parent?.name ?? p.category?.name ?? "(uncategorised)";
    byDept.set(d, (byDept.get(d) ?? 0) + 1);
  }
  console.log("  what the shop still covers:");
  for (const [d, n] of [...byDept.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${d.padEnd(18)}${String(n).padStart(5)}${n < 25 ? "   ← thin" : ""}`);
  }

  if (!WRITE) {
    console.log("\n  Nothing was changed. Re-run with --write to apply.");
    return;
  }

  const applied = await applyBrandAllowlist(db, { write: true });
  const after = await db.product.count({ where: { status: "active" } });
  console.log(`\n  applied — ${applied.hidden.toLocaleString()} products hidden.`);
  console.log(`  storefront now has ${after.toLocaleString()} active products.`);
  console.log("\n  Reversible: edit prisma/brands-we-sell.txt and run scripts/restore-brand.ts <name>.");
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  // finally, with no process.exit() above it — that pattern once left test rows in production.
  .finally(async () => { await db.$disconnect(); });
