/**
 * Just the brand names. One column, nothing else.
 *
 *     npx tsx scripts/brand-names.ts
 *
 * Writes `TulipGlam-brand-names.xlsx` to the repo root. Reads only.
 *
 * Deliberately separate from `brand-sheet.ts`, which is the working document for a supplier
 * conversation — counts, gaps, blank answer columns. Two files with two jobs beats one file with
 * a flag, because the moment they are both open on a laptop the one with eighteen columns and
 * the one with a single column must be distinguishable at a glance.
 */
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import path from "node:path";
import { fileURLToPath } from "node:url";

const db = new PrismaClient();

async function main() {
  const brands = await db.brand.findMany({
    // Only brands that actually have something on the shelf. A name with no products behind it
    // is a row of the database, not a brand the shop sells.
    where: { products: { some: {} } },
    select: { name: true },
  });

  /**
   * Sorted with a real collator, not `.sort()`.
   *
   * Default string ordering compares UTF-16 code units, which puts "L'Oréal Paris" and "Lancôme"
   * in positions no one scanning a printed list would expect — accented letters sort after "z".
   * A list read by a human has to be in the order a human reads.
   */
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const names = brands.map((b) => b.name).sort((a, b) => collator.compare(a, b));

  const sheet = XLSX.utils.aoa_to_sheet([["Brand"], ...names.map((n) => [n])]);
  sheet["!cols"] = [{ wch: 40 }];
  sheet["!freeze"] = { ySplit: 1 };
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: names.length, c: 0 } }) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Brands");

  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "TulipGlam-brand-names.xlsx");
  XLSX.writeFile(wb, out);

  console.log(`wrote ${path.basename(out)}`);
  console.log(`  ${names.length} brands, one column, A–Z`);
  console.log(`  first: ${names.slice(0, 3).join(" · ")}`);
  console.log(`  last : ${names.slice(-3).join(" · ")}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
