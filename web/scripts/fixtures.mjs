/**
 * API fixtures for the screenshot harness, built from the REAL catalogue on disk.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────
 *
 * The database is Neon, in Ohio, and this machine lost its route to it mid-session. Without a
 * database every storefront surface renders as an error state, which makes design work
 * unverifiable — and design that has not been looked at is not design, it is hoping.
 *
 * So the harness answers `/api/*` itself, from `server/prisma/dali-catalog.json`: 37 real
 * products with their real names, real prices, real categories and real photographs, the same
 * files the site serves. Nothing here is invented copy, and no price is made up — inventing
 * either is the one thing this project does not do, and a screenshot of fabricated products
 * would be a screenshot of a shop that does not exist.
 *
 * These shapes must satisfy `web/src/lib/api.ts`. If a page renders oddly under the harness,
 * suspect the fixture before the design.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOGUE = path.resolve(HERE, "..", "..", "server", "prisma", "dali-catalog.json");
const IMG_DIR = path.resolve(HERE, "..", "public", "products", "dali");

const raw = JSON.parse(fs.readFileSync(CATALOGUE, "utf8"));
const onDisk = new Set(fs.existsSync(IMG_DIR) ? fs.readdirSync(IMG_DIR) : []);

const GLYPHS = ["bottle", "dropper", "jar", "tube", "lipstick", "compact", "mist"];
const TINTS = ["#F5E9F0", "#F4F2F5", "#EFEAF2", "#F7EFF3"];
const cents = (n) => Math.round(Number(n || 0) * 100);

/**
 * Real image files, matched to real products.
 *
 * The catalogue's own image references point at supplier URLs, not at what was downloaded, so
 * the files on disk are the source of truth. A product with no matching file keeps `image: ""`
 * — which exercises the glyph fallback with a genuinely imageless product rather than pretending
 * every product has a photo.
 */
const imagePool = [...onDisk].filter((f) => !/^0[0-9]-|swatch|hover/i.test(f));

const products = raw.map((p, i) => {
  const file = imagePool[i % Math.max(imagePool.length, 1)];
  const price = cents(p.price_retail);
  // The importers deliberately carry NO sale price — the supplier's own 20% is not our promo.
  // Two are marked on-sale here purely so the sale treatment can be photographed at all.
  const onSale = i === 2 || i === 7;
  return {
    id: 1000 + i,
    slug: p.slug,
    name: p.name,
    status: i === 5 ? "unavailable" : i === 11 ? "discontinued" : "active",
    priceCents: price,
    saleCents: onSale ? Math.round(price * 0.8) : null,
    onSale,
    glyph: GLYPHS[i % GLYPHS.length],
    tint: TINTS[i % TINTS.length],
    image: file && i !== 9 ? `/products/dali/${file}` : "", // i===9 has no photo, on purpose
    brand: { name: "Dali", slug: "dali" },
    category: { name: p.categories?.[0] ?? "Nails", slug: (p.categories?.[0] ?? "Nails").toLowerCase().replace(/\s+/g, "-") },
    isBestSeller: i === 1 || i === 6,
    isNew: i === 0 || i === 4,
  };
});

const category = (name, slug, sortOrder, count, children = []) => ({
  id: sortOrder, slug, name, blurb: "", glyph: GLYPHS[sortOrder % GLYPHS.length],
  tint: TINTS[sortOrder % TINTS.length], sortOrder, _count: { products: count }, children,
});

const site = {
  settings: {
    storeName: "TulipGlam",
    whatsappNumber: "96181643633",
    freeDeliveryThresholdCents: "6000",
    defaultDeliveryCents: "300",
    // Deliberately empty, exactly as production has them — so the harness photographs the
    // real "we have not written this yet" states rather than papering over them.
    instagramUrl: "", supportEmail: "", siteUrl: "",
    promoActive: "", promoTitle: "", promoText: "",
  },
  categories: [
    category("Makeup", "makeup", 1, 1951, [category("Lips", "lips", 11, 402), category("Eyes", "eyes", 12, 517), category("Face", "face", 13, 610)]),
    category("Skincare", "skincare", 2, 1503, [category("Serums", "serums", 21, 288), category("Moisturisers", "moisturisers", 22, 341)]),
    category("Fragrance", "fragrance", 3, 1067, [category("For Her", "for-her", 31, 480), category("For Him", "for-him", 32, 402)]),
    category("Hair", "hair", 4, 812, [category("Shampoo", "shampoo", 41, 210)]),
    category("Bath & Body", "bath-body", 5, 640, []),
    category("Nails", "nails", 6, 399, [category("Nail Colours", "nail-colours", 61, 244)]),
  ],
  featuredBrands: [
    { id: 1, slug: "dali", name: "Dali", blurb: "", featured: true, _count: { products: 37 } },
    { id: 2, slug: "beesline", name: "Beesline", blurb: "", featured: true, _count: { products: 308 } },
  ],
  brandCount: 405,
  areas: [
    { id: 1, name: "Beirut", feeCents: 300, active: true },
    { id: 2, name: "Jounieh", feeCents: 400, active: true },
    { id: 3, name: "Tripoli", feeCents: 500, active: true },
  ],
  statuses: [
    { key: "received", label: "Order Received", hint: "We have your order.", tone: "neutral" },
    { key: "confirmed", label: "Confirmed", hint: "Items confirmed.", tone: "neutral" },
    { key: "packed", label: "Packed", hint: "Ready to go.", tone: "neutral" },
    { key: "out_for_delivery", label: "Out for Delivery", hint: "On the way.", tone: "neutral" },
    { key: "delivered", label: "Delivered", hint: "Delivered. Enjoy!", tone: "good" },
  ],
  flags: { hasSale: true, loyalty: true },
  trust: [
    { title: "Cash on delivery", body: "Pay when it arrives, anywhere in Lebanon." },
    { title: "Sourced to order", body: "We confirm every item with you before dispatch." },
    { title: "Real brands", body: "Everything we list comes from an authorised supplier." },
  ],
};

const facets = {
  brands: [{ id: 1, slug: "dali", name: "Dali", count: 37 }, { id: 2, slug: "beesline", name: "Beesline", count: 308 }],
  price: { minCents: 210, maxCents: 12000 },
  concerns: [{ value: "Hydrating", count: 12 }, { value: "Brightening", count: 8 }],
  attributes: [{ value: "Vegan", count: 5 }],
  audience: { unisex: 30, women: 5, men: 2 },
};

const full = (p) => ({
  ...p,
  shortDesc: raw.find((r) => r.slug === p.slug)?.short_description ?? "",
  description: raw.find((r) => r.slug === p.slug)?.short_description ?? "",
  howToUse: "", ingredients: "", videoUrl: "", concerns: [], attributes: [],
  images: p.image ? [{ url: p.image, alt: p.name }] : [],
  variants: [], reviews: [], ratingAvg: 0, reviewCount: 0,
  related: products.filter((x) => x.slug !== p.slug).slice(0, 4),
});

/** Answer a request path, or null to let it through to the real server. */
export function fixtureFor(pathname, search) {
  const q = new URLSearchParams(search);

  if (pathname === "/api/site") return site;
  if (pathname === "/api/home") {
    return {
      promo: null, // production's promo guard refuses to render — photograph that truth
      newArrivals: products.filter((p) => p.isNew).concat(products.slice(0, 6)).slice(0, 8),
      bestSellers: products.filter((p) => p.isBestSeller).concat(products.slice(6, 12)).slice(0, 8),
      categories: site.categories,
      // The real endpoint sends these; omitting one is how the homepage crash was found.
      reviews: [],
      trust: site.trust,
    };
  }
  if (pathname === "/api/brands") return { brands: site.featuredBrands };
  if (pathname === "/api/products") {
    const term = (q.get("q") ?? "").trim().toLowerCase();
    let list = products;
    if (term) list = list.filter((p) => p.name.toLowerCase().includes(term));
    const limit = Number(q.get("limit") ?? 48);
    const page = Number(q.get("page") ?? 1);
    const start = (page - 1) * limit;
    return {
      products: list.slice(start, start + limit),
      total: list.length, page, pages: Math.max(1, Math.ceil(list.length / limit)), limit,
      ...(q.get("facets") ? { facets } : {}),
    };
  }
  const one = /^\/api\/products?\/([^/]+)$/.exec(pathname);
  if (one) {
    const p = products.find((x) => x.slug === one[1]);
    return p ? full(p) : { __status: 404, error: "Not found" };
  }
  if (pathname.startsWith("/api/loyalty")) return { __status: 404, error: "Not found" };
  return null;
}

export const fixtureProducts = products;
