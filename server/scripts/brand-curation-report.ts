/**
 * Brand curation report. READ-ONLY — this script never writes.
 *
 *      npx tsx scripts/brand-curation-report.ts
 *      npx tsx scripts/brand-curation-report.ts --csv > brands.csv
 *
 * The Feel22 import brought 404 brands, some of which read as filler in a premium beauty
 * directory (Always, Listerine, Lifebuoy, Adidas, Axe, Abercrombie & Fitch, Antonio Banderas).
 * Nothing is deleted or hidden here — the decision is editorial. This prints what you need to
 * make it: size, where the products sit, and whether the positioning problem is better solved
 * by surfacing the brand under Men than by hiding it.
 *
 * The `audience` column is the classifier's proposal, not applied data. A brand that is
 * predominantly men's is a candidate for /men rather than for hiding.
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const CSV = process.argv.includes("--csv");

/** Departments where an off-brand mass-market name is most visible to a premium shopper. */
const PREMIUM_SENSITIVE = new Set(["Makeup", "Skincare", "Fragrance"]);

const W = "(?<![\\p{L}])";
const E = "(?![\\p{L}])";
const MEN = new RegExp(`${W}(?:for\\s+men|for\\s+him|pour\\s+homme|men'?s|men|homme|male|beard|aftershave|barber)${E}`, "iu");
const WOMEN = new RegExp(`${W}(?:for\\s+women|for\\s+her|pour\\s+femme|women'?s|women|femme|female)${E}`, "iu");

async function main() {
  const brands = await db.brand.findMany({
    select: {
      id: true, name: true, slug: true, active: true, featured: true,
      products: {
        select: {
          name: true, status: true, audience: true,
          category: { select: { name: true, parent: { select: { name: true } } } },
        },
      },
    },
  });

  type Row = {
    name: string; slug: string; products: number; visible: number; unavailable: number;
    departments: string; topDepartment: string; proposedAudience: string;
    active: boolean; featured: boolean; flag: string;
  };

  const rows: Row[] = brands.map((b) => {
    const depts = new Map<string, number>();
    let men = 0, women = 0, visible = 0, unavailable = 0;
    for (const p of b.products) {
      const d = p.category.parent?.name ?? p.category.name;
      depts.set(d, (depts.get(d) ?? 0) + 1);
      if (p.status === "active") visible++;
      if (p.status === "unavailable") unavailable++;
      if (MEN.test(p.name) && !WOMEN.test(p.name)) men++;
      else if (WOMEN.test(p.name) && !MEN.test(p.name)) women++;
    }
    const sorted = [...depts].sort((a, b2) => b2[1] - a[1]);
    const total = b.products.length;
    const menShare = total ? men / total : 0;
    const womenShare = total ? women / total : 0;

    const proposedAudience =
      total >= 3 && menShare >= 0.6 ? "men"
      : total >= 3 && womenShare >= 0.6 ? "women"
      : total >= 3 && menShare >= 0.3 ? "mostly men"
      : "unisex";

    // Why this brand might need a decision.
    const flags: string[] = [];
    if (total === 1) flags.push("single product");
    else if (total <= 4) flags.push("very small");
    if (proposedAudience === "men" || proposedAudience === "mostly men") flags.push("→ surface under Men");
    if (sorted.some(([d]) => PREMIUM_SENSITIVE.has(d)) && total <= 4) flags.push("thin, in a premium department");
    if (total && unavailable / total >= 0.5) flags.push("mostly unavailable");

    return {
      name: b.name, slug: b.slug, products: total, visible, unavailable,
      departments: sorted.map(([d, n]) => `${d}:${n}`).join(" "),
      topDepartment: sorted[0]?.[0] ?? "—",
      proposedAudience, active: b.active, featured: b.featured,
      flag: flags.join("; "),
    };
  });

  rows.sort((a, b) => b.products - a.products);

  if (CSV) {
    const cols = ["name", "slug", "products", "visible", "unavailable", "topDepartment", "departments", "proposedAudience", "active", "featured", "flag"] as const;
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    console.log(cols.join(","));
    rows.forEach((r) => console.log(cols.map((c) => esc(r[c])).join(",")));
    await db.$disconnect();
    return;
  }

  console.log(`${rows.length} brands. READ-ONLY report — nothing was changed.\n`);

  const bucket = (lo: number, hi: number) => rows.filter((r) => r.products >= lo && r.products <= hi).length;
  console.log("═══ SIZE DISTRIBUTION ═══");
  console.log(`  1 product      ${bucket(1, 1)}`);
  console.log(`  2–4            ${bucket(2, 4)}`);
  console.log(`  5–9            ${bucket(5, 9)}`);
  console.log(`  10–49          ${bucket(10, 49)}`);
  console.log(`  50+            ${rows.filter((r) => r.products >= 50).length}\n`);

  console.log("═══ CANDIDATES FOR MEN'S RATHER THAN HIDING ═══");
  console.log("  These read as off-brand in a beauty directory but are coherent inventory under /men.");
  rows.filter((r) => r.proposedAudience === "men" || r.proposedAudience === "mostly men")
    .slice(0, 25)
    .forEach((r) => console.log(`  ${String(r.products).padStart(4)}  ${r.name.padEnd(26)} ${r.proposedAudience.padEnd(11)} ${r.topDepartment}`));

  console.log("\n═══ THIN BRANDS (≤4 products) ═══");
  console.log("  Candidates for the \"Also available\" section rather than the main directory.");
  rows.filter((r) => r.products <= 4)
    .slice(0, 30)
    .forEach((r) => console.log(`  ${String(r.products).padStart(4)}  ${r.name.padEnd(30)} ${r.topDepartment.padEnd(16)} ${r.flag}`));

  console.log("\n═══ MOSTLY UNAVAILABLE ═══");
  rows.filter((r) => r.products >= 3 && r.unavailable / r.products >= 0.5)
    .slice(0, 20)
    .forEach((r) => console.log(`  ${String(r.unavailable).padStart(4)}/${String(r.products).padEnd(4)} unavailable  ${r.name}`));

  console.log("\n═══ LARGEST 25 ═══");
  rows.slice(0, 25).forEach((r) => console.log(`  ${String(r.products).padStart(4)}  ${r.name.padEnd(28)} ${r.topDepartment}`));

  console.log("\nNothing was written. Use admin → Products (filter by brand) to hide, or the");
  console.log("brand's own Active toggle in admin → Brands to remove it from the storefront.");
  await db.$disconnect();
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
