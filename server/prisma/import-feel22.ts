// TulipGlam — import the Feel22 catalogue.
//
// Source: feel22-catalogue.json, pulled from feel22.com's Shopify products.json feed
// (see ../../feel22-import/README.md). Supplier authorised the copy.
//
// Run:  npm run import:feel22        (run AFTER import:dali and import:beesline)
//
// DESTRUCTIVE + IDEMPOTENT, SCOPED BY `source = "feel22"`. Other imports are untouched.
//
// --- what makes this one different -------------------------------------------
// Feel22 is a multi-brand RETAILER, not a single-brand supplier: 9,381 products across
// 404 vendors (L'Oreal, Clarins, Clinique, Shiseido, Kerastase...). So this importer
// creates a Brand row per vendor, and it is the only import that carries real variants
// (Size / Shade / Color / Scent) besides Dali's shades.
//
// --- decisions baked in here (owner, July 2026) -------------------------------
// SCOPE:   all 9,381 products. Status from the export's quality flag:
//            ok -> active, out_of_stock -> unavailable, price_zero -> hidden.
// PRICING: `price_regular` becomes our price, NO sale price — same rule as the Dali and
//          Beesline imports. Feel22's own promotions (10-50%, varying) are not carried
//          over. These are retail prices, so set your own margin before selling.
// IMAGES:  one CDN-resized (_600x600) image per product, self-hosted under
//          web/public/products/feel22/. The full catalogue is 32,720 images / ~12 GB,
//          which is why only the first per product is kept.
// DUPES:   Feel22 resells brands we already buy direct (97 Beesline, 9 Dali products).
//          Where a Feel22 product matches one we already have from the brand itself, the
//          DIRECT version wins and Feel22's copy is skipped. The direct listings have
//          cleaner titles ("Keratin Conditioner" vs "Beesline Keratin Conditioner
//          200ml"), our own pricing, and — for Dali — the shade variants and swatches.
//          Nothing is deleted; the Feel22 row is simply never created.

import { PrismaClient } from "@prisma/client";
import { stripGeneratedImages } from "./generated-images.js";
import fs from "node:fs";
import path from "node:path";

const db = new PrismaClient();

const CATALOG = path.resolve(import.meta.dirname, "feel22-catalogue.json");
const IMG_BASE = "/products/feel22";
const SOURCE = "feel22";

type F2Image = { file: string; src: string; src_600: string; alt: string };
type F2Variant = {
  variant_id: number; title: string; option1: string; option2: string; option3: string;
  sku: string; barcode: string; quality: "ok" | "out_of_stock" | "price_zero";
  price_now: number; price_regular: number; on_sale: boolean; in_stock: boolean;
  grams: number; image: string;
};
type F2Product = {
  product_id: number; handle: string; title: string; brand: string; product_type: string;
  tags: string[]; option_names: string[]; description: string; description_html: string;
  published_at: string; source_url: string; images: F2Image[]; variants: F2Variant[];
};

// ---------------------------------------------------------------- taxonomy
// Feel22's product types are clean and consistent, so placement is an explicit table of
// all 110 values rather than regex guesswork. An unmapped type is a hard error.
const TOPS = [
  { slug: "makeup",      name: "Makeup",          blurb: "Face, eyes, lips & tools",        glyph: "lipstick", tint: "#f7e2e6", sortOrder: 2 },
  { slug: "skincare",    name: "Skincare",        blurb: "Cleanse, treat & protect",        glyph: "dropper",  tint: "#e9f0ee", sortOrder: 3 },
  { slug: "fragrance",   name: "Fragrance",       blurb: "Eau de parfum & mists",           glyph: "mist",     tint: "#f3ece4", sortOrder: 4 },
  { slug: "hair",        name: "Hair",            blurb: "Care, repair & style",            glyph: "bottle",   tint: "#eeeaf3", sortOrder: 5 },
  { slug: "bath-body",   name: "Bath & Body",     blurb: "Wash, scrub & nourish",           glyph: "tube",     tint: "#eff0e6", sortOrder: 6 },
  { slug: "deodorant",   name: "Deodorant",       blurb: "Roll-ons & antiperspirants",      glyph: "bottle",   tint: "#eaf0f4", sortOrder: 7 },
  { slug: "sun-care",    name: "Sun Care",        blurb: "SPF, tanning & after sun",        glyph: "tube",     tint: "#f3ecd9", sortOrder: 8 },
  { slug: "oral-care",   name: "Oral Care",       blurb: "Brush, paste & rinse",            glyph: "tube",     tint: "#e8f0f2", sortOrder: 9 },
  { slug: "kids-baby",   name: "Kids & Baby",     blurb: "Gentle care for little ones",     glyph: "bottle",   tint: "#eef2f6", sortOrder: 10 },
  { slug: "wellness",    name: "Wellness",        blurb: "Supplements, sleep & self-care",  glyph: "jar",      tint: "#eef0ea", sortOrder: 11 },
  { slug: "gift-sets",   name: "Sets & Routines", blurb: "Bundles, sets & offers",          glyph: "jar",      tint: "#f5e9f0", sortOrder: 12 },
  { slug: "accessories", name: "Accessories",     blurb: "Tools, devices & extras",         glyph: "jar",      tint: "#f3ece4", sortOrder: 13 },
];

const SUBS = [
  // makeup
  { slug: "face",            name: "Face",             parent: "makeup",      glyph: "compact",  tint: "#f3e7dd", sortOrder: 1 },
  { slug: "eyes",            name: "Eyes",             parent: "makeup",      glyph: "lipstick", tint: "#e8e6ef", sortOrder: 2 },
  { slug: "lips",            name: "Lips",             parent: "makeup",      glyph: "lipstick", tint: "#f7dde6", sortOrder: 3 },
  { slug: "makeup-tools",    name: "Brushes & Tools",  parent: "makeup",      glyph: "jar",      tint: "#f0eae4", sortOrder: 4 },
  // skincare
  { slug: "cleansers",       name: "Cleansers",        parent: "skincare",    glyph: "bottle",   tint: "#e3eff0", sortOrder: 1 },
  { slug: "serums",          name: "Serums",           parent: "skincare",    glyph: "dropper",  tint: "#e6eff0", sortOrder: 2 },
  { slug: "moisturisers",    name: "Moisturisers",     parent: "skincare",    glyph: "jar",      tint: "#eaf1ec", sortOrder: 3 },
  { slug: "masks",           name: "Masks",            parent: "skincare",    glyph: "jar",      tint: "#f0ecf2", sortOrder: 4 },
  { slug: "toners",          name: "Toners & Mists",   parent: "skincare",    glyph: "bottle",   tint: "#e9f0f2", sortOrder: 5 },
  { slug: "eye-care",        name: "Eye Care",         parent: "skincare",    glyph: "dropper",  tint: "#eceaf2", sortOrder: 6 },
  { slug: "skincare-tools",  name: "Skincare Tools",   parent: "skincare",    glyph: "jar",      tint: "#eceef0", sortOrder: 7 },
  // fragrance
  { slug: "perfume-her",     name: "For Her",          parent: "fragrance",   glyph: "mist",     tint: "#f6e8ec", sortOrder: 1 },
  { slug: "perfume-him",     name: "For Him",          parent: "fragrance",   glyph: "mist",     tint: "#e8ecf2", sortOrder: 2 },
  { slug: "perfume-unisex",  name: "Unisex",           parent: "fragrance",   glyph: "mist",     tint: "#f0ece6", sortOrder: 3 },
  { slug: "body-mist",       name: "Mists & Sprays",   parent: "fragrance",   glyph: "mist",     tint: "#f2eef0", sortOrder: 4 },
  // hair
  { slug: "shampoo",         name: "Shampoo",          parent: "hair",        glyph: "bottle",   tint: "#eeeaf3", sortOrder: 1 },
  { slug: "conditioner",     name: "Conditioner",      parent: "hair",        glyph: "bottle",   tint: "#efeaf1", sortOrder: 2 },
  { slug: "hair-treatments", name: "Treatments",       parent: "hair",        glyph: "dropper",  tint: "#ede9f2", sortOrder: 3 },
  { slug: "hair-styling",    name: "Styling & Colour", parent: "hair",        glyph: "bottle",   tint: "#eeecf4", sortOrder: 4 },
  // bath & body
  { slug: "shower",          name: "Shower & Soap",    parent: "bath-body",   glyph: "tube",     tint: "#eff0e6", sortOrder: 1 },
  { slug: "body-care",       name: "Body Care",        parent: "bath-body",   glyph: "jar",      tint: "#f0f0e8", sortOrder: 2 },
  { slug: "intimate-care",   name: "Intimate Care",    parent: "bath-body",   glyph: "tube",     tint: "#f2eef0", sortOrder: 3 },
  // sun care
  { slug: "sunscreen",       name: "Sunscreen",        parent: "sun-care",    glyph: "tube",     tint: "#f3ecd9", sortOrder: 1 },
  { slug: "suntan",          name: "Tanning",          parent: "sun-care",    glyph: "bottle",   tint: "#f5e7cf", sortOrder: 2 },
  { slug: "after-sun",       name: "After Sun",        parent: "sun-care",    glyph: "tube",     tint: "#eaf2f0", sortOrder: 3 },
  // electricals live under accessories
  { slug: "electricals",     name: "Electricals",      parent: "accessories", glyph: "jar",      tint: "#eceef2", sortOrder: 1 },
];

// Every one of Feel22's 110 product_type values, mapped explicitly.
const TYPE_MAP: Record<string, string> = {
  // ---- makeup
  "Foundation": "face", "Concealer and Corrector": "face", "Powder": "face", "Primer": "face",
  "Blush": "face", "Bronzer": "face", "Highlighter": "face", "Contour": "face",
  "BB and CC Cream": "face", "Face Palette": "face", "Setting Spray": "face",
  "Mascara": "eyes", "Eyeliner": "eyes", "Eyeshadow": "eyes", "Eyebrows": "eyes",
  "Eyelash Serum": "eyes", "False Lashes": "eyes",
  "Lipstick": "lips", "Lip Gloss and Lip Tint": "lips", "Lip Liner": "lips",
  "Lip Oil": "lips", "Lip Care": "lips",
  "Makeup Tools and Brushes": "makeup-tools", "Makeup Remover": "makeup-tools",
  // ---- skincare
  "Cleanser and Face Soap": "cleansers", "Face Scrub and Exfoliators": "cleansers",
  "Electrical Cleanser": "cleansers",
  "Serum and Treatment": "serums", "Face Oil": "serums",
  "Day and Night Cream": "moisturisers",
  "Face Mask": "masks", "Eye Mask": "masks",
  "Toner": "toners", "Face Mist and Spray": "toners",
  "Eye Cream": "eye-care",
  "Skincare Tools and Accessories": "skincare-tools",
  // ---- fragrance
  "Perfume For Her": "perfume-her", "Perfume Set For Her": "perfume-her",
  "Perfume For Him": "perfume-him", "Perfume Set For Him": "perfume-him",
  "Unisex Perfume": "perfume-unisex", "Unisex Perfume Set": "perfume-unisex",
  "Kids Perfumes": "perfume-unisex",
  "Mist and Spray For Her": "body-mist", "Mist and Spray for Him": "body-mist",
  "Unisex Mist and Spray": "body-mist",
  // ---- hair
  "Shampoo": "shampoo", "Dry Shampoo": "shampoo",
  "Conditioner": "conditioner",
  "Hair Mask": "hair-treatments", "Hair Oil and Serum": "hair-treatments",
  "Scalp Treatment and Vials": "hair-treatments", "Hair Vitamins": "hair-treatments",
  "Hair Styling": "hair-styling", "Hair Color": "hair-styling",
  "Hair Brushes and Combs": "hair-styling", "Hair Accessories": "hair-styling",
  // ---- bath & body
  "Shower Gel and Body Wash": "shower", "Hand and Body Soap": "shower",
  "Body Lotion and Oil": "body-care", "Body Scrubs and Exfoliators": "body-care",
  "Hand Care": "body-care", "Foot Care": "body-care",
  "Intimate Hygiene": "intimate-care",
  // ---- deodorant
  "Deodorant For Her": "deodorant", "Deodorant For Him": "deodorant", "Unisex Deodorant": "deodorant",
  // ---- sun care
  "Sun Protection": "sunscreen", "Tanning": "suntan", "After Sun": "after-sun",
  // ---- nails (Dali's existing subcategories)
  "Nail Polish": "nail-colors", "Base and Top Coat": "nail-colors",
  "Nail Care": "nail-care", "Nail Polish Remover": "nail-care", "Nail Tools and Sets": "nail-care",
  // ---- oral care
  "Toothpaste": "oral-care", "Toothbrush": "oral-care", "Mouthwash": "oral-care",
  "Electric Toothbrush": "oral-care", "Oral Care": "oral-care",
  "Teeth Whitening": "oral-care", "Kids Oral Care": "oral-care",
  // ---- kids & baby
  "Kids Bath and Body": "kids-baby", "Baby Accessories": "kids-baby",
  // ---- wellness
  "Health Supplements": "wellness", "Slimming and Detox": "wellness",
  "Relaxation and Sleep": "wellness", "Candles": "wellness",
  "Wound Care and Soothing": "wellness", "Sanitizers": "wellness",
  // ---- sets, gifts & promos
  "Skincare Gifts and Sets": "gift-sets", "Makeup Gifts and Sets": "gift-sets",
  "Hair Care Gifts and Sets": "gift-sets", "Body Gifts and Sets": "gift-sets",
  "Suncare Gifts and Sets": "gift-sets", "GWP": "gift-sets", "Reward": "gift-sets",
  "Voucher": "gift-sets", "Gift Card": "gift-sets",
  // ---- accessories & devices
  "Electricals Hair Styling": "electricals", "Electrical Shavers and Trimmers": "electricals",
  "Hair Dryer": "electricals", "Electrical and Fitness": "electricals",
  "Body and Legs Epilators": "electricals",
  "Shaving": "accessories", "Beard Care": "accessories", "Hair Removal": "accessories",
  "Lenses": "accessories", "Bath Accessories": "accessories",
};

// The 6 products with no product_type at all.
const FALLBACK_CATEGORY = "gift-sets";

// Shopify option names -> the schema's two variant kinds.
function variantKind(optionNames: string[]): "size" | "shade" {
  return optionNames.some((n) => /size/i.test(n)) ? "size" : "shade";
}

const cents = (usd: number) => Math.round(usd * 100);
const firstSentence = (s: string) => {
  const m = s.match(/^[\s\S]*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim().slice(0, 300);
};
const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "brand";

// A product's overall status: best of its variants (any sellable variant => active).
function productStatus(p: F2Product): string {
  if (p.variants.some((v) => v.quality === "ok")) return "active";
  if (p.variants.some((v) => v.quality === "out_of_stock")) return "unavailable";
  return "hidden";
}

// Representative price: cheapest sellable variant, else cheapest priced variant.
function basePrice(p: F2Product): number {
  const priced = p.variants.filter((v) => v.price_regular > 0);
  const sellable = priced.filter((v) => v.quality === "ok");
  const pool = sellable.length ? sellable : priced;
  return pool.length ? Math.min(...pool.map((v) => v.price_regular)) : 0;
}

// ---------------------------------------------------------------- dedupe matching
// Deleting a product because it "looks like" another one is destructive, so the
// comparison is deliberately conservative:
//
//  * Feel22 prefixes titles with the vendor name ("Beesline Keratin Conditioner
//    200ml"), and sizes differ between listings, so the brand prefix, volumes and
//    bare numbers are stripped before comparing.
//  * SYMMETRIC Jaccard (intersection / union), not containment. Containment scores a
//    short title fully inside a longer one at 1.0, which made bundles match their own
//    components — "Everyone Barrier Cream + Super Hydrating Serum" matched plain
//    "Everyone Barrier Cream". That would have deleted 156 products instead of 80.
//  * A bundle may only match another bundle.
//
// Verified at 0.8: matches are genuine same-product pairs and no multi-variant product
// is touched, so Dali's shade ranges are safe.
const MATCH_THRESHOLD = 0.8;
const STOP = new Set(["the", "and", "for", "with", "new", "free", "pack", "offer", "special"]);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normaliseTitle(s: string, brand?: string): string {
  let t = s;
  if (brand) t = t.replace(new RegExp("^\\s*" + escapeRe(brand) + "\\s*", "i"), "");
  return t
    .replace(/\(\s*\d+\s*\+\s*\d+[^)]*\)/g, " ")                                  // (1+1 Free)
    .replace(/\b\d+(\.\d+)?\s*(ml|l|g|gm|gr|mg|oz|pcs|caps|tabs)\b/gi, " ")        // 200ml, 50 g
    .replace(/\b\d+\b/g, " ");                                                     // bare numbers
}
const tokens = (s: string, brand?: string) =>
  new Set(normaliseTitle(s, brand).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const jaccard = (a: Set<string>, b: Set<string>) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  const union = a.size + b.size - i;
  return union ? i / union : 0;
};
const isBundle = (s: string) => /[A-Za-z)]\s+\+\s+[A-Za-z]/.test(s.replace(/\(\s*\d+\s*\+\s*\d+[^)]*\)/g, " "));

async function main() {
  const products: F2Product[] = JSON.parse(fs.readFileSync(CATALOG, "utf8").replace(/^\uFEFF/, ""));

  // Before ANY validation walks p.images: an AI photograph must never stand in for a product
  // a customer receives at their door. Filtering here rather than in the catalogue JSON keeps
  // that file an honest record of what the supplier published. See prisma/generated-images.ts.
  stripGeneratedImages(products as never);
  console.log(`Loaded ${products.length} Feel22 products.`);

  // -- validate -------------------------------------------------------------
  const knownCats = new Set([
    ...TOPS.map((c) => c.slug), ...SUBS.map((c) => c.slug),
    "nail-colors", "nail-care", // owned by the Dali import
  ]);
  const place = new Map<number, string>();
  const badTypes = new Map<string, number>();
  for (const p of products) {
    const t = (p.product_type || "").trim();
    const slug = t ? TYPE_MAP[t] : FALLBACK_CATEGORY;
    if (!slug) { badTypes.set(t, (badTypes.get(t) || 0) + 1); continue; }
    if (!knownCats.has(slug)) throw new Error(`Type "${t}" maps to unknown category "${slug}"`);
    place.set(p.product_id, slug);
  }
  if (badTypes.size) {
    throw new Error(`${badTypes.size} unmapped product_type values:\n  ` +
      [...badTypes].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} (${c})`).join("\n  "));
  }

  /**
   * Sections the store has retired are not re-imported.
   *
   * The owner deactivated Electricals, Oral Care and Sets & Routines (see
   * scripts/retire-sections.ts). Without this guard the next run would insert all 1,096 rows
   * again as `active`, quietly undoing that decision — the importer is destructive within its
   * own `source`, so it rebuilds from the export every time and has no memory of the change.
   *
   * Driven by `Category.active` rather than a list here, so retiring a section in admin is the
   * only step needed and the two can never disagree.
   */
  const inactive = new Set(
    (await db.category.findMany({ where: { active: false }, select: { slug: true } })).map((c) => c.slug),
  );
  let skippedRetired = 0;
  for (const [id, slug] of place) {
    if (inactive.has(slug)) { place.delete(id); skippedRetired++; }
  }
  if (skippedRetired) {
    console.log(`Skipping ${skippedRetired} products bound for retired sections (${[...inactive].join(", ")}).`);
  }

  const imgDir = path.resolve(import.meta.dirname, "../../web/public/products/feel22");
  const files = new Set(fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : []);
  const missing = products.filter((p) => p.images.length && !files.has(p.images[0].file));
  if (missing.length) {
    throw new Error(`${missing.length} first-images missing from web/public/products/feel22 ` +
      `(e.g. ${missing.slice(0, 3).map((p) => p.images[0].file).join(", ")})`);
  }
  console.log(`Validation passed — all ${place.size} products placed, first-images present.`);

  // -- taxonomy -------------------------------------------------------------
  for (const c of TOPS) {
    await db.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, blurb: c.blurb, glyph: c.glyph, tint: c.tint, sortOrder: c.sortOrder, parentId: null },
      create: { ...c, active: true },
    });
  }
  for (const c of SUBS) {
    const parent = await db.category.findUniqueOrThrow({ where: { slug: c.parent } });
    const { parent: _p, ...rest } = c;
    await db.category.upsert({
      where: { slug: c.slug },
      update: { ...rest, blurb: rest.name, parentId: parent.id },
      create: { ...rest, blurb: rest.name, active: true, parentId: parent.id },
    });
  }
  console.log(`Taxonomy: ${TOPS.length} departments, ${SUBS.length} subcategories.`);

  const catId = new Map<string, number>();
  for (const c of await db.category.findMany({ select: { slug: true, id: true } })) catId.set(c.slug, c.id);

  // -- brands (one per vendor) ---------------------------------------------
  const vendors = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort();
  const brandId = new Map<string, number>();
  const usedSlug = new Map<string, string>();
  for (const v of vendors) {
    let slug = slugify(v);
    // keep slugs unique if two vendor names normalise the same way
    if (usedSlug.has(slug) && usedSlug.get(slug) !== v) slug = `${slug}-${slugify(v).length}`;
    usedSlug.set(slug, v);
    const b = await db.brand.upsert({
      where: { slug },
      update: { name: v, active: true },
      create: { slug, name: v, blurb: "", featured: false, active: true, sortOrder: 50 },
    });
    brandId.set(v, b.id);
  }
  console.log(`Brands: ${vendors.length} vendors upserted.`);

  // -- clear the previous Feel22 import ------------------------------------
  const oldIds = (await db.product.findMany({ where: { source: SOURCE }, select: { id: true } })).map((p) => p.id);
  if (oldIds.length) {
    const relinked = await db.orderItem.updateMany({ where: { productId: { in: oldIds } }, data: { productId: null } });
    const gone = await db.product.deleteMany({ where: { source: SOURCE } });
    console.log(`Removed ${gone.count} previous Feel22 products (${relinked.count} order items unlinked but intact).`);
  }
  console.log(`Left ${await db.product.count({ where: { source: { not: SOURCE } } })} products from other sources untouched.`);

  // -- skip anything we already carry direct from the brand ----------------
  const direct = await db.product.findMany({
    where: { source: { in: ["dali", "beesline"] } },
    select: { name: true, brand: { select: { slug: true, name: true } } },
  });
  const directByBrand = new Map<string, { toks: Set<string>; bundle: boolean; name: string }[]>();
  for (const d of direct) {
    const bslug = d.brand?.slug;
    if (!bslug) continue;
    if (!directByBrand.has(bslug)) directByBrand.set(bslug, []);
    directByBrand.get(bslug)!.push({ toks: tokens(d.name, d.brand?.name), bundle: isBundle(d.name), name: d.name });
  }
  const skip = new Set<number>();
  const skipExamples: [string, string][] = [];
  for (const p of products) {
    const cands = p.brand ? directByBrand.get(slugify(p.brand)) : undefined;
    if (!cands) continue;
    const pt = tokens(p.title, p.brand);
    const pBundle = isBundle(p.title);
    for (const c of cands) {
      if (c.bundle !== pBundle) continue;
      if (jaccard(pt, c.toks) >= MATCH_THRESHOLD) {
        skip.add(p.product_id);
        if (skipExamples.length < 8) skipExamples.push([p.title, c.name]);
        break;
      }
    }
  }
  console.log(`Duplicates: skipping ${skip.size} Feel22 products already carried direct from the brand.`);
  skipExamples.forEach(([f, d]) => console.log(`    skip ${f.slice(0, 44).padEnd(46)}(have "${d.slice(0, 34)}")`));

  // -- insert ---------------------------------------------------------------
  // Batched with createMany, NOT a nested create per product. Neon is remote, so a
  // per-product round trip runs at roughly 60 products/minute — about 2.5 hours for
  // this catalogue. Batching turns ~28,000 round trips into a few dozen.
  // createMany doesn't return ids, so products go in first, then their ids are read
  // back by slug to attach images and variants.
  const taken = new Set((await db.product.findMany({ where: { source: { not: SOURCE } }, select: { slug: true } })).map((p) => p.slug));
  let reslugged = 0;
  const byStatus: Record<string, number> = {};
  const byCat: Record<string, number> = {};

  type ProductRow = { slug: string; name: string; sku: string; source: string; status: string;
    priceCents: number; saleCents: null; shortDesc: string; description: string; howToUse: string;
    ingredients: string; glyph: string; tint: string; isBestSeller: boolean; isNewMode: string;
    concerns: string; attributes: string; categoryId: number; brandId: number | null };

  const productRows: ProductRow[] = [];
  // keyed by slug so images/variants can be attached once the ids are known
  const pending = new Map<string, { imageUrl: string; imageAlt: string; variants: { type: string; label: string; sku: string; hex: string; imageUrl: string; priceCents: number | null; available: boolean; sortOrder: number }[] }>();

  for (const p of products) {
    if (skip.has(p.product_id)) continue; // already carried direct from the brand
    const slug = place.get(p.product_id);
    // Bound for a retired section — removed from `place` above. Not an error: the owner
    // deliberately took that section off sale.
    if (!slug) continue;
    const meta = [...TOPS, ...SUBS].find((c) => c.slug === slug);
    const status = productStatus(p);
    const base = cents(basePrice(p));

    // Loop rather than a single "-f22" attempt: the suffixed form can itself be taken.
    let productSlug = p.handle;
    if (taken.has(productSlug)) {
      let candidate = `${p.handle}-f22`;
      for (let i = 2; taken.has(candidate); i++) candidate = `${p.handle}-f22-${i}`;
      productSlug = candidate;
      reslugged++;
    }
    taken.add(productSlug);

    productRows.push({
      slug: productSlug, name: p.title, sku: p.variants[0]?.sku ?? "", source: SOURCE, status,
      priceCents: base, saleCents: null,
      shortDesc: firstSentence(p.description), description: p.description,
      howToUse: "", ingredients: "",
      glyph: meta?.glyph ?? "bottle", tint: meta?.tint ?? "#f5e9f0",
      isBestSeller: false, isNewMode: "never", concerns: "", attributes: "",
      categoryId: catId.get(slug)!, brandId: p.brand ? brandId.get(p.brand) ?? null : null,
    });

    const kind = variantKind(p.option_names);
    pending.set(productSlug, {
      imageUrl: p.images.length ? `${IMG_BASE}/${p.images[0].file}` : "",
      imageAlt: p.images.length ? p.images[0].alt || p.title : "",
      variants: p.variants.length > 1
        ? p.variants.map((v, i) => ({
            type: kind,
            label: v.title || v.option1 || `Option ${i + 1}`,
            sku: v.sku, hex: "", imageUrl: "", // only the product's first image is hosted
            priceCents: cents(v.price_regular) === base ? null : cents(v.price_regular),
            available: v.in_stock, sortOrder: i,
          }))
        : [],
    });

    byStatus[status] = (byStatus[status] || 0) + 1;
    byCat[slug] = (byCat[slug] || 0) + 1;
  }

  // Chunked to stay well under Postgres' 65535 bound parameters per statement.
  const chunk = <T,>(arr: T[], size: number) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

  for (const part of chunk(productRows, 500)) await db.product.createMany({ data: part });
  console.log(`\nInserted ${productRows.length} products.` + (reslugged ? ` ${reslugged} slugs suffixed to avoid clashes.` : ""));

  const idBySlug = new Map(
    (await db.product.findMany({ where: { source: SOURCE }, select: { id: true, slug: true } })).map((p) => [p.slug, p.id]),
  );

  const imageRows: { productId: number; url: string; alt: string; sortOrder: number }[] = [];
  const variantRows: { productId: number; type: string; label: string; sku: string; hex: string; imageUrl: string; priceCents: number | null; available: boolean; sortOrder: number }[] = [];
  for (const [slug, v] of pending) {
    const id = idBySlug.get(slug);
    if (id == null) continue;
    if (v.imageUrl) imageRows.push({ productId: id, url: v.imageUrl, alt: v.imageAlt, sortOrder: 0 });
    for (const vr of v.variants) variantRows.push({ productId: id, ...vr });
  }
  for (const part of chunk(imageRows, 1000)) await db.productImage.createMany({ data: part });
  for (const part of chunk(variantRows, 1000)) await db.productVariant.createMany({ data: part });

  const nImg = imageRows.length, nVar = variantRows.length;
  console.log(`Attached ${nImg} images and ${nVar} variants.`);
  console.log("\nBy status:");
  for (const [s, c] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(13)} ${c}`);
  console.log("\nBy category:");
  for (const [s, c] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(17)} ${c}`);

  const bySource = await db.product.groupBy({ by: ["source"], _count: { _all: true } });
  console.log("\nCatalogue by source:");
  for (const s of bySource.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${(s.source || "(manual)").padEnd(11)} ${s._count._all}`);
  }
  console.log(`  ${"TOTAL".padEnd(11)} ${await db.product.count()}`);
}

main()
  .then(async () => { await db.$disconnect(); console.log("\nDone."); })
  .catch(async (e) => { console.error("\nImport failed:", e); await db.$disconnect(); process.exit(1); });
