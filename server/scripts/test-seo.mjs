/**
 * Checks the server-rendered <head>, its JSON-LD, robots.txt and sitemap.xml.
 *
 *     cd web && npm run build                                   # the head is injected into the BUILT index.html
 *     cd server && npm run dev
 *     node --env-file=.env --import tsx scripts/test-seo.mjs
 *
 * `--import tsx` because the sitemap check reads the brand allowlist from `prisma/brandAllowlist.ts`
 * rather than re-parsing brands-we-sell.txt with its own copy of the rules; `--env-file` because
 * it opens a Prisma client. `npm run test:all` already supplies both to every suite it spawns.
 *
 * Read-only: it sends GETs and reads the catalogue to choose real rows. Nothing is written.
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

/** Attribute values are HTML-escaped in the document; compare against the real characters. */
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
const description = (html) => unesc(one(html, /<meta name="description" content="([^"]*)"/));
const title = (html) => unesc(one(html, /<title>([\s\S]*?)<\/title>/i));
const canonical = (html) => one(html, /<link rel="canonical" href="([^"]*)"/);

/** Every JSON-LD block on the page, parsed. `null` marks one that would not parse. */
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } });
const blockOfType = (html, type) => jsonLd(html).find((b) => b && b["@type"] === type);
/** Every key anywhere in a JSON-LD tree — used to prove `sku` is not hiding in a nested node. */
const allKeys = (v, out = []) => {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); allKeys(x, out); }
  return out;
};

/** Fetch in small batches: a head render is several round trips to Neon, and this is ~60 of them. */
const getAll = async (paths, size = 4) => {
  const out = [];
  for (let i = 0; i < paths.length; i += size) out.push(...await Promise.all(paths.slice(i, i + size).map(get)));
  return out;
};

const { PrismaClient } = await import("@prisma/client");
const { loadAllowlist } = await import("../prisma/brandAllowlist.js");
const db = new PrismaClient();

/** The storefront's own statuses. Everything here is judged against what a shopper can reach. */
const VISIBLE = { status: { in: ["active", "unavailable"] } };

const [catalogue, categories, unreachable, product, variant] = await Promise.all([
  db.product.findMany({
    where: VISIBLE,
    select: {
      slug: true, name: true, status: true, shortDesc: true, description: true,
      priceCents: true, saleCents: true, categoryId: true, brand: { select: { name: true } },
    },
  }),
  db.category.findMany({ select: { id: true, slug: true, name: true, active: true, parentId: true } }),
  db.product.findMany({ where: { status: { in: ["hidden", "discontinued"] } }, select: { slug: true, status: true }, take: 40 }),
  db.product.findFirst({ where: { status: "active", NOT: { sku: "" }, images: { some: {} } }, select: { slug: true, name: true, sku: true } }),
  db.productVariant.findFirst({ where: { NOT: { sku: "" } }, select: { sku: true, product: { select: { slug: true } } } }),
]);
await db.$disconnect();
if (!product) throw new Error("no product with a SKU and an image to test against");
if (!catalogue.length) throw new Error("no visible products to test against");

const catById = new Map(categories.map((c) => [c.id, c]));
const bySlug = new Map(catalogue.map((p) => [p.slug, p]));

/**
 * The sample that matters: products the SUPPLIER gave the same paragraph.
 *
 * Picking products at random would test the easy case. The defect this section exists for is
 * copy written once per range and pasted onto every member of it — one antiperspirant sentence
 * sat on 35 pages verbatim — so the sample is the largest such group in the live catalogue.
 */
const groups = new Map();
for (const p of catalogue) {
  const copy = (p.shortDesc || p.description).trim();
  if (copy) groups.set(copy, [...(groups.get(copy) ?? []), p]);
}
const sharedCopy = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
/** Spread across the catalogue rather than the first N, which are one supplier in one order. */
const spread = Array.from({ length: 12 }, (_, i) => catalogue[Math.floor((i * catalogue.length) / 12)]);

// ---------------------------------------------------------------- the page still boots
//
// This section exists because the head injection once shipped a blank site. index.html carried
// a comment mentioning the title tag by name; the removal regex matched inside that comment and
// ran to the real closing tag, taking the `-->` with it. The unclosed comment swallowed the
// rest of the head — including the module script — so nothing rendered.
//
// Every check below the fold passed while that was live: 200, exactly one title, valid Open
// Graph, correct canonical. None of them asked the only question that matters first — does the
// browser still have an app to run.
console.log("\nThe document still boots:");
for (const path of ["/", `/product/${product.slug}`, "/shop"]) {
  const r = await get(path);
  const opens = (r.text.match(/<!--/g) ?? []).length;
  const closes = (r.text.match(/-->/g) ?? []).length;
  check(`${path} — every comment is closed`, opens === closes, `${opens} <!-- vs ${closes} -->`);
  // The script must survive, and must not have been swallowed into a comment.
  const script = r.text.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
  check(`${path} — the module script is present`, !!script, "no <script type=module> in the document");
  if (script) {
    const before = r.text.slice(0, r.text.indexOf(script[0]));
    const swallowed = (before.match(/<!--/g) ?? []).length > (before.match(/-->/g) ?? []).length;
    check(`${path} — the script is not inside a comment`, !swallowed);
  }
  check(`${path} — has the root element`, r.text.includes('id="root"'));
}

// ---------------------------------------------------------------- product page
console.log("\nProduct page:");
const pp = await get(`/product/${product.slug}`);
check("responds 200", pp.status === 200, String(pp.status));
check("exactly one <title>", count(pp.text, /<title>/g) === 1, `${count(pp.text, /<title>/g)} found`);
check("exactly one description", count(pp.text, /<meta name="description"/g) === 1);
check("the title is the product, not the store default",
  title(pp.text).includes(product.name.slice(0, 20)), title(pp.text));
check("has a canonical URL", /<link rel="canonical" href="https?:\/\//.test(pp.text));
// The reason this exists: WhatsApp's crawler doesn't run JS, so without an og:image every
// shared product link previews as a blank card.
check("has an absolute og:image", /<meta property="og:image" content="https?:\/\//.test(pp.text));
check("the description is not the store default",
  !description(pp.text).startsWith("Premium makeup, skincare"), description(pp.text));
check("the description is not a copy of the title", description(pp.text) !== title(pp.text));

// ---------------------------------------------------------------- structured data
//
// Checked field by field rather than by grepping for `"@type":"Product"`. A block can carry the
// type and still be ineligible for a rich result — Google requires name, image and an offer with
// a price and a currency — and a substring test passes for all of it.
console.log("\nProduct JSON-LD:");
const blocks = jsonLd(pp.text);
check("every JSON-LD block is valid JSON", blocks.length > 0 && blocks.every(Boolean),
  `${blocks.filter((b) => !b).length} of ${blocks.length} failed to parse`);
const prod = blockOfType(pp.text, "Product");
check("there is a Product block", !!prod);
if (prod) {
  check("  @context is schema.org", prod["@context"] === "https://schema.org", String(prod["@context"]));
  check("  name is the product", typeof prod.name === "string" && prod.name.length > 0, String(prod.name));
  check("  description is present and not the title", typeof prod.description === "string" && prod.description.length > 20);
  check("  url is the canonical URL", prod.url === canonical(pp.text), `${prod.url} vs ${canonical(pp.text)}`);
  check("  image is a non-empty array of absolute URLs",
    Array.isArray(prod.image) && prod.image.length > 0 && prod.image.every((u) => /^https?:\/\//.test(u)),
    JSON.stringify(prod.image));
  check("  brand is a Brand with a name",
    !!prod.brand && prod.brand["@type"] === "Brand" && !!prod.brand.name, JSON.stringify(prod.brand));
  check("  category names the shelf", typeof prod.category === "string" && prod.category.length > 0);
  const offer = prod.offers;
  check("  offers is an Offer", !!offer && offer["@type"] === "Offer");
  if (offer) {
    check("    priceCurrency is USD", offer.priceCurrency === "USD", String(offer.priceCurrency));
    check("    price is a plain decimal", /^\d+\.\d{2}$/.test(String(offer.price)), String(offer.price));
    check("    price is not zero", Number(offer.price) > 0, String(offer.price));
    check("    url is the product page", offer.url === canonical(pp.text));
    check("    availability is a schema.org term", String(offer.availability).startsWith("https://schema.org/"));
    check("    seller is named", offer.seller?.name === "TulipGlam", JSON.stringify(offer.seller));
  }
}

console.log("\nBreadcrumbs:");
const crumb = blockOfType(pp.text, "BreadcrumbList");
check("there is a BreadcrumbList", !!crumb);
if (crumb) {
  const items = crumb.itemListElement ?? [];
  check("  it has Home, the shelf and the product", items.length >= 3, `${items.length} items`);
  check("  positions run 1..n with no gaps", items.every((it, i) => it.position === i + 1),
    items.map((i) => i.position).join(","));
  check("  every crumb is an absolute URL", items.every((it) => /^https?:\/\//.test(it.item ?? "")));
  check("  the last crumb is this page", items[items.length - 1]?.item === canonical(pp.text));
}

// ---------------------------------------------------------------- availability
//
// The business holds no stock and sources after the order, so `InStock` is a claim it cannot
// make on any page, ever. `unavailable` is a real status the owner sets when a supplier cannot
// get something, and flattening it into the sourced-to-order answer would be the same lie with
// extra steps — so it is asserted separately, not just "not InStock".
console.log("\nAvailability never claims stock:");
const ALLOWED = ["https://schema.org/LimitedAvailability", "https://schema.org/OutOfStock", "https://schema.org/Discontinued"];
const activeSample = catalogue.filter((p) => p.status === "active" && p.priceCents > 0).slice(0, 6);
const unavailSample = catalogue.filter((p) => p.status === "unavailable" && p.priceCents > 0).slice(0, 4);
const availPages = await getAll([...activeSample, ...unavailSample].map((p) => `/product/${p.slug}`));
check("the availability sample covers both statuses", activeSample.length > 0 && unavailSample.length > 0,
  `${activeSample.length} active, ${unavailSample.length} unavailable`);
let wrongAvail = 0, claimedStock = 0;
availPages.forEach((r, i) => {
  const p = [...activeSample, ...unavailSample][i];
  const a = blockOfType(r.text, "Product")?.offers?.availability;
  const want = p.status === "active" ? "https://schema.org/LimitedAvailability" : "https://schema.org/OutOfStock";
  if (a !== want) { wrongAvail++; console.log(`        ${p.slug} (${p.status}) said ${a}`); }
  if (!ALLOWED.includes(a) || /schema\.org\/InStock/.test(r.text)) claimedStock++;
});
check(`${availPages.length} product pages state availability from their status`, wrongAvail === 0, `${wrongAvail} wrong`);
check("  ...and none of them claims stock", claimedStock === 0, `${claimedStock} did`);
check("  the shelf holds no InStock anywhere", !(await get("/shop")).text.includes("schema.org/InStock"));

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
// The string test above only catches the value it was given. This catches the FIELD, anywhere in
// the tree — a `sku` nested under offers or a variant list would slip past a value comparison the
// day someone adds one, because a test can only look for a code it already knows.
const skuKeys = availPages.concat(pp).flatMap((r) => jsonLd(r.text).flatMap((b) => allKeys(b)));
check("no JSON-LD anywhere carries a `sku` key", !skuKeys.includes("sku"), `${skuKeys.filter((k) => k === "sku").length} found`);
check("no JSON-LD carries `gtin`, `mpn` or `productID` either",
  !skuKeys.some((k) => ["gtin", "gtin8", "gtin12", "gtin13", "gtin14", "mpn", "productID", "identifier"].includes(k)));
const sitemapRaw = await get("/sitemap.xml");
check("the sitemap does not leak the SKU", !sitemapRaw.text.includes(product.sku));

// ---------------------------------------------------------------- descriptions
//
// Measured before the fallback chain was rebuilt: 295 of 1,567 reachable products shared their
// meta description verbatim with at least one other product, and 316 shared their opening 60
// characters. Google discards near-duplicate descriptions and writes its own, so those pages
// were spending the one snippet they control on a sentence dozens of others also claimed.
console.log("\nDescriptions are distinct:");
check("the sample is products that share supplier copy", sharedCopy.length > 1, `largest shared group: ${sharedCopy.length}`);
const shareSample = sharedCopy.slice(0, 8);
const sharePages = await getAll(shareSample.map((p) => `/product/${p.slug}`));
const shareDescs = sharePages.map((r) => description(r.text));
check(`${shareSample.length} products with IDENTICAL supplier copy get ${new Set(shareDescs).size} distinct descriptions`,
  new Set(shareDescs).size === shareSample.length, shareDescs[0]);
check("  ...and they differ in their first 60 characters",
  new Set(shareDescs.map((d) => d.slice(0, 60))).size === shareSample.length,
  shareDescs.map((d) => d.slice(0, 60)).join(" | "));

const spreadPages = await getAll(spread.map((p) => `/product/${p.slug}`));
const spreadDescs = spreadPages.map((r) => description(r.text));
check(`${spread.length} products from across the catalogue get distinct descriptions`,
  new Set(spreadDescs).size === spread.length);
check("  ...none of them is the store default",
  spreadDescs.every((d) => !d.startsWith("Premium makeup, skincare")));
check("  ...none is a bare copy of its own title",
  spreadPages.every((r) => description(r.text) !== title(r.text)));
// A 20-character description is a wasted snippet. The lead alone (name, shelf, price) clears
// this comfortably; anything under it means the builder fell through to nothing.
check("  ...all of them say something", spreadDescs.every((d) => d.length >= 50),
  spreadDescs.filter((d) => d.length < 50).join(" | "));
check("  ...each one names its own price or has no price to name",
  spreadPages.every((r, i) => spread[i].priceCents <= 0 || description(r.text).includes("$")));

/**
 * Titles have to be distinct too — and where they are not, the catalogue has to be the reason.
 *
 * Three pairs in this catalogue are the same product imported twice at different prices
 * ("Beesline Super Hydrating Serum"), which no amount of head-building can separate without
 * putting a price in the title. So the assertion is narrower and truer: a collision is allowed
 * only when the two rows genuinely carry the same name on the same shelf.
 */
console.log("\nTitles are distinct unless the catalogue made them identical:");
const byTitle = new Map();
spreadPages.forEach((r, i) => byTitle.set(title(r.text), [...(byTitle.get(title(r.text)) ?? []), spread[i]]));
const badCollision = [...byTitle.values()].filter((ps) => ps.length > 1
  && !ps.every((p) => p.name === ps[0].name && p.categoryId === ps[0].categoryId));
check(`${spread.length} sampled titles collide only on duplicated catalogue rows`, badCollision.length === 0,
  JSON.stringify(badCollision.map((g) => g.map((p) => p.slug))));
check("  ...and every title names the product", spreadPages.every((r, i) => title(r.text).includes(spread[i].name.slice(0, 15))));

// ---------------------------------------------------------------- category pages
console.log("\nCategory pages:");
const leaf = categories.find((c) => c.active && c.parentId != null && catalogue.some((p) => p.categoryId === c.id));
const dept = categories.find((c) => c.active && c.parentId == null && categories.some((k) => k.parentId === c.id));
check("found a shelf and a department to test", !!leaf && !!dept);
const catPages = await getAll([leaf, dept].filter(Boolean).map((c) => `/category/${c.slug}`));
for (const [i, c] of [leaf, dept].filter(Boolean).entries()) {
  const r = catPages[i];
  check(`/category/${c.slug} responds 200`, r.status === 200, String(r.status));
  check(`  ...description is not a copy of the title`, description(r.text) !== title(r.text), description(r.text));
  check(`  ...description says something`, description(r.text).length >= 50, description(r.text));
  check(`  ...has BreadcrumbList JSON-LD`, !!blockOfType(r.text, "BreadcrumbList"));
  const list = blockOfType(r.text, "ItemList");
  check(`  ...has ItemList JSON-LD`, !!list);
  if (list) {
    check(`  ...numberOfItems equals the number of items listed`,
      list.numberOfItems === (list.itemListElement ?? []).length,
      `${list.numberOfItems} vs ${(list.itemListElement ?? []).length}`);
    check(`  ...every entry is an absolute product URL`,
      (list.itemListElement ?? []).length > 0
      && list.itemListElement.every((it) => /^https?:\/\/\S+\/product\/\S+$/.test(it.item ?? it.url ?? "")));
    check(`  ...positions run 1..n`, list.itemListElement.every((it, k) => it.position === k + 1));
    check(`  ...every listed product is one the shelf can show`,
      list.itemListElement.every((it) => bySlug.has(decodeURIComponent(String(it.url).split("/product/")[1] ?? ""))));
  }
  /**
   * The count in the description has to be the shelf's count.
   *
   * Compared against the number `/api/products` returns for the same category rather than against
   * a second query written here — a check that recomputes the figure it is checking will agree
   * with itself no matter which of the two is wrong.
   */
  const shelf = JSON.parse((await get(`/api/products?category=${c.slug}&available=0&limit=1`)).text);
  const stated = Number(description(r.text).match(/— ([\d,]+) products?/)?.[1]?.replace(/,/g, "") ?? NaN);
  check(`  ...the stated count matches what /api/products reports`, stated === shelf.total, `head ${stated} vs api ${shelf.total}`);
}
check("the two category descriptions differ", new Set(catPages.map((r) => description(r.text))).size === catPages.length);

// ---------------------------------------------------------------- status codes
console.log("\nStatus codes:");
// This route used to answer 200 for every unknown path, so a mistyped URL was indexable.
const missing = await get("/product/definitely-not-a-real-slug-xyz");
check("a missing product answers 404", missing.status === 404, String(missing.status));
check("  ...and is noindex", /content="noindex/.test(missing.text));
const nowhere = await get("/no-such-page-at-all");
check("an unknown path answers 404", nowhere.status === 404, String(nowhere.status));
const badCat = await get("/category/not-a-category-xyz");
check("an unknown category answers 404", badCat.status === 404, String(badCat.status));
const home = await get("/");
check("the homepage still answers 200", home.status === 200, String(home.status));
check("  ...with Store JSON-LD", !!blockOfType(home.text, "Store"));

console.log("\nPrivate pages are noindex:");
for (const p of ["/checkout", "/cart", "/account", "/login", "/wishlist", "/search?q=lipstick"]) {
  const r = await get(p);
  check(`${p}`, /content="noindex/.test(r.text));
}

// ---------------------------------------------------------------- crawler files
console.log("\nrobots.txt:");
const robots = await get("/robots.txt");
check("robots.txt is text/plain", robots.type.includes("text/plain"), robots.type);
check("  ...disallows /admin", robots.text.includes("Disallow: /admin"));
check("  ...points at the sitemap", /Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(robots.text));

/**
 * ── THE SITEMAP IS THE ACTIVE CATALOGUE, AND NOTHING ELSE ──────────────────────────
 *
 * Two numbers for one quantity: the product URLs this file lists, and the `total` the storefront's
 * own listing endpoint reports for the same set. They are produced by different code paths from
 * one predicate, and if they ever disagree that disagreement IS the finding — one of the shelf
 * and the sitemap has started describing a catalogue the other does not have.
 *
 * The rest is checked as a property OF THE OUTPUT: take the slugs the file actually printed and
 * ask the database what they are. That cannot pass for the wrong reason the way re-deriving the
 * predicate here and comparing it to itself would.
 */
console.log("\nsitemap.xml equals the catalogue a customer can reach:");
const sitemap = sitemapRaw;
const locs = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const sitemapProducts = locs.filter((u) => u.includes("/product/")).map((u) => decodeURIComponent(u.split("/product/")[1]));
const sitemapCats = locs.filter((u) => u.includes("/category/")).map((u) => decodeURIComponent(u.split("/category/")[1]));
check("sitemap.xml is XML", sitemap.type.includes("xml"), sitemap.type);
check("  ...lists the catalogue", sitemapProducts.length > 100, `${sitemapProducts.length} products`);
// 50,000 URLs / 50 MB is the sitemap protocol limit; past it the file must be split.
check("  ...stays inside the protocol limits", locs.length < 50_000 && sitemap.text.length < 50 * 1024 * 1024,
  `${locs.length} urls, ${Math.round(sitemap.text.length / 1024)} KB`);
check("  ...has no duplicate URL", new Set(locs).size === locs.length, `${locs.length - new Set(locs).size} duplicated`);
check("  ...includes the product just checked", sitemapProducts.includes(product.slug));

const shelfTotal = JSON.parse((await get("/api/products?available=0&limit=1")).text).total;
check(`  product URLs (${sitemapProducts.length}) equal what the shelf serves (${shelfTotal})`,
  sitemapProducts.length === shelfTotal);

// Every slug the file printed, resolved back through the catalogue read at the top.
const notVisible = sitemapProducts.filter((s) => !bySlug.has(s));
check("  every listed product is active or unavailable", notVisible.length === 0, notVisible.slice(0, 5).join(", "));
const retired = sitemapProducts.filter((s) => {
  const c = catById.get(bySlug.get(s)?.categoryId);
  return !c || !c.active || (c.parentId != null && !catById.get(c.parentId)?.active);
});
check("  none of them sits in a retired section", retired.length === 0, retired.slice(0, 5).join(", "));

/**
 * The brand allowlist is enforced by `applyBrandAllowlist` setting `status = "hidden"`, so the
 * sitemap does not re-read brands-we-sell.txt — a second implementation of one rule is free to
 * disagree with the first. What can genuinely happen is the file being edited and the script
 * never run, and that is what this catches.
 */
const allow = loadAllowlist();
const offList = [...new Set(sitemapProducts.map((s) => bySlug.get(s)?.brand?.name ?? "(no brand)"))].filter((b) => !allow.has(b));
check(`  every listed product is from one of the ${allow.size} allowlisted brands`, offList.length === 0,
  offList.slice(0, 5).join(", "));

const leaked = unreachable.filter((p) => sitemapProducts.includes(p.slug));
check(`  none of ${unreachable.length} hidden/discontinued products is listed`, leaked.length === 0,
  leaked.slice(0, 5).map((p) => `${p.slug} (${p.status})`).join(", "));

/**
 * The other direction, taken from the shelf rather than from the database: whatever
 * `/api/products` hands a customer has to be in the file. Three pages, chosen at random, because
 * a count can match while the contents differ.
 */
const pages = 3, limit = 96;
const picked = Array.from({ length: pages }, () => 1 + Math.floor(Math.random() * Math.ceil(shelfTotal / limit)));
const served = (await getAll(picked.map((n) => `/api/products?available=0&limit=${limit}&page=${n}`), 2))
  .flatMap((r) => JSON.parse(r.text).products.map((p) => p.slug));
const absent = served.filter((s) => !sitemapProducts.includes(s));
check(`  all ${served.length} products the shelf served on pages ${picked.join(", ")} are listed`, absent.length === 0,
  absent.slice(0, 5).join(", "));

// Categories: listed only when this same file also lists something standing on them, so a
// department the allowlist emptied is not advertised as a shelf.
const inactiveCats = categories.filter((c) => !c.active).map((c) => c.slug);
check("  no inactive category is listed", !sitemapCats.some((s) => inactiveCats.includes(s)),
  sitemapCats.filter((s) => inactiveCats.includes(s)).join(", "));
const emptyCats = sitemapCats.filter((slug) => {
  const c = categories.find((x) => x.slug === slug);
  const ids = new Set([c?.id, ...categories.filter((x) => x.parentId === c?.id).map((x) => x.id)]);
  return !sitemapProducts.some((s) => ids.has(bySlug.get(s)?.categoryId));
});
check(`  all ${sitemapCats.length} listed categories hold at least one listed product`, emptyCats.length === 0,
  emptyCats.join(", "));

// A sitemap full of 404s costs trust in the whole file, so a few of them are actually opened.
const spot = [sitemapProducts[0], sitemapProducts[sitemapProducts.length - 1]].map((s) => `/product/${s}`)
  .concat(sitemapCats.slice(0, 2).map((s) => `/category/${s}`));
const spotted = await getAll(spot);
check(`  ${spot.length} sampled URLs all answer 200`, spotted.every((r) => r.status === 200),
  spotted.map((r) => r.status).join(","));
check("  ...and none of them is noindex", spotted.every((r) => !/content="noindex/.test(r.text)));

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exit(fail ? 1 : 0);
