/**
 * Propose an `audience` (men / women / unisex) for every product from signals already in the
 * data, so /men and /women have something to show.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  DRY RUN BY DEFAULT. Prints a report and writes nothing.
 *
 *      npx tsx scripts/classify-audience.ts              # report only
 *      npx tsx scripts/classify-audience.ts --write      # applies the proposals
 *      npx tsx scripts/classify-audience.ts --write --min-confidence=high
 *
 *  Review the report before using --write. The database is shared with production, so a
 *  write here is instantly live on the storefront.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Signals, highest confidence first:
 *   high   — the product already sits in the "For Him" / "For Her" fragrance category
 *   high   — an unambiguous name token: "for men", "pour homme", "beard", "aftershave"
 *   high   — the brand carries an owner-set default audience (Admin → Brands → Shop for)
 *   medium — a weaker name token on its own: "men", "homme", "male"
 *   medium — the brand is predominantly one audience *in this catalogue* (measured, not assumed)
 *   low    — anything else. Left unisex.
 *
 * The brand default is a stated fact, so it ranks above measured skew and above a weak name
 * token — 404 brands is a far smaller job than 9,533 products, and settling "Axe" once settles
 * every one of its rows. A per-product audience set by hand still wins over both.
 *
 * Matching is on WORD BOUNDARIES, never substrings: "Treatment", "Ointment", "Amenity" and
 * "Supplement" all contain "men" and must not be classified as men's product. Verified in the
 * report's false-positive section.
 *
 * Under-classifying is the safe failure. A lipstick appearing under /men is worse than a
 * men's moisturiser staying unisex.
 *
 * Products with `audienceLocked = true` were set by a human and are never touched.
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const WRITE = process.argv.includes("--write");
const MIN_CONF = (process.argv.find((a) => a.startsWith("--min-confidence="))?.split("=")[1] ?? "medium") as Conf;

type Conf = "high" | "medium" | "low";
type Audience = "men" | "women" | "unisex";
type Proposal = {
  id: number; name: string; brand: string; department: string; category: string;
  from: Audience; to: Audience; confidence: Conf; why: string;
};

// ---------------------------------------------------------------- signals
// \b is unreliable next to non-ASCII, so boundaries are asserted explicitly.
const W = "(?<![\\p{L}])"; // not preceded by a letter
const E = "(?![\\p{L}])";  // not followed by a letter
const rx = (body: string) => new RegExp(`${W}(?:${body})${E}`, "iu");

const MEN_STRONG = rx("for\\s+men|for\\s+him|pour\\s+homme|men'?s|beard|aftershave|after[-\\s]shave|barber");
// "shaving" / "shave" deliberately excluded: hair-removal language is not men-only, and it
// mis-flagged a women's underarm serum ("Delays Shaving") in the first dry run. Beard,
// aftershave and barber stay in MEN_STRONG because those are unambiguous.
const MEN_WEAK = rx("men|homme|male");
const WOMEN_STRONG = rx("for\\s+women|for\\s+her|pour\\s+femme|women'?s");
const WOMEN_WEAK = rx("women|femme|female");

const CONF_RANK: Record<Conf, number> = { high: 3, medium: 2, low: 1 };
/** Brand.audience is "" when the owner hasn't said, which must not be treated as a value. */
const AUDIENCE_VALUES = ["men", "women", "unisex"];

async function main() {
  const products = await db.product.findMany({
    select: {
      id: true, name: true, audience: true, audienceLocked: true,
      brand: { select: { id: true, name: true, audience: true } },
      category: { select: { slug: true, name: true, parent: { select: { name: true } } } },
    },
  });
  console.log(`Loaded ${products.length} products. ${products.filter((p) => p.audienceLocked).length} are locked by hand and will be skipped.\n`);

  // Brand skew, measured from this catalogue rather than assumed from a hardcoded list.
  // A brand only counts as predominantly one audience if the name signals agree strongly.
  const brandTally = new Map<number, { name: string; men: number; women: number; total: number }>();
  for (const p of products) {
    if (!p.brand) continue;
    const t = brandTally.get(p.brand.id) ?? { name: p.brand.name, men: 0, women: 0, total: 0 };
    if (MEN_STRONG.test(p.name) || MEN_WEAK.test(p.name)) t.men++;
    if (WOMEN_STRONG.test(p.name) || WOMEN_WEAK.test(p.name)) t.women++;
    t.total++;
    brandTally.set(p.brand.id, t);
  }
  const brandAudience = new Map<number, Audience>();
  for (const [id, t] of brandTally) {
    if (t.total < 3) continue; // too small to infer anything
    if (t.men / t.total >= 0.6 && t.men >= 3) brandAudience.set(id, "men");
    else if (t.women / t.total >= 0.6 && t.women >= 3) brandAudience.set(id, "women");
  }

  const proposals: Proposal[] = [];
  const lowConfidence: Proposal[] = [];

  for (const p of products) {
    if (p.audienceLocked) continue;

    const dept = p.category.parent?.name ?? p.category.name;
    const base = {
      id: p.id, name: p.name, brand: p.brand?.name ?? "—", department: dept,
      category: p.category.name, from: p.audience as Audience,
    };

    let to: Audience = "unisex";
    let confidence: Conf = "low";
    let why = "";

    // 1. the catalogue already says so
    if (p.category.slug === "perfume-him") { to = "men"; confidence = "high"; why = `already in ${p.category.name}`; }
    else if (p.category.slug === "perfume-her") { to = "women"; confidence = "high"; why = `already in ${p.category.name}`; }
    // 2. unambiguous name token
    else if (MEN_STRONG.test(p.name) && !WOMEN_STRONG.test(p.name)) { to = "men"; confidence = "high"; why = "name states men's"; }
    else if (WOMEN_STRONG.test(p.name) && !MEN_STRONG.test(p.name)) { to = "women"; confidence = "high"; why = "name states women's"; }
    // 3. the owner has declared what this brand is
    else if (p.brand && AUDIENCE_VALUES.includes(p.brand.audience)) {
      to = p.brand.audience as Audience;
      confidence = "high";
      why = `${p.brand.name} is set to ${to} in admin`;
    }
    // 4. weaker token
    else if (MEN_WEAK.test(p.name) && !WOMEN_WEAK.test(p.name)) { to = "men"; confidence = "medium"; why = "name hints men's"; }
    else if (WOMEN_WEAK.test(p.name) && !MEN_WEAK.test(p.name)) { to = "women"; confidence = "medium"; why = "name hints women's"; }
    // 5. brand skew, measured
    else if (p.brand && brandAudience.has(p.brand.id)) {
      to = brandAudience.get(p.brand.id)!;
      confidence = "medium";
      const t = brandTally.get(p.brand.id)!;
      why = `brand skews ${to} (${to === "men" ? t.men : t.women}/${t.total} of its products)`;
    }
    // ambiguous — both signals present
    else if ((MEN_WEAK.test(p.name) || MEN_STRONG.test(p.name)) && (WOMEN_WEAK.test(p.name) || WOMEN_STRONG.test(p.name))) {
      lowConfidence.push({ ...base, to: "unisex", confidence: "low", why: "name mentions both men and women" });
      continue;
    }

    if (to === base.from) continue;
    const prop = { ...base, to, confidence, why };
    if (CONF_RANK[confidence] >= CONF_RANK[MIN_CONF]) proposals.push(prop);
    else lowConfidence.push(prop);
  }

  // ---------------------------------------------------------------- report
  const men = proposals.filter((p) => p.to === "men");
  const women = proposals.filter((p) => p.to === "women");

  console.log("═══ PROPOSED ═══");
  console.log(`  men    ${men.length}`);
  console.log(`  women  ${women.length}`);
  console.log(`  (everything else stays unisex — ${products.length - proposals.length} products)\n`);

  const group = (rows: Proposal[], key: keyof Proposal, label: string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1);
    console.log(`  by ${label}:`);
    [...m].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, n]) => console.log(`    ${k.padEnd(24)} ${n}`));
  };

  for (const [label, rows] of [["MEN", men], ["WOMEN", women]] as const) {
    if (!rows.length) continue;
    console.log(`─── ${label} ───`);
    group(rows, "department", "department");
    group(rows, "brand", "brand");
    console.log("");
  }

  console.log("═══ SAMPLE (40) ═══");
  proposals.slice(0, 40).forEach((p) =>
    console.log(`  ${p.to.padEnd(6)} ${p.confidence.padEnd(6)} ${p.department.padEnd(16)} ${p.name.slice(0, 46).padEnd(48)} ${p.why}`));

  console.log(`\n═══ LOW CONFIDENCE — left unisex (${lowConfidence.length}) ═══`);
  lowConfidence.slice(0, 25).forEach((p) => console.log(`  ${p.department.padEnd(16)} ${p.name.slice(0, 50).padEnd(52)} ${p.why}`));

  // Proof the word-boundary matching does not fire on embedded "men".
  console.log("\n═══ FALSE-POSITIVE GUARD ═══");
  const traps = products.filter((p) => /ment|amenit|supplement|mentha?ol/i.test(p.name)).slice(0, 8);
  traps.forEach((p) => {
    const flagged = MEN_STRONG.test(p.name) || MEN_WEAK.test(p.name);
    console.log(`  ${flagged ? "FLAGGED " : "ignored "} ${p.name.slice(0, 62)}`);
  });
  console.log("  (all should read 'ignored' — these contain 'men' only inside another word)");

  // ---------------------------------------------------------------- write
  if (!WRITE) {
    console.log("\n───────────────────────────────────────────────────────────────");
    console.log("DRY RUN — nothing was written.");
    console.log("To apply, review the above and then run:");
    console.log("    npx tsx scripts/classify-audience.ts --write");
    console.log("This database is shared with production; the change is live immediately.");
    console.log("───────────────────────────────────────────────────────────────");
    await db.$disconnect();
    return;
  }

  console.log(`\nApplying ${proposals.length} changes (confidence >= ${MIN_CONF})…`);
  // Grouped by target value so this is two statements, not 700 round trips. Only ever touches
  // ids that appeared in the report, and never a locked row.
  let applied = 0;
  for (const target of ["men", "women"] as const) {
    const ids = proposals.filter((p) => p.to === target).map((p) => p.id);
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const r = await db.product.updateMany({ where: { id: { in: chunk }, audienceLocked: false }, data: { audience: target } });
      applied += r.count;
    }
  }
  console.log(`Done — ${applied} products updated. Locked rows were skipped.`);
  await db.$disconnect();
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
