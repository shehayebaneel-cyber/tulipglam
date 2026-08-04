// TulipGlam — import the Dali Beauty catalogue.
//
// Source: dali-catalog.json, pulled from the supplier's WooCommerce Store API
// (see ../../dali-import/README.md for how it was produced and how to refresh).
// Supplier authorised the copy.
//
// Run:  npm run import:dali
//
// DESTRUCTIVE + IDEMPOTENT, BUT SCOPED TO THE DALI BRAND. Every run removes Dali's
// own products (plus any brandless leftovers from the original placeholder seed) and
// rebuilds them from the JSON. Products from other brands — Beesline, anything you add
// later — are left alone, as are orders, customers, coupons, gift cards and settings.
// Order items keep their price/name snapshot and just lose their product link (the
// snapshot is what the order displays anyway).
//
// Pricing decision (owner, July 2026): the supplier site shows a flat 20% off every
// item. We import the REGULAR price as our price and set NO sale price, so the
// supplier's discount never reaches customers. `price_discounted` in the JSON is
// deliberately ignored — see README.

import { PrismaClient } from "@prisma/client";
import { stripGeneratedImages } from "./generated-images.js";
import { reviewImportedImages } from "./image-review.js";
import { applyBrandAllowlist } from "./brandAllowlist.js";
import fs from "node:fs";
import path from "node:path";

const db = new PrismaClient();

const CATALOG = path.resolve(import.meta.dirname, "dali-catalog.json");
const SWATCHES = path.resolve(import.meta.dirname, "dali-swatch-hex.csv");
const IMG_BASE = "/products/dali"; // served from web/public — survives deploys (uploads/ is ephemeral)

// The supplier publishes shade names but no colour codes, so the swatch colours were
// read back out of the shade photography (see ../../dali-import/extract-swatch-hex.ps1).
// That works whenever the packaging carries the shade colour — nail polish through
// glass, the colour-matched lipstick and lip-balm tubes, the powder pans.
//
// It does NOT work for these four, checked by eye: the barrel/cap is a neutral
// house colour and the actual shade is a small accent, so the extracted colour comes
// back as the packaging (a "Black" eye pencil reads as peach). For them we leave hex
// empty, which makes the storefront use the shade photo as the swatch instead —
// always truthful, whatever the packaging looks like.
const PHOTO_SWATCH = new Set(["Eye Pencil", "Lip Pencil Waterproof", "Creamy Blush", "Concealer"]);

// ---------------------------------------------------------------- source types
type DaliImage = { file: string; src: string; alt: string };
type DaliVariation = {
  sku: string; shade: string;
  price_retail: number; price_discounted: number | null;
  in_stock: boolean; images: { file: string; src: string }[];
  source_url: string; source_id: number;
};
type DaliProduct = {
  source_id: number; sku: string; name: string; type: string; slug: string;
  price_retail: number; price_discounted: number | null; currency: string;
  categories: string[]; tags: string[]; brand: string[]; in_stock: boolean;
  short_description: string; description: string;
  images: DaliImage[]; variations: DaliVariation[]; source_url: string;
};

// ---------------------------------------------------------------- taxonomy
// Dali is a nails-led brand, so Nails becomes a top-level department. Hair,
// Fragrance and Gift Sets get deactivated: no Dali products land there and an
// empty category on the storefront looks broken.
const TOPS = [
  { slug: "nails",       name: "Nails",       blurb: "Colour, care & the perfect finish", glyph: "bottle",   tint: "#f7e9ef", sortOrder: 1 },
  { slug: "makeup",      name: "Makeup",      blurb: "Lips, eyes, face & cheeks",         glyph: "lipstick", tint: "#f7e2e6", sortOrder: 2 },
  { slug: "skincare",    name: "Skincare",    blurb: "Cleanse, protect & hydrate",        glyph: "dropper",  tint: "#e9f0ee", sortOrder: 3 },
  { slug: "bath-body",   name: "Bath & Body", blurb: "Scrub, soften & nourish",           glyph: "tube",     tint: "#eff0e6", sortOrder: 4 },
  { slug: "accessories", name: "Accessories", blurb: "Tools & finishing touches",         glyph: "jar",      tint: "#f3ece4", sortOrder: 5 },
];

const SUBS = [
  { slug: "nail-colors", name: "Nail Colours", parent: "nails",    blurb: "Over 100 shades",            glyph: "bottle",   tint: "#f7e9ef", sortOrder: 1 },
  { slug: "nail-care",   name: "Nail Care",    parent: "nails",    blurb: "Base, top & treatments",     glyph: "dropper",  tint: "#f2eef4", sortOrder: 2 },
  { slug: "face",        name: "Face",         parent: "makeup",   blurb: "Base, powder & cheeks",      glyph: "compact",  tint: "#f3e7dd", sortOrder: 1 },
  { slug: "lips",        name: "Lips",         parent: "makeup",   blurb: "Colour, liner & balm",       glyph: "lipstick", tint: "#f7dde6", sortOrder: 2 },
  { slug: "eyes",        name: "Eyes",         parent: "makeup",   blurb: "Definition & liner",         glyph: "lipstick", tint: "#e8e6ef", sortOrder: 3 },
  { slug: "cleansers",   name: "Cleansers",    parent: "skincare", blurb: "Balm, gel, milk & micellar", glyph: "bottle",   tint: "#e3eff0", sortOrder: 1 },
  { slug: "sunscreen",   name: "Sunscreen",    parent: "skincare", blurb: "Daily SPF protection",       glyph: "tube",     tint: "#f3ecd9", sortOrder: 2 },
];

const DEACTIVATE = ["hair", "fragrance", "gift-sets"]; // no Dali products in these lines

// Explicit per-product placement. Written out in full rather than derived from the
// supplier's overlapping category tags, because the tags are ambiguous (e.g.
// Moisturizer is tagged "Face, Skin" but belongs in Skincare, not Makeup > Face).
// A product missing from this map is a hard error — better than silently misfiling.
const PLACEMENT: Record<string, { cat: string; glyph: string }> = {
  // nails
  "Base Coat":                { cat: "nail-care",   glyph: "bottle" },
  "Top Coat":                 { cat: "nail-care",   glyph: "bottle" },
  "Cuticle Oil":              { cat: "nail-care",   glyph: "dropper" },
  "Transparent":              { cat: "nail-colors", glyph: "bottle" },
  "Black Nail Polish":        { cat: "nail-colors", glyph: "bottle" },
  "Blue Nail Polish":         { cat: "nail-colors", glyph: "bottle" },
  "Green Nail Polish":        { cat: "nail-colors", glyph: "bottle" },
  "Grey Nail Polish":         { cat: "nail-colors", glyph: "bottle" },
  "Nude Nail Polish":         { cat: "nail-colors", glyph: "bottle" },
  "Pink Nail Polish":         { cat: "nail-colors", glyph: "bottle" },
  "Purple Nail Polish":       { cat: "nail-colors", glyph: "bottle" },
  "Red Nail Polish":          { cat: "nail-colors", glyph: "bottle" },
  "White Nail Polish":        { cat: "nail-colors", glyph: "bottle" },
  "Yellow Nail Polish":       { cat: "nail-colors", glyph: "bottle" },
  "New Summer Collection":    { cat: "nail-colors", glyph: "bottle" },
  "New Winter Collection":    { cat: "nail-colors", glyph: "bottle" },
  // makeup
  "Compact Powder":           { cat: "face",        glyph: "compact" },
  "Concealer":                { cat: "face",        glyph: "tube" },
  "Creamy Blush":             { cat: "face",        glyph: "compact" },
  "Marble Powder":            { cat: "face",        glyph: "compact" },
  "Trio Palette":             { cat: "face",        glyph: "compact" },
  "Liquid Lipstick":          { cat: "lips",        glyph: "lipstick" },
  "Lip Pencil Waterproof":    { cat: "lips",        glyph: "lipstick" },
  "Lip Butter Balm":          { cat: "lips",        glyph: "lipstick" },
  "Eye Pencil":               { cat: "eyes",        glyph: "lipstick" },
  // skincare
  "Moisturizer":              { cat: "skincare",    glyph: "jar" },
  "Sunscreen":                { cat: "sunscreen",   glyph: "tube" },
  "Sunglow Sunscreen":        { cat: "sunscreen",   glyph: "tube" },
  "Cleansing Balm":           { cat: "cleansers",   glyph: "jar" },
  "Cleansing Gel":            { cat: "cleansers",   glyph: "tube" },
  "Cleansing Milk":           { cat: "cleansers",   glyph: "bottle" },
  "Micellar Cleansing Water": { cat: "cleansers",   glyph: "bottle" },
  // bath & body
  "Coconut Body Lotion":      { cat: "bath-body",   glyph: "bottle" },
  "Walnut Body Scrub":        { cat: "bath-body",   glyph: "jar" },
  // accessories
  "Blender":                  { cat: "accessories", glyph: "jar" },
  "Cotton Pads":              { cat: "accessories", glyph: "jar" },
  "Key Charms":               { cat: "accessories", glyph: "jar" },
};

// These two are literally named "New … Collection" — keep the New badge on them
// permanently instead of letting the auto window expire it.
const ALWAYS_NEW = new Set(["New Summer Collection", "New Winter Collection"]);

// ---------------------------------------------------------------- helpers
const cents = (usd: number) => Math.round(usd * 100);

// file -> hex, from the extraction CSV (quoted, may carry a BOM)
function loadSwatches(): Map<string, string> {
  const lines = fs.readFileSync(SWATCHES, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const map = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((c) => c.replace(/^"|"$/g, ""));
    if (cols[0] && /^#[0-9a-f]{6}$/i.test(cols[1] ?? "")) map.set(cols[0], cols[1].toLowerCase());
  }
  return map;
}

const firstSentence = (s: string) => {
  const m = s.match(/^[\s\S]*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim();
};

// Shade labels are mostly "8 Ballerina", "31 Apple" — sort by that leading number
// so the swatches read in the supplier's shade order, not alphabetically.
const shadeSort = (a: DaliVariation, b: DaliVariation) => {
  const na = a.shade.match(/^\s*(\d+)/), nb = b.shade.match(/^\s*(\d+)/);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1;
  if (nb) return 1;
  return a.shade.localeCompare(b.shade);
};

async function main() {
  // replace(/^\uFEFF/) — the catalogue is generated by a PowerShell script that can
  // emit a UTF-8 BOM, which JSON.parse rejects.
  const products: DaliProduct[] = JSON.parse(fs.readFileSync(CATALOG, "utf8").replace(/^\uFEFF/, ""));

  // Before ANY validation walks p.images: an AI photograph must never stand in for a product
  // a customer receives at their door. Filtering here rather than in the catalogue JSON keeps
  // that file an honest record of what the supplier published. See prisma/generated-images.ts.
  stripGeneratedImages(products as never);
  const swatch = loadSwatches();
  console.log(`Loaded ${products.length} products and ${swatch.size} swatch colours.`);

  // -- validate before touching the database -------------------------------
  const missing = products.filter((p) => !PLACEMENT[p.name]).map((p) => p.name);
  if (missing.length) throw new Error(`No category placement for: ${missing.join(", ")}`);

  const allCats = [...TOPS.map((c) => c.slug), ...SUBS.map((c) => c.slug)];
  const badCat = products.filter((p) => !allCats.includes(PLACEMENT[p.name].cat));
  if (badCat.length) throw new Error(`Unknown category slug for: ${badCat.map((p) => p.name).join(", ")}`);

  const noPrice = products.filter((p) => !(p.price_retail > 0));
  if (noPrice.length) throw new Error(`Missing price: ${noPrice.map((p) => p.name).join(", ")}`);

  // Every referenced image must actually exist on disk, or the storefront 404s.
  const imgDir = path.resolve(import.meta.dirname, "../../web/public/products/dali");
  const files = new Set(fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : []);
  const lost: string[] = [];
  for (const p of products) {
    for (const im of p.images) if (!files.has(im.file)) lost.push(`${p.name}: ${im.file}`);
    for (const v of p.variations) for (const im of v.images) if (!files.has(im.file)) lost.push(`${p.name}/${v.shade}: ${im.file}`);
  }
  if (lost.length) throw new Error(`Missing image files in web/public/products/dali:\n  ${lost.join("\n  ")}`);
  console.log("Validation passed — placements, prices and image files all present.");

  // -- taxonomy ------------------------------------------------------------
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
      update: { ...rest, parentId: parent.id },
      create: { ...rest, active: true, parentId: parent.id },
    });
  }
  const off = await db.category.updateMany({ where: { slug: { in: DEACTIVATE } }, data: { active: false } });
  console.log(`Taxonomy: ${TOPS.length} departments, ${SUBS.length} subcategories, ${off.count} deactivated (${DEACTIVATE.join(", ")}).`);

  const catId = new Map<string, number>();
  for (const c of await db.category.findMany({ select: { slug: true, id: true } })) catId.set(c.slug, c.id);

  // -- brand ---------------------------------------------------------------
  const dali = await db.brand.upsert({
    where: { slug: "dali" },
    update: { name: "Dali", blurb: "Colour, care and everyday beauty", featured: true, active: true, sortOrder: 1 },
    create: { slug: "dali", name: "Dali", blurb: "Colour, care and everyday beauty", featured: true, active: true, sortOrder: 1 },
  });

  // -- clear out the previous Dali import ----------------------------------
  // SCOPED TO THIS BRAND ON PURPOSE. Other brands' products (e.g. Beesline) must
  // survive a re-run, so only Dali's own products and any brandless leftovers from
  // the original placeholder seed are removed.
  //
  // Order items point at products optionally; null the link first so the delete
  // can't fail on a foreign key. Each item already stores its own name/price
  // snapshot, so past orders still render correctly.
  // Scoped by `source`, not by brand: Feel22 is a retailer that carries Dali as a
  // vendor, so a brand-scoped delete would destroy the Feel22 import's rows too.
  const mine = { OR: [{ source: "dali" }, { AND: [{ source: "" }, { brandId: null }] }] };
  const oldIds = (await db.product.findMany({ where: mine, select: { id: true } })).map((p) => p.id);
  if (oldIds.length) {
    const relinked = await db.orderItem.updateMany({ where: { productId: { in: oldIds } }, data: { productId: null } });
    const gone = await db.product.deleteMany({ where: mine });
    console.log(`Removed ${gone.count} previous Dali products (images, variants and reviews cascaded; ${relinked.count} order items unlinked but intact).`);
  }
  const others = await db.product.count({ where: { source: { not: "dali" } } });
  if (others) console.log(`Left ${others} products from other sources untouched.`);

  // -- insert the real catalogue ------------------------------------------
  let nProducts = 0, nVariants = 0, nImages = 0, nHexSwatch = 0, nPhotoSwatch = 0;

  for (const p of products) {
    const place = PLACEMENT[p.name];
    const categoryId = catId.get(place.cat)!;
    const tint = [...TOPS, ...SUBS].find((c) => c.slug === place.cat)!.tint;

    // Guarantee both description fields are populated: the supplier leaves the long
    // description empty on 19 products and the short one empty on 1.
    const shortDesc = p.short_description || firstSentence(p.description);
    const description = p.description || p.short_description;

    const created = await db.product.create({
      data: {
        slug: p.slug,
        name: p.name,
        sku: p.sku,
        source: "dali",
        status: "active",
        priceCents: cents(p.price_retail), // regular price; supplier's 20% off deliberately not carried over
        saleCents: null,
        shortDesc,
        description,
        howToUse: "",    // supplier's Application/Benefits/Ingredients accordions are empty at source
        ingredients: "",
        glyph: place.glyph,
        tint,
        isBestSeller: false,
        isNewMode: ALWAYS_NEW.has(p.name) ? "always" : "auto",
        concerns: "",
        attributes: "",
        categoryId,
        brandId: dali.id,
        images: {
          create: p.images.map((im, i) => ({
            url: `${IMG_BASE}/${im.file}`,
            alt: im.alt || p.name,
            sortOrder: i,
          })),
        },
        variants: {
          create: [...p.variations].sort(shadeSort).map((v, i) => ({
            type: "shade",
            label: v.shade,
            sku: v.sku,
            // hex empty => storefront falls back to the shade photo for the swatch
            hex: PHOTO_SWATCH.has(p.name) ? "" : (v.images[0] ? swatch.get(v.images[0].file) ?? "" : ""),
            imageUrl: v.images[0] ? `${IMG_BASE}/${v.images[0].file}` : "",
            // only override when this shade genuinely costs something different
            priceCents: cents(v.price_retail) === cents(p.price_retail) ? null : cents(v.price_retail),
            available: v.in_stock,
            sortOrder: i,
          })),
        },
      },
      include: { images: true, variants: true },
    });

    nProducts++;
    nVariants += created.variants.length;
    nImages += created.images.length;
      for (const v of created.variants) { if (v.hex) nHexSwatch++; else nPhotoSwatch++; }
  }

  console.log(`\nImported ${nProducts} products, ${nVariants} shade variants, ${nImages} product images.`);
  console.log(`Swatches: ${nHexSwatch} colour circles, ${nPhotoSwatch} shade photos (${[...PHOTO_SWATCH].join(", ")}).`);
  console.log(`Sellable SKUs: ${products.filter((p) => !p.variations.length).length} standalone + ${nVariants} shades.`);

  // -- report --------------------------------------------------------------
  const byCat = await db.product.groupBy({ by: ["categoryId"], _count: { _all: true } });
  const names = new Map((await db.category.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  console.log("\nProducts per category:");
  for (const row of byCat.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${String(names.get(row.categoryId)).padEnd(14)} ${row._count._all}`);
  }

  // Supplier content just walked in. Put whatever is new or changed on a sheet the owner
  // can flick through — the filename filter catches a family, not invention in general.
  /**
   * The owner sells a chosen range, not everything the feed carries.
   *
   * This importer just deleted and recreated every product for its source, so any earlier
   * hiding is gone. Re-applying here is what makes the range survive an import instead of
   * 339 brands quietly reappearing under a log line that says the import succeeded.
   */
  {
    const r = await applyBrandAllowlist(db, { write: true, source: "dali" });
    if (r.unmatched.length) {
      console.warn(`\n  [brands] ${r.unmatched.length} name(s) in brands-we-sell.txt match no brand here: ${r.unmatched.join(", ")}`);
      console.warn(`  [brands] Nothing was kept for them. Check the spelling in prisma/brands-we-sell.txt.`);
    }
    console.log(`\n  [brands] kept ${r.keptBrands} brands; hid ${r.hidden} products from brands not on the list.`);
  }
  reviewImportedImages("dali");
}

main()
  .then(async () => { await db.$disconnect(); console.log("\nDone."); })
  .catch(async (e) => { console.error("\nImport failed:", e); await db.$disconnect(); process.exit(1); });
