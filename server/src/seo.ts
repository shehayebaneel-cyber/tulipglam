import type { PrismaClient, Prisma } from "@prisma/client";
import { resolveRail } from "./picks.js";

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
/**
 * `<title>`: the page's own name, then the shelf it sits on if that fits, then the store.
 *
 * Results truncate around 60 characters, so both extras are conditional and the name always
 * wins. The shelf is there because names alone are not unique: "Nivea Soft Cream" is two
 * different products in this catalogue, one in Moisturisers and one in Body Care, and they had
 * the same title down to the character.
 */
const titled = (main: string, siteName: string, shelf = "") => {
  const tail = BRAND_TAIL(siteName);
  if (main.length + tail.length > 60) return main;
  const qualified = shelf ? `${main} · ${shelf}` : main;
  return (qualified.length + tail.length <= 60 ? qualified : main) + tail;
};

/**
 * Three facts, all of them structural: the owner holds no stock and sources after the order,
 * delivery covers Lebanon, and cash on delivery is the only payment method there is. Used as
 * the description body for the products the suppliers shipped no copy for.
 */
const SOURCED_TO_ORDER = "Sourced to order and delivered across Lebanon, cash on delivery.";

/** Meta descriptions are cut around 155 characters; JSON-LD has no such limit but is not an essay. */
const META_MAX = 155;
const JSONLD_MAX = 320;
/** A long supplier title is cut before the facts that distinguish it are appended. */
const NAME_IN_DESCRIPTION = 90;
/** Below this there is no room for a sentence, so the supplier's copy is dropped rather than stubbed. */
const MIN_BODY = 40;
/** How many products a category page's ItemList carries. Roughly one shelf-full. */
const ITEM_LIST_SIZE = 12;

/**
 * A product's description, built so that no two products can share one.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────
 *
 * The chain was `shortDesc || description || "<name> — $price…"`, which sounds distinct and is
 * not: suppliers write copy once per RANGE and paste it onto every member. Measured over the
 * 1,567 reachable products, **295 shared their description verbatim with at least one other
 * product** (82 groups) and 316 shared their opening 60 characters — one antiperspirant
 * sentence appeared on 35 pages, one body-lotion sentence on 13. Another 35 products had no
 * copy at all. Google drops near-duplicate descriptions and writes its own, so those pages were
 * spending the one snippet they control on a sentence 34 other pages also claimed.
 *
 * ── WHAT REPLACES IT ───────────────────────────────────────────────────────────────
 *
 * A lead assembled from fields that already differ — display name, department > shelf, price —
 * followed by whatever the supplier wrote, trimmed to what is left of the budget. Every part is
 * read from a column; nothing here describes the product in words of ours, because the owner
 * owns customer-facing wording. Re-measured with this in place: 1,567 of 1,567 distinct.
 *
 * The price is in the lead rather than the tail because it is the field most likely to separate
 * two rows a supplier gave the same name, the same shelf and the same paragraph.
 */
export function productDescription(
  p: { name: string; categoryPath: string; priceCents: number; copy: string },
  max = META_MAX,
): string {
  // No price is not $0.00. A supplier row with a broken price gets a description that simply
  // does not mention money, the same way its JSON-LD carries no offer.
  const price = p.priceCents > 0 ? `, $${money(p.priceCents)}` : "";
  const lead = `${summarise(p.name, NAME_IN_DESCRIPTION)} — ${p.categoryPath}${price}.`;
  const copy = p.copy.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const room = max - lead.length - 1;
  if (room < MIN_BODY) return summarise(lead, max);
  return `${lead} ${summarise(copy || SOURCED_TO_ORDER, room)}`;
}

/**
 * The catalogue a customer can actually reach — the one predicate the sitemap is built from.
 *
 * `visible` is the STOREFRONT'S own predicate, handed in by index.ts rather than restated here.
 * A sitemap that selects rows with a second, similar-looking `where` is a sitemap that will
 * eventually advertise a different catalogue from the shelf, and neither side will say so.
 *
 * What this adds is the one condition the shelf query does not express: a retired section
 * (`Category.active = false`) is off the nav, off its own category page and off every department
 * dropdown, so a crawler must not be sent to its products. `retire-sections.ts` also hides those
 * products, so today the clause changes nothing — it is here so that deactivating a category in
 * admin, which does NOT touch product status, cannot quietly re-list a retired shelf.
 *
 * The brand allowlist is deliberately NOT a clause here. `applyBrandAllowlist` enforces it by
 * setting `status = "hidden"`, so `visible` already carries it; reading brands-we-sell.txt at
 * render time would be a second implementation of one rule, free to disagree with the copy the
 * shelf uses. `test-seo.mjs` asserts instead that no product in the sitemap belongs to an
 * off-list brand, which catches the failure that can actually happen — the file edited and the
 * script never run.
 */
export function reachableProducts(visible: Prisma.ProductWhereInput): Prisma.ProductWhereInput {
  return {
    AND: [
      visible,
      { category: { active: true, OR: [{ parentId: null }, { parent: { active: true } }] } },
    ],
  };
}

/** "a", "a and b", "a, b and c" — for listing a department's shelves in a sentence. */
const andList = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

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
  /**
   * Private, signed-in or transactional pages: real routes, 200, never indexed.
   *
   * `rewards` and `orders` were missing from this list, so both answered **404 on a direct visit
   * or a refresh** — the SPA still booted and rendered, which is why nobody noticed, but the
   * status line said the page did not exist. That matters more from the migration onward, with
   * Cloudflare in front and cache rules deciding what to keep: a cached 404 on a real customer
   * page is a page that stops existing for everyone behind that edge.
   *
   * Found by listing every router path against this table and then REQUESTING each one. The
   * structural comparison flagged eleven; nine were false positives handled by branches further
   * down. Testing turned a list of suspicions into two facts.
   */
  if (["cart", "checkout", "account", "login", "register", "wishlist", "forgot-password", "reset-password", "admin", "order", "orders", "rewards"].includes(parts[0] ?? "")) {
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
      // Up to four photos: a rich result is allowed several and picks per aspect ratio, while
      // og:image still takes the first. `take: 1` was leaving the other three unused.
      include: { brand: true, category: { include: { parent: true } }, images: { orderBy: { sortOrder: "asc" }, take: 4 } },
    });
    // Hidden isn't just unlisted — linking to it from search would 404 the visitor.
    if (!p || p.status === "hidden") return { ...base, status: 404, noIndex: true, title: titled("Page not found", siteName) };

    const brand = p.brand?.name ?? "";
    const name = brand && !p.name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${p.name}` : p.name;
    const price = p.saleCents ?? p.priceCents;
    const image = p.images[0]?.url ?? "";
    const categoryPath = p.category.parent ? `${p.category.parent.name} > ${p.category.name}` : p.category.name;
    const facts = { name, categoryPath, priceCents: price, copy: p.shortDesc || p.description };
    const description = productDescription(facts);

    /**
     * A product whose section has been retired is off the nav and off its own category page, so
     * it must not be pulled into search either — that is the same set `reachableProducts` gives
     * the sitemap, answered here by the single row already in hand.
     *
     * `noIndex` and not 404: the page renders perfectly well for someone holding the link, and a
     * real page answering 404 is the mistake `/rewards` and `/orders` were making.
     */
    const retiredSection = !p.category.active || (p.category.parent ? !p.category.parent.active : false);

    return {
      title: titled(name, siteName, p.category.name),
      description,
      canonical,
      image,
      type: "product",
      // Discontinued products stay reachable for anyone holding the link, but should not be
      // pulled into search — the answer there is permanently "no".
      noIndex: p.status === "discontinued" || retiredSection,
      jsonLd: [
        {
          "@context": "https://schema.org", "@type": "Product",
          name,
          // Longer than the meta tag, from the same builder: a rich result has room for the
          // supplier's sentence where a search snippet does not.
          description: productDescription(facts, JSONLD_MAX),
          url: canonical,
          ...(p.images.length ? { image: p.images.map((i) => new URL(i.url, canonical).toString()) } : {}),
          ...(brand ? { brand: { "@type": "Brand", name: brand } } : {}),
          // No `sku`. Product.sku holds the *supplier's* reorder code, which is admin-only —
          // publishing it would hand a competitor the sourcing list. schema.org treats sku as
          // optional, so leaving it out costs nothing.
          category: categoryPath,
          /**
           * No price, no offer.
           *
           * 139 rows in this catalogue carry a broken supplier price and are held at `hidden`
           * for exactly that reason, but status and price are two independent columns: one of
           * them reaching the storefront at 0 would otherwise publish `"price": "0.00"` as a
           * structured, machine-read claim that this shop sells it for nothing. A Product with
           * no Offer is valid schema and simply is not eligible for a price-carrying result,
           * which is the honest outcome.
           */
          ...(price > 0 ? {
            offers: {
              "@type": "Offer",
              url: canonical,
              priceCurrency: "USD",
              price: money(price),
              /**
               * Nothing is stocked, so `InStock` would be a claim the business cannot make —
               * every order is sourced after it is placed. `LimitedAvailability` is schema.org's
               * term for exactly that, and `unavailable` — a real status the owner sets when a
               * supplier cannot get something — must not be flattened into it.
               */
              availability: p.status === "active"
                ? "https://schema.org/LimitedAvailability"
                : p.status === "discontinued"
                  ? "https://schema.org/Discontinued"
                  : "https://schema.org/OutOfStock",
              seller: { "@type": "Organization", name: siteName },
            },
          } : {}),
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
    /**
     * The whole taxonomy in one query — 41 rows — and the tree resolved in JS.
     *
     * `include: { parent, children, _count }` costs one sequential round trip PER relation
     * (see cards.ts), which at Neon's 145 ms is most of the time this page spends. Reading every
     * category once is a single trip and answers all three. The `_count` it replaces was being
     * fetched and never read, and would have been wrong anyway: it counted products held
     * DIRECTLY, which for a department is zero.
     */
    const all = await db.category.findMany({
      select: { id: true, slug: true, name: true, blurb: true, active: true, parentId: true },
    });
    const c = all.find((x) => x.slug === parts[1]);
    if (!c || !c.active) return { ...base, status: 404, noIndex: true, title: titled("Page not found", siteName) };
    const parent = c.parentId != null ? all.find((x) => x.id === c.parentId) : undefined;
    const children = all.filter((x) => x.parentId === c.id && x.active);

    // Departments hold no products directly, so the shelf matches the category AND its children.
    // The head has to count and list the same rows or it is describing a different page.
    const where: Prisma.ProductWhereInput = {
      AND: [reachableProducts(ctx.visible), { categoryId: { in: [c.id, ...children.map((x) => x.id)] } }],
    };
    const [count, sample] = await Promise.all([
      db.product.count({ where }),
      db.product.findMany({
        where,
        select: { slug: true, name: true },
        take: ITEM_LIST_SIZE,
        // The shop's "featured" order, so the list a crawler is given is the one a visitor opens.
        orderBy: [{ status: "asc" }, { isBestSeller: "desc" }, { createdAt: "desc" }],
      }),
    ]);

    /**
     * The blurb is the owner's copy and goes in the head only if it survives two checks.
     *
     * For 25 of the 39 active categories `blurb` is the category's own name ("Serums" → "Serums"),
     * which makes the description a copy of the title and tells a searcher nothing.
     *
     * And it must not carry a figure. `nail-colors` reads "Over 100 shades" against 15 reachable
     * products holding 74 shade variants — a claim the catalogue can check and does not support,
     * left behind when the brand allowlist cut the range. Printed next to the real count it would
     * put two contradicting numbers in one description. The storefront still renders the blurb;
     * this is the head declining to republish a figure, not a rewrite of the owner's words.
     */
    const blurb = c.blurb.trim();
    const usableBlurb = blurb && blurb.toLowerCase() !== c.name.toLowerCase() && !/\d/.test(blurb);

    const shelves = children.length
      ? ` across ${andList(children.map((x) => x.name))}`
      : parent ? ` in ${parent.name}` : "";
    const fit = (s: string, add: string) => (s.length + 1 + add.length <= META_MAX ? `${s} ${add}` : s);
    let description = `${c.name} at ${siteName} — ${count} ${count === 1 ? "product" : "products"}${shelves}.`;
    if (usableBlurb) description = fit(description, blurb.endsWith(".") ? blurb : `${blurb}.`);
    description = summarise(fit(description, SOURCED_TO_ORDER), META_MAX);

    return {
      ...base,
      title: titled(c.name, siteName, parent?.name ?? ""),
      description,
      /**
       * Two ways a live category page is still not worth indexing: its department was retired
       * out from under it (the page renders, so 404 would be a lie), or the allowlist has left
       * it with nothing on it. Both match what the sitemap lists.
       */
      noIndex: (parent ? !parent.active : false) || count === 0,
      jsonLd: [
        crumbs(origin, [
          ["Home", "/"],
          ...(parent ? [[parent.name, `/category/${parent.slug}`] as [string, string]] : []),
          [c.name, pathname],
        ]),
        // `numberOfItems` is the length of THIS list, not the size of the shelf. Saying 501 and
        // then listing 12 is two numbers for one quantity, and the smaller one is the honest one.
        ...(sample.length ? [{
          "@context": "https://schema.org", "@type": "ItemList",
          name: c.name,
          url: canonical,
          numberOfItems: sample.length,
          itemListElement: sample.map((p, i) => ({
            "@type": "ListItem", position: i + 1, name: p.name, url: `${origin}/product/${p.slug}`,
          })),
        }] : []),
      ],
    };
  }

  // /men and /women were retired by the owner, so neither is listed here and both fall through
  // to the 404 at the bottom. The router has no route for them either, and a page that renders
  // "not found" must not answer 200 or crawlers keep it indexed.
  //
  // The `audience` field is still very much in use — it drives the "For him / For her" filter
  // and the department dropdowns. It just no longer has shelves of its own.

  // Resolved once per head render; cached inside picks.ts so this is not a round trip.
  const rail = await resolveRail(db);

  const STATIC: Record<string, [string, string]> = {
    shop: ["All products", `Every product at ${siteName}, delivered across Lebanon.`],
    request: ["Request a product", `Ask ${siteName} to source something we do not list.`],
    categories: ["All categories", `Every department and shelf at ${siteName}, from makeup to fragrance.`],
    brands: ["Our brands", `The brands carried at ${siteName}, sourced to order and delivered across Lebanon.`],
    new: ["New arrivals", `The latest additions at ${siteName}.`],
    /**
     * Both spellings resolve through `picks.ts`, so the `<head>` cannot outlive the claim.
     *
     * This entry read *"The most-ordered products"* while the list came from a checkbox in
     * admin and no order had ever been counted — a factual claim about customer behaviour,
     * rendered server-side into the one surface WhatsApp's crawler reads when a link is pasted
     * into a chat. Now the words come from whichever rail is live.
     */
    bestsellers: [rail.label, rail.blurb],
    "our-picks": [rail.label, rail.blurb],
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
 * ── IT HAS TO EQUAL THE SHELF, AND IT CANNOT BE ALLOWED TO DRIFT ───────────────────
 *
 * The row selection is `reachableProducts(visible)` — the storefront's own predicate, narrowed
 * by one clause — and not a second `where` that looks similar. Two similar predicates is how a
 * sitemap ends up advertising a catalogue the shop does not have, silently, on the one surface
 * nobody opens. `test-seo.mjs` reconciles the count here against the total `/api/products`
 * reports for the same request, so a disagreement fails a suite instead of reaching a crawler.
 *
 * The category half is counted from the SAME rows, so the two halves cannot disagree either: a
 * shelf is listed only when this file also lists something standing on it. That drops a
 * department whose products the brand allowlist has taken away, rather than sending a crawler to
 * an empty page.
 *
 * ~1,600 URLs sits well inside the 50,000-URL / 50 MB protocol limits, so one file is enough.
 * `lastmod` comes from `updatedAt`, which the importers touch, so a re-import refreshes it.
 */
export async function sitemapXml(ctx: Ctx): Promise<string> {
  const { db, origin, visible } = ctx;
  // Only the rail that is actually live is listed, so the sitemap never advertises a
  // /bestsellers page whose heading says something else.
  const rail = await resolveRail(db);
  const [allCategories, products] = await Promise.all([
    // Category has no updatedAt, so its entries carry no lastmod rather than a made-up one.
    // Read whole rather than filtered, because "is my parent active" is answered from this list.
    db.category.findMany({ select: { id: true, slug: true, active: true, parentId: true } }),
    db.product.findMany({
      where: reachableProducts(visible),
      select: { slug: true, updatedAt: true, categoryId: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const byId = new Map(allCategories.map((c) => [c.id, c]));
  // Products roll up into their department, the same widening `/api/products?category=` does.
  // Depth-bounded: a parent chain that ever became circular would otherwise spin here.
  const held = new Map<number, number>();
  for (const p of products) {
    let c = byId.get(p.categoryId);
    for (let depth = 0; c && depth < 4; depth++) {
      held.set(c.id, (held.get(c.id) ?? 0) + 1);
      c = c.parentId != null ? byId.get(c.parentId) : undefined;
    }
  }
  const categories = allCategories.filter((c) =>
    c.active
    && (c.parentId == null || (byId.get(c.parentId)?.active ?? false))
    && (held.get(c.id) ?? 0) > 0);

  const urls: { loc: string; lastmod?: Date; priority: string }[] = [
    { loc: "/", priority: "1.0" },
    { loc: "/shop", priority: "0.9" },
    { loc: "/categories", priority: "0.8" },
    { loc: "/request", priority: "0.6" },
    { loc: "/brands", priority: "0.7" },
    { loc: "/new", priority: "0.7" },
    { loc: rail.href, priority: "0.7" },
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
