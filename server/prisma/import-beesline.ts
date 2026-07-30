// TulipGlam — import the Beesline catalogue.
//
// Source: beesline-catalogue.json, pulled from beesline.com's Shopify products.json
// feed (see ../../beesline-import/README.md for how it was produced and refreshed).
// Supplier authorised the copy.
//
// Run:  npm run import:beesline
//
// DESTRUCTIVE + IDEMPOTENT, BUT SCOPED TO THE BEESLINE BRAND. Each run removes
// Beesline's own products and rebuilds them. Dali (and anything else) is untouched,
// as are orders, customers, coupons, gift cards and settings.
//
// --- decisions baked in here (owner, July 2026) -------------------------------
// SCOPE: all 308 products are imported, but status depends on the data quality flag
// the export assigned, so nothing broken reaches a customer:
//     ok             -> active        (191) sane USD price, in stock
//     out_of_stock   -> unavailable   (74)  price fine, not currently available
//     price_lbp      -> hidden        (24)  price still in Lebanese pounds
//     price_flat_500 -> hidden        (13)  flat 500.00 placeholder
//     price_zero     -> hidden        (6)   no price at all
//   The 43 hidden ones keep their bad price verbatim so it's obvious in admin what
//   needs fixing. Get the real figures from the Beesline rep, correct them, then flip
//   the status to active.
//
// PRICING: `price_regular` becomes our price and NO sale price is set — Beesline's own
//   promotions (7-50%, varying per product) are not carried over. These are their
//   retail prices, not wholesale, so set your own margin before selling.

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const db = new PrismaClient();

const CATALOG = path.resolve(import.meta.dirname, "beesline-catalogue.json");
const IMG_BASE = "/products/beesline"; // web/public — survives deploys (uploads/ is ephemeral)

type BlImage = { file: string; src: string; alt: string; width: number; height: number };
type BlProduct = {
  source_id: number; handle: string; title: string; sku: string;
  quality: "ok" | "out_of_stock" | "price_lbp" | "price_flat_500" | "price_zero";
  price_now: number; price_regular: number; on_sale: boolean; currency: string;
  in_stock: boolean; product_type: string; product_type_normalised: string;
  tags: string[]; grams: number; description: string; description_html: string;
  images: BlImage[]; published_at: string; source_url: string;
};

const STATUS_BY_QUALITY: Record<BlProduct["quality"], string> = {
  ok: "active",
  out_of_stock: "unavailable",
  price_lbp: "hidden",
  price_flat_500: "hidden",
  price_zero: "hidden",
};

// ---------------------------------------------------------------- taxonomy
// Beesline is deodorant/sun-care/skincare led, so Deodorant and Sun Care become
// departments of their own and Hair is switched back on. Nails/Makeup/Accessories
// belong to Dali and are left as they are.
const TOPS = [
  { slug: "skincare",    name: "Skincare",         blurb: "Cleanse, treat & protect",       glyph: "dropper",  tint: "#e9f0ee", sortOrder: 3 },
  { slug: "deodorant",   name: "Deodorant",        blurb: "Roll-ons & antiperspirants",     glyph: "bottle",   tint: "#eaf0f4", sortOrder: 4 },
  { slug: "sun-care",    name: "Sun Care",         blurb: "SPF, suntan & after sun",         glyph: "tube",     tint: "#f3ecd9", sortOrder: 5 },
  { slug: "hair",        name: "Hair",             blurb: "Care, repair & style",           glyph: "bottle",   tint: "#eeeaf3", sortOrder: 6 },
  { slug: "bath-body",   name: "Bath & Body",      blurb: "Wash, scrub & nourish",          glyph: "tube",     tint: "#eff0e6", sortOrder: 7 },
  { slug: "gift-sets",   name: "Sets & Routines",  blurb: "Multi-product bundles & offers", glyph: "jar",      tint: "#f5e9f0", sortOrder: 8 },
];

const SUBS = [
  // skincare
  { slug: "cleansers",     name: "Cleansers",     parent: "skincare",  blurb: "Foams, gels, micellar & removers", glyph: "bottle",  tint: "#e3eff0", sortOrder: 1 },
  { slug: "serums",        name: "Serums",        parent: "skincare",  blurb: "Targeted treatments",              glyph: "dropper", tint: "#e6eff0", sortOrder: 2 },
  { slug: "moisturisers",  name: "Moisturisers",  parent: "skincare",  blurb: "Day, night & sensitive zone",      glyph: "jar",     tint: "#eaf1ec", sortOrder: 3 },
  { slug: "masks",         name: "Masks",         parent: "skincare",  blurb: "Clay, cream & luxury masks",       glyph: "jar",     tint: "#f0ecf2", sortOrder: 4 },
  { slug: "toners",        name: "Toners",        parent: "skincare",  blurb: "Balance & refine",                 glyph: "bottle",  tint: "#e9f0f2", sortOrder: 5 },
  { slug: "eye-care",      name: "Eye Care",      parent: "skincare",  blurb: "Contour & brightening",            glyph: "dropper", tint: "#eceaf2", sortOrder: 6 },
  // sun care  (`sunscreen` already exists under skincare from the Dali import and is
  // re-parented here, which keeps Dali's two sunscreens with the rest of the SPF)
  { slug: "sunscreen",     name: "Sunscreen",     parent: "sun-care",  blurb: "Daily SPF protection",             glyph: "tube",    tint: "#f3ecd9", sortOrder: 1 },
  { slug: "suntan",        name: "Suntan",        parent: "sun-care",  blurb: "Oils & jellies",                   glyph: "bottle",  tint: "#f5e7cf", sortOrder: 2 },
  { slug: "after-sun",     name: "After Sun",     parent: "sun-care",  blurb: "Cool & repair",                    glyph: "tube",    tint: "#eaf2f0", sortOrder: 3 },
  // hair
  { slug: "shampoo",       name: "Shampoo",       parent: "hair",      blurb: "Wash & cleanse",                   glyph: "bottle",  tint: "#eeeaf3", sortOrder: 1 },
  { slug: "conditioner",   name: "Conditioner",   parent: "hair",      blurb: "Soften & detangle",                glyph: "bottle",  tint: "#efeaf1", sortOrder: 2 },
  { slug: "hair-treatments", name: "Treatments",  parent: "hair",      blurb: "Masks & oils",                     glyph: "dropper", tint: "#ede9f2", sortOrder: 3 },
  // bath & body
  { slug: "shower",        name: "Shower",        parent: "bath-body", blurb: "Creams, gels & soaps",             glyph: "tube",    tint: "#eff0e6", sortOrder: 1 },
  { slug: "body-care",     name: "Body Care",     parent: "bath-body", blurb: "Balms, lotions & hands",           glyph: "jar",     tint: "#f0f0e8", sortOrder: 2 },
  { slug: "intimate-care", name: "Intimate Care", parent: "bath-body", blurb: "Wash & sensitive zone",            glyph: "tube",    tint: "#f2eef0", sortOrder: 3 },
];

const REACTIVATE = ["hair", "gift-sets"]; // switched off during the Dali import
const RENAME_GIFT_SETS = true;            // "Gift Sets" -> "Sets & Routines"

// ---------------------------------------------------------------- placement
// 43 supplier `product_type` values, many of them near-duplicates or combos, so this
// is rule-based rather than a 308-row table. Title rules run FIRST because the type
// alone is ambiguous — "Mask" covers both face and hair masks, and the bundle titles
// ("X + Y") are what really identify a routine.
//
// Anything that matches nothing is a hard error, so a product can never be filed by
// accident.
// "(1+1 Free)" means the SAME product twice — an offer, not a bundle — so those
// markers are stripped before looking for a genuine multi-product title. Volume
// bonuses ("400 ml + 100 ml") and "SPF50+" must not read as a bundle either.
function tidyTitle(t: string): string {
  return t
    .replace(/\(\s*\d+\s*\+\s*\d+[^)]*\)/gi, " ")            // (1+1 Free), (1+1)
    .replace(/\b\d+\s*\+\s*\d+\s*(for\s*)?(free)?\b/gi, " ") // 1+1 Free, 1+1Free
    .replace(/\d+\s*m?l\s*\+\s*\d+\s*m?l/gi, " ")            // 400ml+100ml
    .replace(/\((special offer|promo pack|offer|refill)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// A real bundle joins two named products: a letter, space, plus, space, letter.
// "SPF50+ - Tinted" fails this because the + isn't followed by a space and a letter.
const BUNDLE_TITLE = /[A-Za-z)]\s+\+\s+[A-Za-z]/;
const BUNDLE_TYPES = new Set(["Routine", "Kit", "Cleanser + Toner", "Oil + Sunscreen", "Micellar + Sunscreen", "Sunscreen + Lip Balm"]);

const TITLE_RULES: [RegExp, string][] = [
  // hair, before the generic mask/oil rules can claim them
  [/\bshampoo\b/i, "shampoo"],
  [/\bconditioner\b|oil replacement/i, "conditioner"],
  [/\bhair\b/i, "hair-treatments"],
  // intimate care, before the generic cream/wash rules
  [/intimate|sensitive zone|sensifresh/i, "intimate-care"],
  // sun
  [/after ?sun/i, "after-sun"],
  [/suntan|tanning/i, "suntan"],
  [/sunscreen|sunfilter|ultrascreen|\bspf\b/i, "sunscreen"],
  // deodorant
  [/deo\b|deodorant|antiperspirant|roll-?on/i, "deodorant"],
  // lips -> Dali's existing makeup > lips
  [/lip care|lip balm/i, "lips"],
  // body & shower
  [/shower|body wash/i, "shower"],
  [/beeswax|rescue balm|corn remover|body lotion|hand/i, "body-care"],
  // face
  [/micellar|makeup remover|cleanser|facial foam|face wash|\bsoap\b|scrub/i, "cleansers"],
  [/\bserum\b|\bfluid\b/i, "serums"],
  [/\bmask\b/i, "masks"],
  [/\btoner\b/i, "toners"],
  [/eye contour|eye care/i, "eye-care"],
  [/night cream|day cream|face cream|moisturis|moituriz|hydrating cream|\bcream\b/i, "moisturisers"],
  [/face oil|dry feel oil/i, "serums"],
];

const TYPE_MAP: Record<string, string> = {
  "Roll-On": "deodorant", "Deodorant": "deodorant",
  "Sunscreen": "sunscreen", "Sun Care": "sunscreen", "Sun Oil": "suntan",
  "After Sun": "after-sun", "Lotion": "after-sun",
  "Shampoo": "shampoo", "Shampoos": "shampoo", "Conditioner": "conditioner",
  "Hair Treatment": "hair-treatments", "Hair Oil": "hair-treatments",
  "Cleanser": "cleansers", "Cleansers": "cleansers", "Micellar Water": "cleansers",
  "Micellar": "cleansers", "Makeup Remover": "cleansers", "Soap": "cleansers",
  "Scrub": "cleansers", "Instant Bright": "cleansers",
  "Serum": "serums", "Serums": "serums", "Face Oil": "serums",
  "Cream": "moisturisers", "Creams": "moisturisers", "Treatment": "moisturisers",
  "Mask": "masks", "Toner": "toners", "Eye Care": "eye-care",
  "Lip Care": "lips", "Lip Balm": "lips", "Lip Balms": "lips", "Balm": "body-care",
  "Shower Cream": "shower", "Shower Gels": "shower",
  "Body & Hands": "body-care",
  "Routine": "gift-sets", "Kit": "gift-sets",
  "Cleanser + Toner": "gift-sets", "Oil + Sunscreen": "gift-sets",
  "Micellar + Sunscreen": "gift-sets", "Sunscreen + Lip Balm": "gift-sets",
};

// Glyph per category, for the rare product with no usable photo.
const GLYPH: Record<string, string> = {
  deodorant: "bottle", sunscreen: "tube", suntan: "bottle", "after-sun": "tube",
  shampoo: "bottle", conditioner: "bottle", "hair-treatments": "dropper",
  cleansers: "bottle", serums: "dropper", moisturisers: "jar", masks: "jar",
  toners: "bottle", "eye-care": "dropper", lips: "lipstick",
  shower: "tube", "body-care": "jar", "intimate-care": "tube", "gift-sets": "jar",
};

function placeOf(p: BlProduct): string {
  const tidy = tidyTitle(p.title);
  // 1. genuine multi-product bundles / routines
  if (BUNDLE_TITLE.test(tidy) || /\bduo\b|\broutine\b|\bkit\b/i.test(tidy) || BUNDLE_TYPES.has(p.product_type_normalised)) return "gift-sets";
  // 2. what the product actually is, by title
  for (const [re, slug] of TITLE_RULES) if (re.test(tidy)) return slug;
  // 3. fall back to the supplier's type
  const byType = TYPE_MAP[p.product_type_normalised];
  if (byType) return byType;
  throw new Error(`No category rule matched: "${p.title}" (type="${p.product_type_normalised || "none"}")`);
}

const cents = (usd: number) => Math.round(usd * 100);
const firstSentence = (s: string) => {
  const m = s.match(/^[\s\S]*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim().slice(0, 300);
};

async function main() {
  const products: BlProduct[] = JSON.parse(fs.readFileSync(CATALOG, "utf8").replace(/^﻿/, ""));
  console.log(`Loaded ${products.length} Beesline products.`);

  // -- validate before touching the database -------------------------------
  const allCats = new Set([...TOPS.map((c) => c.slug), ...SUBS.map((c) => c.slug), "lips"]);
  const placements = new Map<number, string>();
  const problems: string[] = [];
  for (const p of products) {
    try {
      const slug = placeOf(p);
      if (!allCats.has(slug)) problems.push(`${p.title} -> unknown category "${slug}"`);
      placements.set(p.source_id, slug);
    } catch (e) { problems.push((e as Error).message); }
  }
  if (problems.length) throw new Error(`Placement failed for ${problems.length}:\n  ${problems.join("\n  ")}`);

  const imgDir = path.resolve(import.meta.dirname, "../../web/public/products/beesline");
  const files = new Set(fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : []);
  const lost: string[] = [];
  for (const p of products) for (const im of p.images) if (!files.has(im.file)) lost.push(`${p.title}: ${im.file}`);
  if (lost.length) throw new Error(`Missing ${lost.length} image files in web/public/products/beesline:\n  ${lost.slice(0, 10).join("\n  ")}`);

  console.log("Validation passed — every product placed, every image file present.");

  // -- taxonomy ------------------------------------------------------------
  for (const c of TOPS) {
    await db.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, blurb: c.blurb, glyph: c.glyph, tint: c.tint, sortOrder: c.sortOrder, active: true, parentId: null },
      create: { ...c, active: true },
    });
  }
  for (const c of SUBS) {
    const parent = await db.category.findUniqueOrThrow({ where: { slug: c.parent } });
    const { parent: _p, ...rest } = c;
    await db.category.upsert({
      where: { slug: c.slug },
      update: { ...rest, active: true, parentId: parent.id },
      create: { ...rest, active: true, parentId: parent.id },
    });
  }
  if (RENAME_GIFT_SETS) await db.category.update({ where: { slug: "gift-sets" }, data: { name: "Sets & Routines", blurb: "Multi-product bundles & offers" } });
  console.log(`Taxonomy: ${TOPS.length} departments upserted, ${SUBS.length} subcategories, reactivated ${REACTIVATE.join(" + ")}.`);

  const catId = new Map<string, number>();
  for (const c of await db.category.findMany({ select: { slug: true, id: true } })) catId.set(c.slug, c.id);

  // -- brand ---------------------------------------------------------------
  const brand = await db.brand.upsert({
    where: { slug: "beesline" },
    update: { name: "Beesline", blurb: "Natural beauty, made in Lebanon since 1993", featured: true, active: true, sortOrder: 2 },
    create: { slug: "beesline", name: "Beesline", blurb: "Natural beauty, made in Lebanon since 1993", featured: true, active: true, sortOrder: 2 },
  });

  // -- clear out the previous Beesline import (scoped to this brand) --------
  const oldIds = (await db.product.findMany({ where: { brandId: brand.id }, select: { id: true } })).map((p) => p.id);
  if (oldIds.length) {
    const relinked = await db.orderItem.updateMany({ where: { productId: { in: oldIds } }, data: { productId: null } });
    const gone = await db.product.deleteMany({ where: { brandId: brand.id } });
    console.log(`Removed ${gone.count} previous Beesline products (${relinked.count} order items unlinked but intact).`);
  }
  const otherBrands = await db.product.count({ where: { brandId: { not: brand.id } } });
  console.log(`Left ${otherBrands} products from other brands untouched.`);

  // -- insert --------------------------------------------------------------
  let n = 0, nImages = 0;
  const byStatus: Record<string, number> = {};
  const byCat: Record<string, number> = {};

  for (const p of products) {
    const slug = placements.get(p.source_id)!;
    const categoryId = catId.get(slug)!;
    const tint = [...TOPS, ...SUBS].find((c) => c.slug === slug)?.tint ?? "#f5e9f0";
    const status = STATUS_BY_QUALITY[p.quality];

    // Regular price only — Beesline's own promo is deliberately not carried over.
    // Broken prices are kept verbatim so they're visible in admin (those rows are hidden).
    const priceCents = cents(p.price_regular || p.price_now || 0);

    const shortDesc = firstSentence(p.description);
    const description = p.description;

    const created = await db.product.create({
      data: {
        slug: p.handle,
        name: p.title,
        sku: p.sku,
        status,
        priceCents,
        saleCents: null,
        shortDesc,
        description,
        howToUse: "",
        ingredients: "",
        glyph: GLYPH[slug] ?? "bottle",
        tint,
        isBestSeller: false,
        isNewMode: "never", // an existing supplier range, not new arrivals for this store
        concerns: "",
        attributes: "",
        categoryId,
        brandId: brand.id,
        images: { create: p.images.map((im, i) => ({ url: `${IMG_BASE}/${im.file}`, alt: im.alt || p.title, sortOrder: i })) },
      },
      include: { images: true },
    });

    n++;
    nImages += created.images.length;
    byStatus[status] = (byStatus[status] || 0) + 1;
    byCat[slug] = (byCat[slug] || 0) + 1;
  }

  console.log(`\nImported ${n} products, ${nImages} images.`);
  console.log("\nBy status:");
  for (const [s, c] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(14)} ${c}`);
  console.log("\nBy category:");
  for (const [s, c] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(16)} ${c}`);
}

main()
  .then(async () => { await db.$disconnect(); console.log("\nDone."); })
  .catch(async (e) => { console.error("\nImport failed:", e); await db.$disconnect(); process.exit(1); });
