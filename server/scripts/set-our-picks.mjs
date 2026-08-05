/**
 * Set the eight products on the homepage's "Our Picks" rail.
 *
 *     node --env-file=.env --import tsx scripts/set-our-picks.mjs            # dry run, prints only
 *     node --env-file=.env --import tsx scripts/set-our-picks.mjs --write    # applies
 *     node --env-file=.env --import tsx scripts/set-our-picks.mjs --clear --write   # unpick all
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  WRITES TO THE SHARED PRODUCTION DATABASE when given --write. Dry run by default,
 *  and it only ever touches Product.isBestSeller — never a name, price, status or
 *  image. Fully reversible with --clear, or per-product in admin.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * ── WHY A SCRIPT AND NOT EIGHT CLICKS ──────────────────────────────────────────────
 *
 * Because the choice should be reviewable. Eight clicks leave no record of WHY these eight; a
 * file states the reasoning, survives in git, and can be re-run or reversed in one command when
 * the owner wants different ones.
 *
 * ── HOW THESE EIGHT WERE CHOSEN ────────────────────────────────────────────────────
 *
 * The rail is the first thing a customer sees, and with 1,178 active products across twelve
 * departments the job is to say "this is what this shop is" in eight tiles. So:
 *
 *   ONE PER DEPARTMENT — Makeup, Fragrance, Skincare, Hair, Bath & Body, Deodorant, Sun Care,
 *     Nails. A rail of eight fragrances would misdescribe a shop that is 253 makeup products
 *     deep. Fragrance is the largest department (400) and gets exactly one, like everything else.
 *
 *   A PRICE RANGE, $2.50 to $25.62 — so the rail does not read as expensive-only or cheap-only.
 *     A first-time visitor learns the shop's range from this row.
 *
 *   WEIGHTED TO THE DIRECT SUPPLIERS — Beesline and Dali are carried direct, and CLAUDE.md
 *     records that direct listings win over the same product resold: cleaner titles, our pricing,
 *     Dali's shade variants. Featuring a resold listing would advertise the worse of two rows we
 *     hold for the same thing.
 *
 *   CLEAN NAMES ONLY — every one reads as a product, not a supplier feed title. "Creamy Blush",
 *     not "Beesline Propolis Facial Wash 100ml (1+1 Free)".
 *
 *   EVERY ONE IS ACTIVE, PRICED ABOVE ZERO, AND HAS A REAL PHOTOGRAPH. The catalogue sweep found
 *     126 products with absurd prices and one active product with no image; none of them is here.
 *
 * These are a starting position, not a recommendation about what sells — nothing has sold yet.
 * The moment there are enough delivered orders, the rail stops being a choice at all and becomes
 * real best sellers (see picks.ts, and DECISIONS.md).
 */
import { PrismaClient } from "@prisma/client";

const WRITE = process.argv.includes("--write");
const CLEAR = process.argv.includes("--clear");

/** Chosen by hand. `why` is the reason this one and not another from the same department. */
const PICKS = [
  { id: 52, expect: "Trio Palette", why: "Makeup — the largest department after fragrance, and a palette reads as 'beauty shop' at a glance" },
  { id: 10990, expect: "Lattafa Ajwad Women Perfume", why: "Fragrance — the biggest department (400) and Lattafa the third-biggest brand; mid-price so the rail is not all cheap" },
  { id: 358, expect: "Night Cream", why: "Skincare — Beesline is the largest brand and a direct supplier; a night cream is the most legible skincare item" },
  { id: 207, expect: "Keratin Shampoo", why: "Hair — the cheapest entry on the rail at $2.61, showing the shop is not expensive-only" },
  { id: 63, expect: "Walnut Body Scrub", why: "Bath & Body — Dali, direct, and a scrub photographs better than another lotion" },
  { id: 269, expect: "Roll-On - 48hr - Elder Rose", why: "Deodorant — 101 active products; the department would otherwise be invisible on the homepage" },
  { id: 42, expect: "Sunscreen", why: "Sun Care — Lebanon, and sun care is the one department with an obvious season" },
  { id: 43, expect: "Red Nail Polish", why: "Nails — small (17) but the most visual department there is, and $2.50 anchors the low end" },
];

const db = new PrismaClient();
const money = (c) => `$${(c / 100).toFixed(2)}`;

try {
  if (CLEAR) {
    const current = await db.product.findMany({ where: { isBestSeller: true }, select: { id: true, name: true } });
    console.log(`\n  ${WRITE ? "clearing" : "would clear"} ${current.length} pick(s):`);
    for (const p of current) console.log(`    ${String(p.id).padStart(6)}  ${p.name}`);
    if (WRITE) {
      const r = await db.product.updateMany({ where: { isBestSeller: true }, data: { isBestSeller: false } });
      console.log(`\n  cleared ${r.count}\n`);
    } else console.log("\n  (dry run — pass --write)\n");
    await db.$disconnect();
    process.exit(0);
  }

  const rows = await db.product.findMany({
    where: { id: { in: PICKS.map((p) => p.id) } },
    select: {
      id: true, name: true, slug: true, status: true, priceCents: true, saleCents: true,
      isBestSeller: true,
      brand: { select: { name: true } },
      category: { select: { name: true, parent: { select: { name: true } } } },
      _count: { select: { images: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  console.log(`\n  ${WRITE ? "SETTING" : "WOULD SET"} Our Picks — 8 products\n`);
  let bad = 0;
  for (const pick of PICKS) {
    const r = byId.get(pick.id);
    if (!r) { console.log(`  MISSING  id ${pick.id} does not exist`); bad++; continue; }

    // Every one of these must hold, or the rail shows something broken. Checked here rather than
    // assumed, because the ids were chosen from a query run at a different moment.
    const problems = [];
    if (r.status !== "active") problems.push(`status=${r.status}`);
    if (r.priceCents <= 0) problems.push("price is zero");
    if (r._count.images === 0) problems.push("no image");
    if (!r.name.toLowerCase().includes(pick.expect.toLowerCase().slice(0, 10))) problems.push(`expected "${pick.expect}"`);

    const dept = r.category?.parent?.name ?? r.category?.name ?? "?";
    const price = r.saleCents ? `${money(r.saleCents)} (was ${money(r.priceCents)})` : money(r.priceCents);
    console.log(`  ${problems.length ? "PROBLEM " : r.isBestSeller ? "already " : "pick    "} ${String(r.id).padStart(6)}  ${dept.padEnd(13)}${(r.brand?.name ?? "—").padEnd(12)}${r.name.slice(0, 32).padEnd(33)}${price}`);
    console.log(`            ${pick.why}`);
    if (problems.length) { console.log(`            ^^ ${problems.join(", ")}`); bad++; }
  }

  if (bad) {
    console.log(`\n  ${bad} problem(s) — nothing applied. Fix the list first.\n`);
    process.exitCode = 1;
  } else if (WRITE) {
    // Replace, not add: the rail is exactly these eight, so anything previously flagged is
    // cleared in the same breath. Otherwise a second run leaves a rail of sixteen.
    const cleared = await db.product.updateMany({ where: { isBestSeller: true, id: { notIn: PICKS.map((p) => p.id) } }, data: { isBestSeller: false } });
    const set = await db.product.updateMany({ where: { id: { in: PICKS.map((p) => p.id) } }, data: { isBestSeller: true } });
    const total = await db.product.count({ where: { isBestSeller: true, status: "active" } });
    console.log(`\n  set ${set.count}, cleared ${cleared.count} previously picked — ${total} active picks now\n`);
  } else {
    console.log(`\n  (dry run — pass --write to apply. Reverse any time with --clear --write.)\n`);
  }
} finally {
  await db.$disconnect();
}
