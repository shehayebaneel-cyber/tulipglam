/**
 * Propose brand-name corrections: "Abercrombie and Fitch" → "Abercrombie & Fitch",
 * "Yves Saint-Laurent" → "Yves Saint Laurent", stray casing and spacing.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  DRY RUN BY DEFAULT. Prints a report and writes nothing.
 *
 *      npx tsx scripts/normalize-brand-names.ts            # report only
 *      npx tsx scripts/normalize-brand-names.ts --write    # applies
 *
 *  The database is shared with production, so a write here is live immediately.
 *  Slugs are NOT changed — they are in URLs that may already be linked or indexed.
 * ══════════════════════════════════════════════════════════════════════════════════
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const WRITE = process.argv.includes("--write");

/**
 * Explicit corrections only. No clever guessing: an over-eager rule would rename brands that
 * are legitimately spelled the way they are, and brand names are proper nouns.
 */
const EXACT: Record<string, string> = {
  "Abercrombie and Fitch": "Abercrombie & Fitch",
  "Yves Saint-Laurent": "Yves Saint Laurent",
  "Dolce and Gabbana": "Dolce & Gabbana",
  "Marc Jacobs ": "Marc Jacobs",
};

/** Structural tidy-ups that are safe for any name. */
function tidy(name: string): string {
  return name
    .replace(/\s+/g, " ")   // collapse internal runs of whitespace
    .replace(/\s+&\s+/g, " & ")
    .trim();
}

async function main() {
  const brands = await db.brand.findMany({
    select: { id: true, name: true, slug: true, _count: { select: { products: true } } },
    orderBy: { name: "asc" },
  });
  console.log(`Loaded ${brands.length} brands.\n`);

  type Change = { id: number; from: string; to: string; reason: string; products: number };
  const changes: Change[] = [];

  for (const b of brands) {
    const exact = EXACT[b.name];
    const proposed = exact ?? tidy(b.name);
    if (proposed !== b.name) {
      changes.push({
        id: b.id, from: b.name, to: proposed, products: b._count.products,
        reason: exact ? "explicit correction" : "whitespace / ampersand spacing",
      });
    }
  }

  // A rename can collide with a brand that already exists under the target name — that is a
  // merge, not a rename, and merges are not safe to automate.
  const byName = new Map(brands.map((b) => [b.name.toLowerCase(), b]));
  const collisions = changes.filter((c) => {
    const existing = byName.get(c.to.toLowerCase());
    return existing && existing.id !== c.id;
  });

  console.log(`═══ PROPOSED RENAMES (${changes.length}) ═══`);
  if (!changes.length) console.log("  none");
  changes.forEach((c) =>
    console.log(`  ${String(c.products).padStart(4)} products  ${c.from}  →  ${c.to}   (${c.reason})`));

  if (collisions.length) {
    console.log(`\n═══ ⚠ COLLISIONS — NOT SAFE TO AUTO-APPLY (${collisions.length}) ═══`);
    collisions.forEach((c) => console.log(`  "${c.from}" → "${c.to}" but a brand already uses that name.`));
    console.log("  These are merges. Decide which brand survives, move its products in admin, then re-run.");
  }

  console.log("\n═══ NOT CHANGED — flagged for your eye only ═══");
  console.log("  Names where the right answer is editorial, not mechanical:");
  brands
    .filter((b) => / and /i.test(b.name) && !EXACT[b.name])
    .forEach((b) => console.log(`    "${b.name}" — contains " and "; is "&" correct for this brand?`));

  console.log("\n  Slugs are deliberately left alone: they appear in URLs that may be linked or indexed.");

  if (!WRITE) {
    console.log("\n───────────────────────────────────────────────────────────────");
    console.log("DRY RUN — nothing was written.");
    console.log("To apply the safe renames (collisions are always skipped):");
    console.log("    npx tsx scripts/normalize-brand-names.ts --write");
    console.log("───────────────────────────────────────────────────────────────");
    await db.$disconnect();
    return;
  }

  const safe = changes.filter((c) => !collisions.includes(c));
  console.log(`\nApplying ${safe.length} renames (${collisions.length} collisions skipped)…`);
  for (const c of safe) await db.brand.update({ where: { id: c.id }, data: { name: c.to } });
  console.log("Done.");
  await db.$disconnect();
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
