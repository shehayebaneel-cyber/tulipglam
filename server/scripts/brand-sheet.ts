/**
 * The brand list, as a sheet to take to a supplier.
 *
 *     npx tsx scripts/brand-sheet.ts
 *
 * Writes `TulipGlam-brands.xlsx` to the repo root. Reads only — touches nothing.
 *
 * ── WHAT THIS IS FOR ───────────────────────────────────────────────────────────────
 *
 * Sitting across from a supplier and going through "can you get me this one". 404 brands is
 * more than anyone works through in one sitting, so the sheet is ordered and annotated to make
 * the first hour the valuable one, and it has empty columns for his answers because the answers
 * are the point — a list you cannot write on is a list you retype later.
 *
 * ── THE COLUMN THAT MATTERS MOST IS "UNAVAILABLE" ──────────────────────────────────
 *
 * Roughly two thousand products in this catalogue are listed as unavailable: the supplier feeds
 * say they exist but cannot currently be got. Those are not dead weight — they are demand
 * already on the shelf with nothing behind it. A brand with 90 listings of which 60 are
 * unavailable is a better question than a brand with 90 that are all fine.
 *
 * ── AND THE ORDER IS BY WHAT IS ACTUALLY A QUESTION ────────────────────────────────
 *
 * Beesline and Dali are carried direct, so asking a third party for those spends goodwill on
 * something already solved. But it is not a yes/no: Feel22 resells 43 Beesline products
 * alongside the 308 bought direct, and a first version that flagged only fully-direct brands
 * put Beesline at the TOP of the sheet — a brand 88% solved leading a list of things to ask
 * for. Rows are ordered by the count NOT already supplied direct, so a fully-covered brand
 * sinks on its own with no special case.
 */
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import path from "node:path";
import { fileURLToPath } from "node:url";

const db = new PrismaClient();

/** Sources already supplied direct — see the header note. */
const DIRECT = new Set(["beesline", "dali"]);

async function main() {
  const brands = await db.brand.findMany({
    select: {
      name: true,
      products: {
        select: {
          status: true, source: true, priceCents: true,
          // Needed to tell a product hidden because YOU retired its section from one hidden
          // because its price is broken — see the note on the two hidden columns below.
          category: { select: { active: true, parent: { select: { active: true } } } },
        },
      },
    },
  });

  type Row = {
    brand: string;
    total: number;
    active: number;
    unavailable: number;
    hiddenRetired: number;
    hiddenPrice: number;
    sources: string;
    alreadyDirect: number;
    toAsk: number;
    minCents: number;
    maxCents: number;
  };

  const rows: Row[] = brands
    .filter((b) => b.products.length > 0)
    .map((b) => {
      const prices = b.products.map((p) => p.priceCents).filter((c) => c > 0);
      const sources = [...new Set(b.products.map((p) => p.source || "manual"))].sort();
      return {
        brand: b.name,
        total: b.products.length,
        active: b.products.filter((p) => p.status === "active").length,
        unavailable: b.products.filter((p) => p.status === "unavailable").length,
        /**
         * TWO reasons a product is hidden, and they are opposite instructions.
         *
         * A first version had one column labelled "Hidden (bad price)". 1,195 of the 1,235
         * hidden products are hidden because the OWNER retired their section — Electricals,
         * Oral Care, Sets & Routines — and only 102 have a broken price. That label would have
         * sent him asking a supplier about Pupa products he had deliberately taken off the shop.
         *
         * Retired: do not ask, it was a decision. Broken price: worth asking, it is a blocker.
         */
        hiddenRetired: b.products.filter((p) =>
          p.status === "hidden" && (p.category?.active === false || p.category?.parent?.active === false)).length,
        // Hidden for a reason that is NOT a retired section. Defined by exclusion rather than
        // by testing the price, because a broken price is not always zero: Beesline's are
        // Lebanese-pound figures left behind after their store moved to USD (a mud mask at
        // 252390.00) and a flat 500.00 placeholder. Testing priceCents <= 0 found 4 of them.
        hiddenPrice: b.products.filter((p) =>
          p.status === "hidden"
          && !(p.category?.active === false || p.category?.parent?.active === false)).length,
        sources: sources.join(", "),
        /**
         * Split, rather than a yes/no flag.
         *
         * The first version marked a brand direct only when EVERY product came from a direct
         * source, which put Beesline at the very TOP of a list of things to ask a supplier for
         * — because Feel22 resells 43 Beesline products alongside the 308 bought direct. A
         * brand that is 88% solved was leading the sheet.
         *
         * What matters is the size of the genuine question: how many listings are NOT already
         * supplied direct. That is what the order is built on.
         */
        alreadyDirect: b.products.filter((p) => DIRECT.has(p.source || "")).length,
        toAsk: b.products.filter((p) => !DIRECT.has(p.source || "")).length,
        minCents: prices.length ? Math.min(...prices) : 0,
        maxCents: prices.length ? Math.max(...prices) : 0,
      };
    })
    // Biggest genuine question first. A brand entirely supplied direct has toAsk 0 and sinks
    // to the bottom on its own, with no special case needed.
    .sort((a, b) => b.toAsk - a.toAsk || b.total - a.total);

  const usd = (c: number) => (c > 0 ? Number((c / 100).toFixed(2)) : "");

  const sheet = XLSX.utils.json_to_sheet(
    rows.map((r, i) => ({
      "#": i + 1,
      "Brand": r.brand,
      "Products we list": r.total,
      "NOT already direct": r.toAsk,
      "Already direct": r.alreadyDirect || "",
      "Live now": r.active,
      "Unavailable — the gap": r.unavailable,
      "Hidden — you retired it": r.hiddenRetired || "",
      "Hidden — price needs fixing": r.hiddenPrice || "",
      "Where ours comes from": r.sources,
      "Fully covered?": r.toAsk === 0 ? "YES — skip" : "",
      "Our lowest $": usd(r.minCents),
      "Our highest $": usd(r.maxCents),
      // Blank, for him. This is the half of the sheet that does not exist yet.
      "Can he supply?": "",
      "His price": "",
      "Min order": "",
      "Lead time": "",
      "Notes": "",
    })),
  );

  sheet["!cols"] = [
    { wch: 5 }, { wch: 34 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 10 },
    { wch: 22 }, { wch: 22 }, { wch: 21 }, { wch: 22 }, { wch: 15 }, { wch: 12 }, { wch: 13 },
    { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 44 },
  ];
  // Freeze the header and the brand column, so scrolling right keeps the name in view — the
  // single thing that makes a 404-row sheet usable on a laptop at a table.
  sheet["!freeze"] = { xSplit: 2, ySplit: 1 };
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: 17 } }) };

  const noBrand = await db.product.count({ where: { brandId: null } });

  const totals = {
    brands: rows.length,
    products: rows.reduce((n, r) => n + r.total, 0),
    unavailable: rows.reduce((n, r) => n + r.unavailable, 0),
    hiddenRetired: rows.reduce((n, r) => n + r.hiddenRetired, 0),
    hiddenPrice: rows.reduce((n, r) => n + r.hiddenPrice, 0),
    direct: rows.filter((r) => r.toAsk === 0).length,
  };

  const guide = XLSX.utils.aoa_to_sheet([
    ["TulipGlam — brands to ask a supplier about"],
    [`Generated ${new Date().toISOString().slice(0, 10)} from the live catalogue.`],
    [],
    ["Brands", totals.brands],
    ["Products across them", totals.products],
    ["Listed but UNAVAILABLE", totals.unavailable, "← demand already on the shelf with nothing behind it"],
    ["Hidden — you retired the section", totals.hiddenRetired, "← your own decision. Do NOT ask about these."],
    ["Hidden — price needs fixing", totals.hiddenPrice, "← supplier price is wrong (some are still in Lebanese pounds). Worth asking."],
    ["Fully covered already", totals.direct, "← marked 'YES — skip', they sink to the bottom"],
    [],
    ["HOW THIS IS ORDERED"],
    ["By 'NOT already direct' — the number of listings for that brand you do NOT already"],
    ["buy direct from Beesline or Dali. That is the size of the genuine question, so the"],
    ["top of the sheet is where an hour of his time is worth the most."],
    ["Beesline sits mid-list, not top: 308 of its 351 come direct, only 43 are a question."],
    [],
    ["THE COLUMN TO WATCH"],
    ["'Unavailable — the gap' is the number of products we already list for that brand"],
    ["and currently cannot get. A brand with 90 listings of which 60 are unavailable is a"],
    ["better question than a brand with 90 that are all fine."],
    [],
    ["THE EMPTY COLUMNS ARE HIS ANSWERS"],
    ["Can he supply / His price / Min order / Lead time / Notes — fill them in as you go."],
    ["Prices shown are OUR current listed prices, not costs. They are the supplier feeds'"],
    ["retail figures, so treat them as a reference point and not as a margin."],
    [],
    ["WHAT THIS SHEET CANNOT SHOW YOU"],
    [],
    ["no row here. They are a separate job — give them a brand in admin and they join the list."],
    [],
    ["WHAT THIS SHEET CANNOT SHOW YOU"],
    [`${noBrand} products in the catalogue have no brand recorded at all, so they appear on no`],
    ["row here — no brand sheet can show them. Give them a brand in admin and they join the list."],
    [],
    ["Re-run any time: cd server && npx tsx scripts/brand-sheet.ts"],
  ]);
  guide["!cols"] = [{ wch: 36 }, { wch: 12 }, { wch: 58 }];

  const wb = XLSX.utils.book_new();
  // Guide first, so whoever opens it lands on the explanation rather than 404 rows.
  XLSX.utils.book_append_sheet(wb, guide, "Read me first");
  XLSX.utils.book_append_sheet(wb, sheet, "Brands to ask");

  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "TulipGlam-brands.xlsx");
  XLSX.writeFile(wb, out);

  console.log(`wrote ${path.basename(out)}`);
  console.log(`  ${totals.brands} brands, ${totals.products.toLocaleString()} products`);
  console.log(`  ${totals.unavailable.toLocaleString()} listed but unavailable — the gap worth asking about`);
  console.log(`  ${totals.direct} already direct, sorted to the bottom and marked skip`);
  console.log(`\n  top of the sheet:`);
  for (const r of rows.slice(0, 5)) {
    console.log(`    ${r.brand.padEnd(24)} ${String(r.toAsk).padStart(4)} to ask, ${String(r.total).padStart(4)} listed, ${String(r.unavailable).padStart(4)} unavailable`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
