import type { PrismaClient, Prisma } from "@prisma/client";

/**
 * Server-rendered <head> for the single-page app.
 *
 * The storefront is a client-side React app, so a crawler that doesn't execute JavaScript sees
 * one title and one description for all 9,500 products. That matters more here than on most
 * sites: **the store runs on WhatsApp, and WhatsApp's link preview crawler does not run
 * JavaScript.** Pasting a product link into a chat — the single most common way a product gets
 * shared — produced the generic homepage card with no photo, no name and no price.
 *
 * So the head is built on the server and injected into the built index.html before it is sent.
 * The app still renders everything below it; only the head is resolved server-side.
 *
 * Applies in production, where Express serves web/dist. In development Vite serves index.html
 * directly and none of this runs, so check link previews against a build.
 */

export type PageMeta = {
  title: string;
  description: string;
  /** Absolute URL. Relative paths are resolved against the request origin. */
  image?: string;
  canonical: string;
  /** "product" for a product page, "website" otherwise. */
  type?: "website" | "product";
  /** Serialised JSON-LD blocks. */
  jsonLd?: unknown[];
  /** Tell crawlers not to index this page. */
  noIndex?: boolean;
  /** HTTP status to send with the document. 404 for a slug that doesn't exist. */
  status?: number;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JSON inside a <script> must not be able to close the tag early. */
const escJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** Collapse whitespace, strip tags, and cut on a word boundary — never mid-word. */
export function summarise(raw: string, max = 155): string {
  const text = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "") + "…";
}

const money = (cents: number) => (cents / 100).toFixed(2);

export function renderHead(meta: PageMeta, siteName: string): string {
  const abs = (u: string | undefined) => (u && /^https?:\/\//.test(u) ? u : u ? new URL(u, meta.canonical).toString() : "");
  const image = abs(meta.image);
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${esc(meta.canonical)}" />`,
    meta.noIndex ? `<meta name="robots" content="noindex, follow" />` : "",
    `<meta property="og:site_name" content="${esc(siteName)}" />`,
    `<meta property="og:type" content="${meta.type ?? "website"}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.canonical)}" />`,
    image ? `<meta property="og:image" content="${esc(image)}" />` : "",
    // summary_large_image needs an image; without one it renders as an empty box.
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    image ? `<meta name="twitter:image" content="${esc(image)}" />` : "",
    ...(meta.jsonLd ?? []).map((b) => `<script type="application/ld+json">${escJson(b)}</script>`),
  ];
  return tags.filter(Boolean).join("\n    ");
}

/**
 * Swap the built index.html's head for a resolved one.
 *
 * The build ships a title and description, so those are removed rather than duplicated — two
 * <title> tags is undefined behaviour and two descriptions is a crawler coin-flip.
 *
 * Removal is comment-aware, and that is not a nicety. The first version matched by pattern
 * alone, and index.html carried a comment that mentioned the title tag by name. The match
 * started inside that comment and ran to the real closing tag, deleting the `-->` along the
 * way — which left an unclosed comment that swallowed the rest of the head, including the
 * module script. Every response was still 200, still had exactly one title, still had valid
 * Open Graph. The page was blank, because the app never loaded.
 *
 * So: find the comment ranges first, and only touch matches that start outside all of them.
 */
export function injectHead(html: string, head: string): string {
  // Blank every comment to same-length whitespace. Offsets in the mask therefore line up
  // exactly with the original, so matches can be found on the mask — where no comment can
  // contribute one — and cut out of the real string.
  //
  // Skipping matches that merely *start* in a comment is not enough: the comment's `<title>`
  // and the document's `</title>` form one lazy match, so skipping it also skips past the real
  // tag and nothing gets removed.
  const mask = html.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));

  const cuts: [number, number][] = [];
  const firstIn = (re: RegExp) => {
    const m = re.exec(mask);
    if (m) cuts.push([m.index, m.index + m[0].length]);
  };
  firstIn(/<title>[\s\S]*?<\/title>\s*/i);
  firstIn(/<meta\s+name="description"[^>]*>\s*/i);

  // Back to front, so earlier offsets stay valid as later ones are removed.
  let out = html;
  for (const [a, b] of cuts.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + out.slice(b);

  return out.replace(/<\/head>/i, `  ${head}\n  </head>`);
}

const BRAND_TAIL = (siteName: string) => ` · ${siteName}`;
/** Titles over ~60 characters are truncated in results, so the name is dropped before the tail. */
const titled = (main: string, siteName: string) => {
  const tail = BRAND_TAIL(siteName);
  return main.length + tail.length <= 60 ? main + tail : main;
};

type Ctx = { db: PrismaClient; origin: string; settings: Record<string, string>; visible: Prisma.ProductWhereInput };

/**
 * Resolve a storefront path to its head.
 *
 * Returns null for anything not worth a bespoke head (cart, checkout, admin) — those fall back
 * to the shipped defaults with noindex, since a checkout page in search results helps nobody.
 */
export async function metaForPath(pathname: string, ctx: Ctx): Promise<PageMeta> {
  const { db, origin, settings } = ctx;
  const siteName = settings.storeName || "TulipGlam";
  const canonical = origin + pathname;
  const base: PageMeta = {
    title: `${siteName} — Premium Beauty · Lebanon`,
    description: settings.heroSub
      || "Premium makeup, skincare, hair and fragrance, delivered across Lebanon. Cash on delivery.",
    canonical,
    image: settings.heroImage || "",
  };

  const parts = pathname.split("/").filter(Boolean);

  // Pages that must never be indexed: personal, transactional, or a dead end for a searcher.
  if (["cart", "checkout", "account", "login", "register", "wishlist", "forgot-password", "reset-password", "admin", "order"].includes(parts[0] ?? "")) {
    return { ...base, noIndex: true, title: titled(properCase(parts[0]!), siteName) };
  }

  if (parts.length === 0) {
    return {
      ...base,
      jsonLd: [{
        "@context": "https://schema.org", "@type": "Store",
        name: siteName, url: origin,
        // Only fields with a real value — an empty telephone is worse than none.
        ...(settings.whatsappNumber ? { telephone: settings.whatsappNumber } : {}),
        ...(settings.contactEmail ? { email: settings.contactEmail } : {}),
        address: { "@type": "PostalAddress", addressCountry: "LB" },
        currenciesAccepted: "USD",
        paymentAccepted: "Cash on delivery",
      }],
    };
  }

  if (parts[0] === "product" && parts[1]) {
    const p = await db.product.findUnique({
      where: { slug: parts[1] },
      include: { brand: true, category: { include: { parent: true } }, images: { orderBy: { sortOrder: "asc" }, take: 1 } },
    });
    // Hidden isn't just unlisted — linking to it from search would 404 the visitor.
    if (!p || p.status === "hidden") return { ...base, status: 404, noIndex: true, title: titled("Page not found", siteName) };

    const brand = p.brand?.name ?? "";
    const name = brand && !p.name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${p.name}` : p.name;
    const price = p.saleCents ?? p.priceCents;
    const image = p.images[0]?.url ?? "";
    const description = summarise(
      p.shortDesc || p.description || `${name} — $${money(price)}. Delivered across Lebanon, cash on delivery.`,
    );

    return {
      title: titled(name, siteName),
      description,
      canonical,
      image,
      type: "product",
      // Discontinued products stay reachable for anyone holding the link, but should not be
      // pulled into search — the answer there is permanently "no".
      noIndex: p.status === "discontinued",
      jsonLd: [
        {
          "@context": "https://schema.org", "@type": "Product",
          name, description,
          ...(image ? { image: [new URL(image, canonical).toString()] } : {}),
          ...(brand ? { brand: { "@type": "Brand", name: brand } } : {}),
          // No `sku`. Product.sku holds the *supplier's* reorder code, which is admin-only —
          // publishing it would hand a competitor the sourcing list. schema.org treats sku as
          // optional, so leaving it out costs nothing.
          category: p.category.parent ? `${p.category.parent.name} > ${p.category.name}` : p.category.name,
          offers: {
            "@type": "Offer",
            url: canonical,
            priceCurrency: "USD",
            price: money(price),
            // No stock is held, so InStock would be a claim the business cannot make.
            // "LimitedAvailability" is schema.org's term for sourced-to-order.
            availability: p.status === "active"
              ? "https://schema.org/LimitedAvailability"
              : p.status === "discontinued"
                ? "https://schema.org/Discontinued"
                : "https://schema.org/OutOfStock",
          },
        },
        // Department included where there is one, so the trail reads
        // "Home > Fragrance > Unisex > …" rather than jumping straight to a subcategory.
        crumbs(origin, [
          ["Home", "/"],
          ...(p.category.parent ? [[p.category.parent.name, `/category/${p.category.parent.slug}`] as [string, string]] : []),
          [p.category.name, `/category/${p.category.slug}`],
          [name, pathname],
        ]),
      ],
    };
  }

  if (parts[0] === "category" && parts[1]) {
    const c = await db.category.findUnique({
      where: { slug: parts[1] },
      include: { parent: true, _count: { select: { products: { where: ctx.visible } } } },
    });
    if (!c || !c.active) return { ...base, status: 404, noIndex: true, title: titled("Page not found", siteName) };
    return {
      ...base,
      title: titled(c.name, siteName),
      description: summarise(c.blurb || `${c.name} at ${siteName}. Delivered across Lebanon, cash on delivery.`),
      jsonLd: [crumbs(origin, [
        ["Home", "/"],
        ...(c.parent ? [[c.parent.name, `/category/${c.parent.slug}`] as [string, string]] : []),
        [c.name, pathname],
      ])],
    };
  }

  // /men was retired by the owner. It is not listed here, so it falls through to the 404 at the
  // bottom — the router no longer has the route either, and a page that renders "not found"
  // must not answer 200 or crawlers keep it indexed.
  if (parts[0] === "women") {
    return {
      ...base,
      title: titled("Women’s beauty and skincare", siteName),
      description: `Women’s makeup, skincare, hair and fragrance at ${siteName}. Delivered across Lebanon, cash on delivery.`,
    };
  }

  const STATIC: Record<string, [string, string]> = {
    shop: ["All products", `Every product at ${siteName}, delivered across Lebanon.`],
    brands: ["Our brands", `The brands carried at ${siteName}, sourced to order and delivered across Lebanon.`],
    new: ["New arrivals", `The latest additions at ${siteName}.`],
    bestsellers: ["Best sellers", `The most-ordered products at ${siteName}.`],
    sale: ["On sale", `Reduced products at ${siteName}.`],
    "gift-cards": ["Gift cards", `Send a ${siteName} gift card, arranged over WhatsApp.`],
    contact: ["Contact us", `Get in touch with ${siteName}.`],
    track: ["Track your order", "Follow your order with its number — no sign-in needed."],
    shipping: ["Delivery", "How delivery works across Lebanon, and what it costs."],
    returns: ["Returns", "How returns and exchanges work."],
    faq: ["FAQ", `Common questions about ordering from ${siteName}.`],
    about: ["About us", `About ${siteName}.`],
    privacy: ["Privacy", "What we collect and why."],
    terms: ["Terms", "The terms of using this store."],
    "gift-card-terms": ["Gift card terms", "How gift cards work and what applies to them."],
  };
  const hit = STATIC[parts[0] ?? ""];
  if (hit && parts.length === 1) {
    return { ...base, title: titled(hit[0], siteName), description: hit[1] };
  }

  // Search results are per-visitor and change constantly — nothing to index.
  if (parts[0] === "search") return { ...base, noIndex: true, title: titled("Search", siteName) };

  return { ...base, status: 404, noIndex: true, title: titled("Page not found", siteName) };
}

function crumbs(origin: string, items: [string, string][]) {
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], i) => ({
      "@type": "ListItem", position: i + 1, name, item: origin + path,
    })),
  };
}

const properCase = (s: string) => s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * robots.txt.
 *
 * Anything transactional or personal is disallowed. `/search` is disallowed because its result
 * pages are infinite and thin, and crawling them wastes the budget that should go on products.
 */
export function robotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /cart",
    "Disallow: /checkout",
    "Disallow: /account",
    "Disallow: /login",
    "Disallow: /register",
    "Disallow: /forgot-password",
    "Disallow: /reset-password",
    "Disallow: /wishlist",
    "Disallow: /order/",
    "Disallow: /search",
    "Disallow: /api/",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

/**
 * sitemap.xml, built from the live catalogue.
 *
 * Only products a visitor can actually reach: `active` and `unavailable`. Listing a hidden or
 * discontinued product would send a crawler to a 404 and cost trust in the whole sitemap.
 *
 * ~9,500 URLs sits well inside the 50,000-URL / 50 MB protocol limits, so one file is enough.
 * `lastmod` comes from `updatedAt`, which the importers touch, so a re-import refreshes it.
 */
export async function sitemapXml(ctx: Ctx): Promise<string> {
  const { db, origin, visible } = ctx;
  const [categories, products] = await Promise.all([
    // Category has no updatedAt, so its entries carry no lastmod rather than a made-up one.
    db.category.findMany({ where: { active: true }, select: { slug: true } }),
    db.product.findMany({ where: visible, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: "desc" } }),
  ]);

  const urls: { loc: string; lastmod?: Date; priority: string }[] = [
    { loc: "/", priority: "1.0" },
    { loc: "/shop", priority: "0.9" },
    { loc: "/brands", priority: "0.7" },
    { loc: "/new", priority: "0.7" },
    { loc: "/bestsellers", priority: "0.7" },
    { loc: "/gift-cards", priority: "0.5" },
    { loc: "/contact", priority: "0.4" },
    { loc: "/shipping", priority: "0.3" },
    { loc: "/returns", priority: "0.3" },
    { loc: "/faq", priority: "0.3" },
    { loc: "/about", priority: "0.3" },
    { loc: "/privacy", priority: "0.2" },
    { loc: "/terms", priority: "0.2" },
    ...categories.map((c) => ({ loc: `/category/${c.slug}`, priority: "0.8" })),
    ...products.map((p) => ({ loc: `/product/${p.slug}`, lastmod: p.updatedAt, priority: "0.6" })),
  ];

  const body = urls.map((u) => [
    "  <url>",
    `    <loc>${esc(origin + u.loc)}</loc>`,
    u.lastmod ? `    <lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : "",
    `    <priority>${u.priority}</priority>`,
    "  </url>",
  ].filter(Boolean).join("\n")).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
