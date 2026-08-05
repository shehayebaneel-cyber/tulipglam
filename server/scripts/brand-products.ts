/**
 * Every brand with its products. Two columns, nothing else.
 *
 *     npx tsx scripts/brand-products.ts            # what the shop sells (active only)
 *     npx tsx scripts/brand-products.ts --all      # every status, plus a Status column
 *
 * Writes `TulipGlam-brand-products.xlsx` to the repo root. Reads only.
 *
 * ── WHY ACTIVE ONLY BY DEFAULT ─────────────────────────────────────────────────────
 *
 * "Each brand with its products" is a question about the shop, not about the database. The
 * catalogue carries 9,672 rows; 1,178 of them are on the shelf. The rest are hidden supplier
 * rows with broken prices, retired sections, and brands the owner does not stock — the brand
 * allowlist hides all of those on purpose, and a sheet that lists them again would undo that
 * curation on paper.
 *
 * `--all` exists for when the question really is about the database. It adds a Status column,
 * because a list mixing sellable and hidden rows without saying which is which is worse than
 * either list on its own.
 *
 * ── AND WHY THE SHEET IS FLAT ──────────────────────────────────────────────────────
 *
 * One row per product, brand repeated. Not one worksheet per brand, and not a merged "brand"
 * cell spanning its products — both look tidier and both stop Excel from filtering, sorting and
 * counting, which is the entire reason to want this in Excel rather than as a printed list.
 */
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import path from "node:path";
import { fileURLToPath } from "node:url";

const db = new PrismaClient();
const ALL = process.argv.includes("--all");

async function main() {
  const products = await db.product.findMany({
    where: ALL ? {} : { status: "active" },
    select: { name: true, status: true, brand: { select: { name: true } } },
  });

  /**
   * Sorted with a real collator, not `.sort()`.
   *
   * Default string ordering compares UTF-16 code units, which puts "L'Oréal Paris" and "Lancôme"
   * in positions no one scanning a printed list would expect — accented letters sort after "z".
   * A list read by a human has to be in the order a human reads.
   */
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

  /**
   * Products with no brand are grouped under a visible label rather than an empty cell.
   *
   * An empty cell in a sorted column reads as a glitch and sorts to the top, where it looks like
   * the file is broken. Naming the group says the row is fine and the DATA has a gap.
   */
  const NO_BRAND = "— no brand —";

  const rows = products
    .map((p) => ({ brand: p.brand?.name?.trim() || NO_BRAND, product: p.name.trim(), status: p.status }))
    .sort((a, b) => collator.compare(a.brand, b.brand) || collator.compare(a.product, b.product));

  const header = ALL ? ["Brand", "Product", "Status"] : ["Brand", "Product"];
  const body = rows.map((r) => (ALL ? [r.brand, r.product, r.status] : [r.brand, r.product]));

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = ALL ? [{ wch: 26 }, { wch: 68 }, { wch: 14 }] : [{ wch: 26 }, { wch: 74 }];
  // Freeze the header and turn on autofilter, so 1,178 rows are usable the moment it opens
  // rather than after someone remembers where the filter button is.
  sheet["!freeze"] = { ySplit: 1 };
  sheet["!autofilter"] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }),
  };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Brand products");

  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "TulipGlam-brand-products.xlsx");
  XLSX.writeFile(wb, out);

  const brands = new Map<string, number>();
  for (const r of rows) brands.set(r.brand, (brands.get(r.brand) ?? 0) + 1);
  const ranked = [...brands.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`wrote ${path.basename(out)}`);
  console.log(`  ${rows.length} products across ${brands.size} brands${ALL ? " (every status)" : " (active only)"}`);
  console.log(`  sorted by brand, then product, A–Z`);
  console.log(`  deepest: ${ranked.slice(0, 5).map(([b, n]) => `${b} (${n})`).join(" · ")}`);
  const singles = ranked.filter(([, n]) => n === 1).length;
  console.log(`  ${singles} brand${singles === 1 ? "" : "s"} with exactly one product`);
  if (brands.has(NO_BRAND)) console.log(`  ${brands.get(NO_BRAND)} product(s) have no brand — grouped under "${NO_BRAND}"`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
