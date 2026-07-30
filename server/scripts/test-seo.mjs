/**
 * Checks the server-rendered <head>, robots.txt and sitemap.xml.
 *
 *     cd web && npm run build          # the head is injected into the BUILT index.html
 *     cd server && npm run dev
 *     node scripts/test-seo.mjs
 *
 * Read-only: it sends GETs and reads two rows to pick a real slug. Nothing is written.
 *
 * Requires `web/dist` to exist — in development Vite serves index.html itself and none of the
 * injection runs, so this is checking the production path.
 */
const BASE = `http://localhost:${process.env.PORT ?? 4230}`;

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};
const get = async (p) => { const r = await fetch(BASE + p); return { status: r.status, type: r.headers.get("content-type") ?? "", text: await r.text() }; };
const one = (html, re) => (html.match(re)?.[1] ?? "").trim();
const count = (html, re) => (html.match(re) ?? []).length;

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const product = await db.product.findFirst({
  where: { status: "active", NOT: { sku: "" }, images: { some: {} } },
  select: { slug: true, name: true, sku: true },
});
const variant = await db.productVariant.findFirst({ where: { NOT: { sku: "" } }, select: { sku: true, product: { select: { slug: true } } } });
await db.$disconnect();
if (!product) throw new Error("no product with a SKU and an image to test against");

// ---------------------------------------------------------------- product page
console.log("\nProduct page:");
const pp = await get(`/product/${product.slug}`);
check("responds 200", pp.status === 200, String(pp.status));
check("exactly one <title>", count(pp.text, /<title>/g) === 1, `${count(pp.text, /<title>/g)} found`);
check("exactly one description", count(pp.text, /<meta name="description"/g) === 1);
check("the title is the product, not the store default",
  one(pp.text, /<title>([\s\S]*?)<\/title>/i).includes(product.name.slice(0, 20)), one(pp.text, /<title>([\s\S]*?)<\/title>/i));
check("has a canonical URL", /<link rel="canonical" href="https?:\/\//.test(pp.text));
// The reason this exists: WhatsApp's crawler doesn't run JS, so without an og:image every
// shared product link previews as a blank card.
check("has an absolute og:image", /<meta property="og:image" content="https?:\/\//.test(pp.text));
check("has Product JSON-LD", pp.text.includes('"@type":"Product"'));
check("has BreadcrumbList JSON-LD", pp.text.includes('"@type":"BreadcrumbList"'));
// Nothing is stocked, so InStock would be a claim the business can't make.
check("availability is not InStock", !pp.text.includes("schema.org/InStock"));
check("availability is LimitedAvailability", pp.text.includes("schema.org/LimitedAvailability"));

// ---------------------------------------------------------------- supplier SKU
console.log("\nSupplier SKUs stay private:");
check("product SKU is not in the page", !pp.text.includes(product.sku), product.sku);
const api = await get(`/api/products/${product.slug}`);
check("product SKU is not in the public API", !api.text.includes(product.sku));
if (variant) {
  const vp = await get(`/product/${variant.product.slug}`);
  const va = await get(`/api/products/${variant.product.slug}`);
  check("variant SKU is not in the page", !vp.text.includes(variant.sku), variant.sku);
  check("variant SKU is not in the public API", !va.text.includes(variant.sku));
}

// ---------------------------------------------------------------- status codes
console.log("\nStatus codes:");
// This route used to answer 200 for every unknown path, so a mistyped URL was indexable.
const missing = await get("/product/definitely-not-a-real-slug-xyz");
check("a missing product answers 404", missing.status === 404, String(missing.status));
check("  ...and is noindex", /content="noindex/.test(missing.text));
const nowhere = await get("/no-such-page-at-all");
check("an unknown path answers 404", nowhere.status === 404, String(nowhere.status));
const home = await get("/");
check("the homepage still answers 200", home.status === 200, String(home.status));
check("  ...with Store JSON-LD", home.text.includes('"@type":"Store"'));

console.log("\nPrivate pages are noindex:");
for (const p of ["/checkout", "/cart", "/account", "/login", "/wishlist", "/search?q=lipstick"]) {
  const r = await get(p);
  check(`${p}`, /content="noindex/.test(r.text));
}

// ---------------------------------------------------------------- crawler files
console.log("\nrobots.txt and sitemap.xml:");
const robots = await get("/robots.txt");
check("robots.txt is text/plain", robots.type.includes("text/plain"), robots.type);
check("  ...disallows /admin", robots.text.includes("Disallow: /admin"));
check("  ...points at the sitemap", /Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(robots.text));

const sitemap = await get("/sitemap.xml");
const locs = count(sitemap.text, /<loc>/g);
check("sitemap.xml is XML", sitemap.type.includes("xml"), sitemap.type);
check("  ...lists the catalogue", locs > 1000, `${locs} urls`);
// 50,000 URLs / 50 MB is the sitemap protocol limit; past it the file must be split.
check("  ...stays inside the protocol limits", locs < 50_000 && sitemap.text.length < 50 * 1024 * 1024,
  `${locs} urls, ${Math.round(sitemap.text.length / 1024)} KB`);
check("  ...includes the product just checked", sitemap.text.includes(`/product/${product.slug}<`));

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exit(fail ? 1 : 0);
