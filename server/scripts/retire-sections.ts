/**
 * Retire catalogue sections the store does not sell.
 *
 *     npx tsx scripts/retire-sections.ts            # report only, writes nothing
 *     npx tsx scripts/retire-sections.ts --write    # applies
 *     npx tsx scripts/retire-sections.ts --write --restore   # puts them back
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. --write is live immediately.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Owner's decision, 30 July 2026:
 *   electricals  — hair dryers, stylers, epilators, shavers. Not a beauty range.
 *   oral-care    — toothpaste, brushes, mouthwash.
 *   gift-sets    — "my supplier doesn't sell in sets".
 *
 * Note that "electronics" means the `electricals` SUBcategory, not its parent. Accessories
 * also holds 40 non-electronic items — cotton pads, lenses, shaving, Dali's key charms — which
 * stay on sale.
 *
 * HOW, AND WHY NOT DELETE
 *
 * Two changes per section: the category is deactivated, and its products are set to `hidden`.
 * Deactivating alone is not enough — the storefront filters products by *status*, so the rows
 * would vanish from the nav but still turn up in /shop, in search and in the sitemap.
 *
 * Deleting is the wrong tool even though nothing here appears in a past order: every one of
 * these rows belongs to an importer, so the next `npm run import:feel22` would recreate them.
 * `hidden` is the answer the product statuses were designed for, and it is reversible.
 *
 * The importers now skip any product whose target category is inactive, so a re-import will
 * not bring these back — see the `inactive category` guard in prisma/import-feel22.ts.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const WRITE = process.argv.includes("--write");
const RESTORE = process.argv.includes("--restore");

/** Slugs to retire. A parent here does NOT imply its children — list each one you mean. */
const SECTIONS = ["electricals", "oral-care", "gift-sets"];

async function main() {
  console.log(RESTORE ? "\nRESTORING sections\n" : "\nRETIRING sections\n");

  let categories = 0;
  let products = 0;

  for (const slug of SECTIONS) {
    const cat = await db.category.findUnique({
      where: { slug },
      select: { id: true, name: true, active: true, children: { select: { id: true, name: true } } },
    });
    if (!cat) {
      console.log(`  ${slug}: no such category — skipped`);
      continue;
    }
    // Children come too: retiring a department must not leave its subcategories reachable.
    const ids = [cat.id, ...cat.children.map((c) => c.id)];

    const affected = RESTORE
      ? await db.product.count({ where: { categoryId: { in: ids }, status: "hidden" } })
      : await db.product.count({ where: { categoryId: { in: ids }, status: { not: "hidden" } } });
    const inOrders = await db.orderItem.count({ where: { product: { categoryId: { in: ids } } } });

    console.log(`  ${cat.name}${cat.children.length ? ` (+ ${cat.children.map((c) => c.name).join(", ")})` : ""}`);
    console.log(`    category active: ${cat.active} -> ${RESTORE}`);
    console.log(`    products to ${RESTORE ? "un-hide" : "hide"}: ${affected}`);
    if (inOrders) console.log(`    NOTE: ${inOrders} past order lines reference these — the orders keep their own name/price snapshot, so nothing is lost`);

    if (WRITE) {
      await db.category.updateMany({ where: { id: { in: ids } }, data: { active: RESTORE } });
      const r = RESTORE
        ? await db.product.updateMany({ where: { categoryId: { in: ids }, status: "hidden" }, data: { status: "active" } })
        : await db.product.updateMany({ where: { categoryId: { in: ids }, status: { not: "hidden" } }, data: { status: "hidden" } });
      products += r.count;
      categories += ids.length;
    }
  }

  if (!WRITE) {
    console.log("\n───────────────────────────────────────────────────────────────");
    console.log("DRY RUN — nothing was written.");
    console.log("To apply:  npx tsx scripts/retire-sections.ts --write");
    console.log("To undo:   npx tsx scripts/retire-sections.ts --write --restore");
    console.log("Restoring sets every product back to `active`; a row that was");
    console.log("`unavailable` before will come back as `active`.");
    console.log("───────────────────────────────────────────────────────────────");
  } else {
    console.log(`\nDone — ${categories} categories and ${products} products updated.`);
  }

  const left = await db.product.count({ where: { status: { in: ["active", "unavailable"] } } });
  console.log(`Storefront now shows ${left} products.`);
  await db.$disconnect();
}

main();
