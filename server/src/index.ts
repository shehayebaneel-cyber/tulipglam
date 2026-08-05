import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { randomUUID, createHash } from "crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { ORDER_STATUSES, STATUS_KEYS, statusMeta, nextStatuses, canTransition } from "./status.js";
import { hashPassword, checkPassword, signToken, withCustomer, requireCustomer, assertAuthConfig } from "./auth.js";
import { rateLimit, LIMITS } from "./rateLimit.js";
import { recordSignup, launchListStats, launchListCsv } from "./launchList.js";
import { manifest, dispatchLine, courierMessage, reconcile } from "./dispatch.js";
import { queueMail, flushOutbox, outboxStatus } from "./outbox.js";
import { validateRequest, createRequest, requestSummary } from "./productRequests.js";
import { searchProductIds } from "./search.js";
import { loadCards, type CardRow } from "./cards.js";
import { resolveRail, railProductIds, invalidateRail, RAIL_SIZE } from "./picks.js";
import { TX_OPTIONS } from "./tx.js";
import { recordError, countRequest, pulse, recentErrors, resolveError } from "./observe.js";
// No `sendMail` here any more, and that absence is the point: every message this file sends now
// goes through `queueMail`, so there is a row proving it was attempted. The password reset was
// the last direct caller — the one message that cannot be re-sent was the only one leaving no
// record. If a future edit needs `sendMail` imported here again, that is the bug reappearing.
import { mailConfigured, orderConfirmationEmail, statusUpdateEmail, passwordResetEmail } from "./mailer.js";
import { DEV_ADMIN_KEY, validateSettings, setupChecks } from "./setup.js";
import { resolvePromo } from "./promo.js";
import { metaForPath, renderHead, injectHead, robotsTxt, sitemapXml } from "./seo.js";
import { COMING_SOON, comingSoonGate, assertComingSoonConfig, sameSecret, sendGateNotFound, hasPreviewAccess, comingSoonFallback } from "./comingSoon.js";
import {
  safely, onOrderPlaced, onOrderStatusChanged, tierDeliveryCents,
  assertLoyaltyConfig, LOYALTY_SWEEP_SECRET,
} from "./loyalty/hooks.js";
import { LOYALTY_ENABLED, LOYALTY_REDEMPTION_ENABLED } from "./loyalty/config.js";
import {
  repricePendingEarn, readAccount, autoLinkOnFirstRead, recordSignupBonus,
  redeemWithin, previewRedemption, withSerialisationRetry,
  manualAdjustment, linkCustomerToAccount, materialise, LoyaltyError,
} from "./loyalty/ledger.js";
import {
  dashboard as loyaltyDashboard, findAccounts, accountDetail,
  guestClaims, signedInBackfill, decideClaim,
} from "./loyalty/admin.js";
import { merchandiseCentsOf, parseCents } from "./loyalty/rules.js";
import { buildView, emptyView, HISTORY_FETCH } from "./loyalty/present.js";
import { runSweep } from "./loyalty/sweep.js";

const db = new PrismaClient();
const app = express();

/**
 * Exactly one proxy hop.
 *
 * Render terminates TLS and forwards, appending the real client address to X-Forwarded-For.
 * With this set, req.ip reads the entry RENDER appended rather than the leftmost value in that
 * header, which the client controls — without it, every request on Render would report the
 * proxy address and the rate limiter would count the entire internet into a single bucket,
 * locking out the whole store the first time anyone ran a script. Trusting blindly (`true`)
 * would be the opposite mistake: an attacker could inject an X-Forwarded-For of their choosing
 * and get a fresh allowance on every request.
 */
app.set("trust proxy", 1);

// The coming-soon gate goes first, ahead of CORS and body parsing, so a gated request is
// answered before anything else in the app runs — no 12 MB body parse, and nothing that could
// reach Prisma. On Render's free tier the first request after a spin-down already pays ~30s of
// cold start; the gate must not add to it.
//
// Mounted only when it is on, so an ungated request does not even pay for a passthrough.
// Unconditional, unlike the two below: every ownership check in this codebase rests on the
// JWT secret, and there is no state of this application where a weak one is acceptable.
assertAuthConfig();
assertComingSoonConfig();
// Same shape, same rule: only enforced while the feature it protects is switched on.
assertLoyaltyConfig();
if (COMING_SOON) app.use(comingSoonGate());

app.use(cors());
// Server-side request counting. No script on the page, no cookie, no third party — the whole
// point is that the storefront ships nothing to anyone else. See observe.ts for what this
// does and does not measure.
app.use((req, _res, next) => { countRequest(req.path); next(); });
app.use(express.json({ limit: "12mb" })); // room for base64 image uploads

const PORT = Number(process.env.PORT ?? 4230);
const ADMIN_KEY = process.env.ADMIN_KEY ?? DEV_ADMIN_KEY;
const IS_PROD = process.env.NODE_ENV === "production";

// Refuse to serve production with the key that ships in the repo's dev .env. Anyone who
// has read this codebase would otherwise have admin access to a live store.
if (IS_PROD && ADMIN_KEY === DEV_ADMIN_KEY) {
  console.error(
    [
      "",
      "FATAL: ADMIN_KEY is still the development default.",
      "",
      "  The admin panel would accept the key committed to this repository, so anyone",
      "  who has seen the source could sign in and edit the live catalogue.",
      "",
      "  Fix: set a long random ADMIN_KEY in the environment and redeploy.",
      "    Render → your service → Environment → ADMIN_KEY",
      "    Generate one with:  node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
      "",
      "  Refusing to start.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads");
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* noop */ }
app.use("/uploads", express.static(UPLOAD_DIR));

// ---- helpers ----
const num = (v: unknown, d = 0) => (v === undefined || v === null || v === "" ? d : Number(v));
const str = (v: unknown, d = "") => (v === undefined || v === null ? d : String(v));
const bool = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";
const toCents = (v: unknown) => Math.round(num(v) * 100);
const list = (s: string) => str(s).split(",").map((t) => t.trim()).filter(Boolean);
const slugify = (s: string, suffix = "") =>
  (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "item") + (suffix ? `-${suffix}` : "");

/**
 * Every async route goes through here, so this is where a 500 becomes visible.
 *
 * The customer still gets the same opaque message — an error page must never leak a stack
 * trace or a query. What changed is that the error is now RECORDED as well as logged: Render's
 * free tier keeps a short log window and nobody reads it, so in practice a 500 in production
 * used to be invisible until somebody complained.
 *
 * Recording is fire-and-forget with its own catch. An error logger that can fail the request
 * it is reporting on is worse than no error logger.
 */
const asyncH =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((e) => {
      console.error(e);
      void recordError(db, { method: req.method, path: req.path, status: 500, err: e }).catch(() => {});
      res.status(500).json({ error: "Something went wrong." });
    });

/** Products a shopper can reach. Everything customer-facing filters through this. */
const VISIBLE: Prisma.ProductWhereInput = { status: { in: ["active", "unavailable"] } };

/**
 * Who a product is for. `unisex` is the default and shows on both /men and /women — most of a
 * beauty catalogue genuinely is. This is a product field rather than a category because a men's
 * fragrance, a men's shaving cream and a men's shampoo sit in three different departments.
 */
export const AUDIENCES = ["unisex", "men", "women"];

// Brand and category ordering. Every list of brands in the app must agree, so the key and the
// collator live here rather than being re-derived per call site.
const COLLATOR = new Intl.Collator("en", { sensitivity: "base", numeric: true });
/** Trim, collapse inner runs of space, and drop leading articles/punctuation before sorting. */
export const sortKey = (name: string) =>
  name.trim().replace(/\s+/g, " ").replace(/^(the|a|an)\s+/i, "").replace(/^[^\p{L}\p{N}]+/u, "");

/**
 * Turn `groupBy` rows over a comma-joined tag column into per-tag counts.
 *
 * `concerns` and `attributes` used to be a hardcoded list in the Shop sidebar — 9 concerns and
 * 5 attributes, none of which any imported product carries, so all 14 led to "Nothing here yet".
 * Deriving them from the data means an option exists only if something is behind it, and the
 * groups reappear on their own once products are tagged in admin.
 */
function tagFacet(rows: { _count: { _all: number } }[], key: "concerns" | "attributes") {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = (row as unknown as Record<string, string>)[key] ?? "";
    for (const tag of raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)) {
      counts.set(tag, (counts.get(tag) ?? 0) + row._count._all);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || COLLATOR.compare(a.value, b.value));
}

/**
 * Trust-bar items, Settings-driven so an unsupportable claim can be removed without a deploy.
 * Stored as `trustItems` — one "Headline | supporting text" pair per line.
 *
 * The shipped defaults deliberately describe only what exists. The previous hardcoded copy
 * claimed "fast, tracked dispatch", but there is no tracking system — only a 13-step status
 * timeline someone updates by hand.
 */
const DEFAULT_TRUST = [
  "Cash on delivery|Pay when it arrives, anywhere in Lebanon",
  "Check your order anytime|Track by order number, no login needed",
  "Sourced to order|We confirm every item with you before dispatch",
];
/**
 * Take `limit` products while letting no single brand occupy more than `perBrand` slots,
 * preserving the incoming order (recency) and backfilling from other brands.
 *
 * Without this the newest 12 active products were Lattafa ×12, so the homepage's "New arrivals"
 * row showed one brand five times. If the cap cannot be met — a genuinely thin catalogue — the
 * remaining slots are filled in order rather than left blank.
 */
function spreadBrands<T extends { brandId: number | null }>(items: T[], limit: number, perBrand: number): T[] {
  const used = new Map<number | null, number>();
  const picked: T[] = [];
  for (const item of items) {
    if (picked.length >= limit) break;
    const n = used.get(item.brandId) ?? 0;
    if (n >= perBrand) continue;
    used.set(item.brandId, n + 1);
    picked.push(item);
  }
  if (picked.length < limit) {
    const have = new Set(picked);
    for (const item of items) {
      if (picked.length >= limit) break;
      if (!have.has(item)) picked.push(item);
    }
  }
  return picked;
}

type BrandWithCount = { id: number; slug: string; name: string; featured: boolean; sortOrder: number; _count: { products: number } };

/**
 * "Brands we love" — an editorial slot, so it must never be an accident of ordering.
 *
 * It previously showed Dali, Beesline, ACM, Abercrombie and Fitch, Acnevit, Adidas… which
 * looked alphabetical but was really heap order (see the sortOrder=50 note above), and put a
 * one-product brand and a fashion label in a premium beauty store's featured row.
 *
 * Curated first: brands flagged `featured` in admin, in their configured order. Only if none
 * are flagged does it fall back — and then by catalogue depth, never by name or insertion
 * order. `minProducts` keeps thin brands out of the fallback entirely.
 */
function featuredBrands(brands: BrandWithCount[], minProducts: number): BrandWithCount[] {
  const curated = brands
    .filter((b) => b.featured && b._count.products > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || COLLATOR.compare(sortKey(a.name), sortKey(b.name)));
  if (curated.length) return curated.slice(0, 8);

  return [...brands]
    .filter((b) => b._count.products >= minProducts)
    .sort((a, b) => b._count.products - a._count.products || COLLATOR.compare(sortKey(a.name), sortKey(b.name)))
    .slice(0, 8);
}

function trustItems(settings: Record<string, string>): { title: string; body: string }[] {
  /**
   * PRESENCE and VALUE are different questions. Ask them separately.
   *
   * This read `raw ? raw.split("\n") : DEFAULT_TRUST`, so clearing the field restored the
   * defaults and there was no way to turn the bar off at all — in a mechanism whose whole
   * purpose was "an unsupportable claim can be removed without a deploy". You could edit the
   * claims; you could not decline to make any.
   *
   * Exactly the shape of the outbox bug this codebase already fixed, where
   * `SHELF_LIFE[kind] ?? 7 * DAY` treated an intentional `null` as absent and would have
   * expired the launch announcement unsent. Same lesson, different file: a key that is present
   * and empty is an ANSWER, not a missing value.
   *
   *   key absent            -> the owner has never touched this  -> show the defaults
   *   key present, empty    -> the owner said no                 -> show nothing
   */
  const configured = Object.prototype.hasOwnProperty.call(settings, "trustItems");
  const raw = (settings.trustItems ?? "").trim();
  const source = configured ? (raw ? raw.split("\n") : []) : DEFAULT_TRUST;
  const lines = source.map((l) => l.trim()).filter(Boolean);
  return lines
    .map((l) => {
      const [title, ...rest] = l.split("|");
      return { title: (title ?? "").trim(), body: rest.join("|").trim() };
    })
    .filter((i) => i.title);
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.header("x-admin-key") !== ADMIN_KEY) return res.status(401).json({ error: "Access denied." });
  next();
}

/**
 * Settings, cached — because this was a full round trip on **every request**.
 *
 * Thirteen rows, read fresh by nearly every endpoint including search, at 143 ms against Neon.
 * That was the single largest fixed cost on the search path, larger than the trigram query it
 * was preceding (24 ms of actual work), and it was paid by every page on the site.
 *
 * ── WHY A TTL *AND* EXPLICIT INVALIDATION ──────────────────────────────────────────
 *
 * `invalidateSettings()` runs on the settings save, so an admin sees their own change take
 * effect immediately — no "wait a bit and refresh", which is how people learn to distrust an
 * admin screen. The TTL is the backstop for the case explicit invalidation cannot cover: a
 * second process (or a second box after Stage C) writing settings this one never hears about.
 *
 * Five seconds, not five minutes, **because settings carry money** — the free-delivery
 * threshold and the default delivery fee are read from here at checkout. A stale value is a
 * wrong price, so the window is set to the smallest one that still removes the per-request cost
 * rather than the largest one that would still be "probably fine".
 */
const SETTINGS_TTL_MS = 5_000;
let settingsCache: { at: number; value: Record<string, string> } | null = null;

function invalidateSettings() {
  settingsCache = null;
}

async function getSettings(): Promise<Record<string, string>> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;
  const rows = await db.setting.findMany();
  const value = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  settingsCache = { at: Date.now(), value };
  return value;
}

// New badge: mode always/never override; auto = created within N days.
function computeIsNew(p: { isNewMode: string; createdAt: Date }, days: number) {
  if (p.isNewMode === "always") return true;
  if (p.isNewMode === "never") return false;
  return Date.now() - new Date(p.createdAt).getTime() < days * 864e5;
}

/**
 * The one place that decides what a product card shows a customer.
 *
 * Typed on `CardRow` — the minimum a card needs — rather than the full Prisma payload, so both
 * loaders can feed it: Prisma's `include` (which satisfies `CardRow` structurally) and
 * `loadCards`, the single-round-trip raw join used where latency matters. One serialiser, two
 * ways of fetching, no second copy to drift.
 */
function cardOf(p: CardRow, newDays: number) {
  return {
    id: p.id, slug: p.slug, name: p.name, status: p.status,
    priceCents: p.priceCents, saleCents: p.saleCents,
    onSale: p.saleCents != null && p.saleCents < p.priceCents,
    glyph: p.glyph, tint: p.tint,
    image: p.images[0]?.url ?? "",
    brand: p.brand ? { name: p.brand.name, slug: p.brand.slug } : null,
    category: { name: p.category.name, slug: p.category.slug },
    isBestSeller: p.isBestSeller,
    isNew: computeIsNew(p, newDays),
  };
}
const cardInclude = { brand: true, category: true, images: { orderBy: { sortOrder: "asc" as const }, take: 1 } };

/**
 * How many ranked matches a search resolves to before the other filters apply.
 *
 * A search is a ranking, not a set: past a few hundred results the tail is fuzzy matches nobody
 * scrolls to, and carrying it costs a longer id list on every filter and facet query. The cap is
 * therefore also the reported `total`, so a very broad query says "400" rather than a number
 * only true of the fuzzy tail. The broadest realistic query measured here is "makup" at 347,
 * which fits under it — if that stops being true, raise this rather than paginating the tail.
 */
const SEARCH_RESULT_CAP = 400;

// ============================================================ PUBLIC
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/**
 * Settings the storefront is allowed to see.
 *
 * `/api/site` used to return the whole settings table. Nothing sensitive is in there *today*,
 * but only because SMTP has never been configured — the moment someone saves an SMTP password
 * in admin it would be published to every visitor. An allowlist fails closed: a new setting is
 * private until it is deliberately named here.
 */
const PUBLIC_SETTINGS = [
  "storeName", "announcement", "whatsappNumber", "instagramUrl", "contactEmail", "siteUrl",
  "freeDeliveryThresholdCents", "defaultDeliveryCents", "newArrivalDays", "featuredBrandMinProducts",
  "deliveryEstimate", "returnsWindow",
  "promoActive", "promoTitle", "promoText", "promoDiscountText", "promoCtaLabel",
  "heroEyebrow", "heroHeading", "heroSub", "heroCtaLabel", "heroCtaHref",
  "heroAltLabel", "heroAltHref", "heroFootnote", "heroImage",
  "trustItems",
] as const;

function publicSettings(all: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PUBLIC_SETTINGS) if (all[k] != null) out[k] = all[k];
  // Whether a reset email can actually be delivered. The value is a boolean, never the
  // credentials behind it — same shape as `adminKeyIsDefault`.
  out.emailConfigured = mailConfigured(all) ? "true" : "false";
  return out;
}

// header/footer/home bootstrap: settings + categories + featured brands + areas
app.get("/api/site", asyncH(async (_req, res) => {
  const [settings, tops, brands, areas, saleCount, audienceByCat] = await Promise.all([
    getSettings(),
    // full two-level tree: the nav needs children to build its dropdown panels
    db.category.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" },
      include: { _count: { select: { products: { where: VISIBLE } } } } }),
    db.brand.findMany({ where: { active: true }, include: { _count: { select: { products: { where: VISIBLE } } } } }),
    db.deliveryArea.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.product.count({ where: { AND: [VISIBLE, { saleCents: { not: null } }] } }),
    // Per-category audience split, so a department that holds its products directly can offer
    // "For him / For her" in the nav without inventing subcategories for them.
    db.product.groupBy({ by: ["categoryId", "audience"], where: { AND: [VISIBLE, { audience: { in: ["men", "women"] } }] }, _count: { _all: true } }),
  ]);

  // categoryId -> { men, women }, rolled up into the department the same way product counts are.
  const audByCat = new Map<number, { men: number; women: number }>();
  for (const row of audienceByCat) {
    const cat = tops.find((c) => c.id === row.categoryId);
    if (!cat) continue;
    for (const id of [cat.id, ...(cat.parentId ? [cat.parentId] : [])]) {
      const e = audByCat.get(id) ?? { men: 0, women: 0 };
      if (row.audience === "men") e.men += row._count._all; else e.women += row._count._all;
      audByCat.set(id, e);
    }
  }

  const shape = (c: (typeof tops)[number], count = c._count.products) => ({
    id: c.id, slug: c.slug, name: c.name, blurb: c.blurb, glyph: c.glyph, tint: c.tint,
    sortOrder: c.sortOrder, _count: { products: count },
    audience: audByCat.get(c.id) ?? { men: 0, women: 0 },
  });
  // A department holds no products directly — they sit in its children — so its own _count is
  // 0. Displaying that made the nav and the category cards read "Makeup 0" for a department
  // with 1,951 products. Roll the children up.
  const rolledUp = (c: (typeof tops)[number]) =>
    c._count.products + tops.filter((k) => k.parentId === c.id).reduce((n, k) => n + k._count.products, 0);
  // Full two-level tree. `name` is the single source of truth for every label — nav, cards,
  // breadcrumbs, filters and page titles all read it, so they can no longer disagree the way
  // "Fragrance"/"Fragrances" and "Hair"/"Haircare" did when card labels lived inside images.
  const categories = tops
    .filter((c) => c.parentId === null)
    .map((c) => ({ ...shape(c, rolledUp(c)), children: tops.filter((k) => k.parentId === c.id).map((k) => shape(k)) }));

  res.json({
    settings: publicSettings(settings),
    categories,
    /**
     * NOTE: the full brand list is NOT here.
     *
     * It was — all 405 of them, 73 KB of the 83 KB this endpoint returned, on the FIRST LOAD
     * OF EVERY PAGE including the homepage, which shows two brands. Only the Shop sidebar
     * ever needed the whole list, and it fetches /api/brands itself when a customer gets
     * there. Everything else uses `featuredBrands` below.
     *
     * This was flagged in CLAUDE.md as survivable. On a Lebanese mobile connection it is 73 KB
     * of a customer's data allowance spent before they see a product.
     */
    /** How many there are, so the Shop sidebar can say so before it fetches the list. */
    brandCount: brands.length,
    featuredBrands: featuredBrands(brands, num(settings.featuredBrandMinProducts, 8)),
    areas,
    statuses: ORDER_STATUSES,
    // Feature flags so the client never advertises a section that would come back empty.
    // The men/women totals went with the /men and /women shelves; the per-category split
    // below is what the department dropdowns and the shop filter still use.
    // `loyalty` gates the Rewards link in the account area. Off means the programme is not
    // mentioned anywhere on the storefront — no link, no teaser, no disabled entry.
    flags: { hasSale: saleCount > 0, loyalty: LOYALTY_ENABLED },
    // Published so the nav, footer and shop heading cannot name this rail differently from the
    // homepage. One resolver, every surface.
    picks: await resolveRail(db).then((r) => ({ mode: r.mode, label: r.label, href: r.href })),
    trust: trustItems(settings),
  });
}));

// home collections
app.get("/api/home", asyncH(async (_req, res) => {
  const settings = await getSettings();
  const newDays = num(settings.newArrivalDays, 30);
  /**
   * Ids then `loadCards`, for the same reason as the search path.
   *
   * Found by hunting for the shape after fixing it in search: `include` is one query per
   * relation, so each of these two was four sequential round trips — eight in total on the
   * homepage, the first page any customer sees. Reading ids and joining once is two.
   *
   * The id reads sit in the existing `Promise.all`; the card loads run as a pair afterwards.
   */
  // Which rail is live, and therefore what it may be called. Resolved before the ids, because
  // the mode decides which ids to ask for. Cached, so this is not a round trip most of the time.
  const rail = await resolveRail(db);

  const [bestIds, freshIds, reviews] = await Promise.all([
    railProductIds(db, rail, RAIL_SIZE).then((ids) => ids.map((id) => ({ id }))),
    // Over-fetched so spreadBrands() has something to backfill from: the newest 12 products
    // were all Lattafa, which made "New arrivals" read like a bug.
    db.product.findMany({ where: { status: "active" }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 120 }),
    db.review.findMany({ where: { approved: true }, orderBy: { createdAt: "desc" }, take: 6, include: { product: { select: { name: true } } } }),
  ]);
  const [best, fresh] = await Promise.all([
    loadCards(db, bestIds.map((r) => r.id)),
    loadCards(db, freshIds.map((r) => r.id)),
  ]);
  const newArrivals = spreadBrands(fresh.filter((p) => computeIsNew(p, newDays)), 8, 2);
  // Resolved server-side against real rows; null means the homepage renders no promo at
  // all. The client must not fall back to any copy of its own.
  const { promo } = await resolvePromo(db, settings);
  res.json({
    promo,
    /**
     * The rail carries its own label, so the client cannot name it independently.
     *
     * `Home.tsx` used to hardcode "Best sellers" over "Loved by everyone" — two claims about
     * customer behaviour that no code checked. Shipping the wording with the data is the same
     * fix as `promo`: the client renders what it is given and has no copy of its own.
     */
    picks: { mode: rail.mode, label: rail.label, eyebrow: rail.eyebrow, href: rail.href, products: best.map((p) => cardOf(p, newDays)) },
    // Kept so an old cached bundle does not lose the rail mid-deploy. Remove after one release.
    bestSellers: best.map((p) => cardOf(p, newDays)),
    newArrivals: (newArrivals.length ? newArrivals : spreadBrands(fresh, 8, 2)).map((p) => cardOf(p, newDays)),
    reviews: reviews.map((r) => ({ id: r.id, author: r.author, rating: r.rating, text: r.text, title: r.title, product: r.product?.name ?? "" })),
  });
}));

// product listing with filters, search, sort
app.get("/api/products", asyncH(async (req, res) => {
  const settings = await getSettings();
  const newDays = num(settings.newArrivalDays, 30);
  const q = str(req.query.q).trim();
  const where: Prisma.ProductWhereInput = { status: { in: ["active", "unavailable"] } };
  const and: Prisma.ProductWhereInput[] = [];

  // "Include temporarily unavailable" — the checkbox in the shop sidebar. Resolved once, here,
  // so the search ranking and the shelf it feeds cannot disagree about what is visible.
  const includeUnavailable = req.query.available === "0";
  const searchStatuses = includeUnavailable ? ["active", "unavailable"] : ["active"];

  // A department (Nails, Makeup…) holds no products itself — they sit in its
  // subcategories, so match the category AND its children or the department pages
  // come back empty.
  if (req.query.category) {
    const slug = str(req.query.category);
    const cat = await db.category.findUnique({ where: { slug }, select: { id: true, children: { select: { id: true } } } });
    if (!cat) return res.json({ products: [], total: 0 });
    and.push({ categoryId: { in: [cat.id, ...cat.children.map((c) => c.id)] } });
  }
  // Brand is multi-select: a filter that only allows one brand at a time is not a filter.
  // Accepts `brand=a&brand=b` or `brand=a,b`.
  const brandSlugs = [...new Set(
    ([] as string[])
      .concat(Array.isArray(req.query.brand) ? (req.query.brand as string[]) : req.query.brand ? [str(req.query.brand)] : [])
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter(Boolean),
  )];
  if (brandSlugs.length) and.push({ brand: { slug: { in: brandSlugs } } });

  if (bool(req.query.sale)) and.push({ AND: [{ saleCents: { not: null } }] });
  /**
   * `?best=1` resolves through the same rail as the homepage.
   *
   * Otherwise `/bestsellers` would list owner picks under the word "Best sellers" while the
   * homepage called the identical products "Our Picks" — one flag, two claims. In best-seller
   * mode this becomes the delivered-units list, so the page and the rail always agree.
   */
  if (bool(req.query.best)) {
    const rail = await resolveRail(db);
    const ids = await railProductIds(db, rail, 200);
    and.push({ id: { in: ids.length ? ids : [-1] } });
  }

  // Who it's for. Men's and women's product spans every department, so this is a field rather
  // than a category. "unisex" is included in both so a unisex fragrance still shows on /men.
  const audience = str(req.query.audience);
  if (audience === "men" || audience === "women") and.push({ audience: { in: [audience, "unisex"] } });
  else if (audience === "men-only" || audience === "women-only") and.push({ audience: audience.replace("-only", "") });

  // Availability. Defaults ON for shoppers — see `includeUnavailable` above.
  if (!includeUnavailable) and.push({ status: "active" });

  const priceMin = str(req.query.priceMin).trim();
  const priceMax = str(req.query.priceMax).trim();
  if (priceMin || priceMax) {
    const range: Prisma.IntFilter = {};
    if (priceMin) range.gte = toCents(priceMin);
    if (priceMax) range.lte = toCents(priceMax);
    and.push({ priceCents: range });
  }
  for (const c of list(str(req.query.concerns))) and.push({ concerns: { contains: c } });
  for (const a of list(str(req.query.attributes))) and.push({ attributes: { contains: a } });
  /**
   * Search resolves to a set of ids, which then flows through the normal filter pipeline.
   *
   * The previous version required every typed word to appear, case-sensitively, as a substring
   * of one of six columns — so "nivea" did not match "Nivea", and one wrong letter found
   * nothing. Resolving to ids first means the fuzzy matching happens once, in one place, and
   * every existing filter, sort and page still applies on top of it unchanged.
   *
   * A query that matches nothing pushes an impossible id, rather than being dropped — dropping
   * it would silently return the whole catalogue for a search that found no products, which is
   * the worst possible answer to "we don't have that".
   */
  let rank: Map<number, number> | null = null;
  if (q) {
    /**
     * The statuses the ranking is allowed to contain are the ones this request can show.
     *
     * Passing the *effective* visibility rather than a fixed pair means the ranked ids are
     * already a valid answer, which is what lets the redundant second id query be skipped
     * below. It also keeps one rule in one place: `available=0` is the customer ticking
     * "include temporarily unavailable", and search must agree with the shelf it feeds.
     */
    const hits = await searchProductIds(db, q, searchStatuses, SEARCH_RESULT_CAP);
    and.push({ id: { in: hits.length ? hits.map((h) => h.id) : [-1] } });
    // Kept, because it is the answer to "which of these did the customer most likely mean".
    // Before this, it was computed and thrown away one line later.
    rank = new Map(hits.map((h, i) => [h.id, i]));
  }
  if (and.length) where.AND = and;

  const sort = str(req.query.sort, "featured");

  /**
   * A search is sorted by relevance unless the customer asks for something else.
   *
   * This was the ranking bug, and it was invisible from the search layer: `searchProductIds`
   * ranked correctly, the handler pushed the ids into `where`, and then `orderBy` re-sorted the
   * whole set by status/best-seller/recency — discarding the ranking entirely. Searching
   * "shampo" put a **Maybelline lipstick sixth**, above dozens of actual shampoos, because it
   * happened to be a best-seller. The relevance order existed and never reached the customer.
   *
   * "Featured" is still the default for *browsing*, where there is no query to be relevant to.
   * Picking price/name/newest explicitly still overrides, because a customer who chose a sort
   * means it.
   */
  const byRelevance = rank !== null && (sort === "featured" || sort === "relevance");
  // "Featured" is now a deliberate ordering, not insertion order: anything a shopper cannot
  // buy sinks to the bottom, then best-sellers, then recency. Previously `/category/makeup`
  // had 3 unavailable items in its first 8 and `/category/nails` had 5, so a shopper's first
  // impression was a wall of things they could not order.
  //
  // `status: "asc"` puts "active" before "unavailable" and "discontinued" alphabetically,
  // which happens to be exactly the priority we want — asserted in the sort tests.
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    sort === "price-asc" ? [{ status: "asc" }, { priceCents: "asc" }]
    : sort === "price-desc" ? [{ status: "asc" }, { priceCents: "desc" }]
    : sort === "newest" ? [{ status: "asc" }, { createdAt: "desc" }]
    : sort === "name" ? [{ status: "asc" }, { name: "asc" }]
    : [{ status: "asc" }, { isBestSeller: "desc" }, { createdAt: "desc" }];

  // "New arrivals" used to be filtered in JS after the query, which can't work with
  // pagination — page 1 would drop most of its rows. Same rule as computeIsNew(),
  // expressed as SQL: always-new, or auto and created inside the window.
  if (bool(req.query.new)) {
    and.push({
      OR: [
        { isNewMode: "always" },
        { AND: [{ isNewMode: "auto" }, { createdAt: { gte: new Date(Date.now() - newDays * 864e5) } }] },
      ],
    });
    where.AND = and;
  }

  // Paginated. The catalogue is ~9.5k products, so returning everything was a 4 MB /
  // 17-second response. Callers that want more ask page by page.
  const limit = Math.min(Math.max(num(req.query.limit, 48), 1), 96);
  const page = Math.max(num(req.query.page, 1), 1);

  // Facets are computed from the same WHERE as the results, minus the facet's own filter, so
  // counts stay meaningful and zero-result options can be hidden. Previously /category/nails
  // offered all 405 brands including ones with no nail products at all.
  const facetWhere = (exclude: "brand" | "price" | "concerns" | "attributes" | "audience" | null): Prisma.ProductWhereInput => {
    const kept = and.filter((clause) => {
      if (exclude === "brand" && "brand" in clause) return false;
      if (exclude === "price" && "priceCents" in clause) return false;
      if (exclude === "concerns" && "concerns" in clause) return false;
      if (exclude === "attributes" && "attributes" in clause) return false;
      if (exclude === "audience" && "audience" in clause) return false;
      return true;
    });
    return kept.length ? { ...where, AND: kept } : { status: where.status };
  };

  const wantFacets = req.query.facets === "1";

  /**
   * Ids first, cards second — two round trips instead of five.
   *
   * `include` does not join: Prisma issues one query per relation, so `include: cardInclude`
   * cost four sequential round trips against a database in Ohio. Reading ids and then calling
   * `loadCards` (one LEFT JOIN + LATERAL) is the same data in one. Measured on the real
   * endpoint for `q=makup`: **3,067 ms before, 1,458 ms after** — and the rest of the fall
   * comes from dropping `count`.
   *
   * When sorting by relevance there is no `count` and no `skip`/`take`: the ranked set is
   * already capped at SEARCH_RESULT_CAP, so every surviving id is read at once and paging is a
   * slice of an array. That is also the only way to page a ranking Postgres cannot express in
   * an `ORDER BY` — the order lives in `rank`, not in a column.
   */
  /**
   * When nothing narrows the ranking, the ranked ids ARE the answer — don't ask again.
   *
   * A customer searching with no filters is the common case, and for it the id query was pure
   * ceremony: `searchProductIds` already filtered by the visible statuses, so re-selecting
   * `id` under the same conditions returns the identical set for a full round trip. Skipping it
   * also lets the card load move into the parallel block below, because the page is known
   * before any of it runs.
   *
   * The test is deliberately negative — *any* clause that is not the id list or a status is
   * treated as narrowing. A filter added later is therefore slow-but-correct by default, rather
   * than silently taking a shortcut that no longer holds.
   */
  const narrowing = and.filter((c) => !("id" in c) && !("status" in c)).length;
  const rankedIsAnswer = byRelevance && narrowing === 0;

  let total0 = 0;
  let preIds: number[] = [];
  if (rankedIsAnswer) {
    const ordered = [...rank!.keys()].sort((a, b) => rank!.get(a)! - rank!.get(b)!);
    total0 = ordered.length;
    preIds = ordered.slice((page - 1) * limit, page * limit);
  }

  const [countOrZero, idRows, preCards, brandFacet, priceAgg, concernRows, attributeRows, audienceRows] = await Promise.all([
    byRelevance ? Promise.resolve(0) : db.product.count({ where }),
    byRelevance
      ? (rankedIsAnswer ? Promise.resolve([]) : db.product.findMany({ where, select: { id: true } }))
      : db.product.findMany({ where, select: { id: true }, orderBy, skip: (page - 1) * limit, take: limit }),
    // Runs beside the facets rather than after them: one fewer sequential round trip on the
    // path a customer actually waits for.
    rankedIsAnswer ? loadCards(db, preIds) : Promise.resolve(null),
    wantFacets
      ? db.product.groupBy({ by: ["brandId"], where: facetWhere("brand"), _count: { _all: true }, orderBy: { _count: { brandId: "desc" } }, take: 500 })
      : Promise.resolve([]),
    wantFacets ? db.product.aggregate({ where: facetWhere("price"), _min: { priceCents: true }, _max: { priceCents: true } }) : Promise.resolve(null),
    // Tag facets. `concerns`/`attributes` are comma-joined strings, so grouping by the raw
    // column gives one row per distinct combination — a handful of rows, not 9.5k — and the
    // per-tag counts are summed from those. Exact, and cheap enough to run beside the others.
    wantFacets ? db.product.groupBy({ by: ["concerns"], where: facetWhere("concerns"), _count: { _all: true } }) : Promise.resolve([]),
    wantFacets ? db.product.groupBy({ by: ["attributes"], where: facetWhere("attributes"), _count: { _all: true } }) : Promise.resolve([]),
    // Who it's for, counted over the current selection. The filter hides itself when nothing
    // here is marked men's or women's — otherwise it is another control that leads nowhere,
    // exactly like the concerns and attributes lists were.
    wantFacets ? db.product.groupBy({ by: ["audience"], where: facetWhere("audience"), _count: { _all: true } }) : Promise.resolve([]),
  ]);

  // Relevance order is applied here, to the ids that survived every other filter — so a brand
  // or price filter narrows the ranking rather than reshuffling it.
  let products: CardRow[];
  let total: number;
  if (rankedIsAnswer) {
    total = total0;
    products = preCards!;
  } else if (byRelevance) {
    const ordered = idRows.map((r) => r.id).sort((a, b) => (rank!.get(a) ?? 1e9) - (rank!.get(b) ?? 1e9));
    total = ordered.length;
    products = await loadCards(db, ordered.slice((page - 1) * limit, page * limit));
  } else {
    total = countOrZero;
    products = await loadCards(db, idRows.map((r) => r.id));
  }

  let facets: unknown = undefined;
  if (wantFacets) {
    const ids = brandFacet.map((b) => b.brandId).filter((v): v is number => v !== null);
    const brandRows = ids.length ? await db.brand.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true, name: true } }) : [];
    const nameById = new Map(brandRows.map((b) => [b.id, b]));
    facets = {
      brands: brandFacet
        .filter((b) => b.brandId !== null && nameById.has(b.brandId))
        .map((b) => ({ ...nameById.get(b.brandId!)!, count: b._count._all }))
        .sort((a, b) => COLLATOR.compare(sortKey(a.name), sortKey(b.name))),
      price: { minCents: priceAgg?._min.priceCents ?? 0, maxCents: priceAgg?._max.priceCents ?? 0 },
      concerns: tagFacet(concernRows, "concerns"),
      attributes: tagFacet(attributeRows, "attributes"),
      audience: Object.fromEntries(audienceRows.map((r) => [r.audience || "unisex", r._count._all])) as Record<string, number>,
    };
  }

  res.json({
    products: products.map((p) => cardOf(p, newDays)),
    facets,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit,
  });
}));

// search type-ahead
app.get("/api/search", asyncH(async (req, res) => {
  const q = str(req.query.q).trim();
  if (!q) return res.json({ products: [] });
  const settings = await getSettings();
  const newDays = num(settings.newArrivalDays, 30);
  /**
   * Typo-tolerant, and the visible statuses are passed in explicitly.
   *
   * `searchProductIds` has no default for `status` — the caller must say what may be found, so
   * there is no path where a widened default quietly exposes hidden stock. Same statuses as
   * VISIBLE, which is what the rest of the storefront shows: an `unavailable` product is on the
   * shelf with a badge, and a search that could not find a product a customer can see would be
   * a different bug.
   */
  const hits = await searchProductIds(db, q, ["active", "unavailable"], 6);
  if (hits.length === 0) return res.json({ products: [] });

  /**
   * `loadCards`, not `findMany({ include })`.
   *
   * This runs on every keystroke, so it is the one place in the codebase where the difference
   * between one round trip and four is the whole feature. Median of five against Neon, six
   * cards: **696 ms via `include`, 152 ms via the join** — and 152 ms is the bare round trip
   * (174 ms), so the join itself costs nothing measurable. It was all latency, four times over.
   *
   * `loadCards` also returns rows in the order given, so relevance order survives without a
   * re-sort in the handler that a later edit could quietly drop.
   */
  const rows = await loadCards(db, hits.map((h) => h.id));

  res.json({ products: rows.map((p) => cardOf(p, newDays)) });
}));

// single product
app.get("/api/products/:slug", asyncH(async (req, res) => {
  const settings = await getSettings();
  const newDays = num(settings.newArrivalDays, 30);
  const p = await db.product.findUnique({
    where: { slug: str(req.params.slug) },
    include: {
      brand: true, category: true,
      images: { orderBy: { sortOrder: "asc" } },
      variants: { orderBy: { sortOrder: "asc" } },
      reviews: { where: { approved: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!p || p.status === "hidden" || p.status === "discontinued") return res.status(404).json({ error: "Product not found." });

  // Related: same subcategory first, then topped up from the sibling subcategories in
  // the same department — several subcategories hold only one or two products, which
  // would otherwise leave this empty.
  const related = await db.product.findMany({
    where: { status: "active", categoryId: p.categoryId, id: { not: p.id } },
    include: cardInclude, take: 4, orderBy: { isBestSeller: "desc" },
  });
  if (related.length < 4) {
    const deptId = p.category.parentId ?? p.categoryId;
    const siblings = await db.category.findMany({ where: { OR: [{ id: deptId }, { parentId: deptId }] }, select: { id: true } });
    const fill = await db.product.findMany({
      where: { status: "active", categoryId: { in: siblings.map((c) => c.id) }, id: { notIn: [p.id, ...related.map((r) => r.id)] } },
      include: cardInclude, take: 4 - related.length, orderBy: { isBestSeller: "desc" },
    });
    related.push(...fill);
  }
  const ratingAvg = p.reviews.length ? p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length : 0;
  res.json({
    id: p.id, slug: p.slug, name: p.name, status: p.status,
    priceCents: p.priceCents, saleCents: p.saleCents,
    onSale: p.saleCents != null && p.saleCents < p.priceCents,
    shortDesc: p.shortDesc, description: p.description, howToUse: p.howToUse, ingredients: p.ingredients,
    glyph: p.glyph, tint: p.tint, videoUrl: p.videoUrl,
    concerns: list(p.concerns), attributes: list(p.attributes),
    brand: p.brand ? { name: p.brand.name, slug: p.brand.slug } : null,
    category: { name: p.category.name, slug: p.category.slug },
    isBestSeller: p.isBestSeller, isNew: computeIsNew(p, newDays),
    images: p.images.map((i) => ({ url: i.url, alt: i.alt })),
    // sku is deliberately not exposed publicly — it's a supplier reference, admin-only.
    variants: p.variants.map((v) => ({ id: v.id, type: v.type, label: v.label, hex: v.hex, imageUrl: v.imageUrl, priceCents: v.priceCents, available: v.available })),
    reviews: p.reviews.map((r) => ({ id: r.id, author: r.author, rating: r.rating, title: r.title, text: r.text, createdAt: r.createdAt })),
    ratingAvg, reviewCount: p.reviews.length,
    related: related.map((r) => cardOf(r, newDays)),
  });
}));

// brands list (public)
app.get("/api/brands", asyncH(async (_req, res) => {
  const rows = await db.brand.findMany({ where: { active: true },
    include: { _count: { select: { products: { where: VISIBLE } } } } });
  // A brand with nothing visible is a card that links to an empty shelf. `featured desc` is
  // gone: the directory is alphabetical, and featuring is shown with a badge instead of by
  // jumping two brands to the front of the alphabet.
  const brands = rows
    .filter((b) => b._count.products > 0)
    .sort((a, b) => COLLATOR.compare(sortKey(a.name), sortKey(b.name)));
  res.json({ brands });
}));

// submit a review (held for approval)
app.post("/api/products/:slug/reviews", asyncH(async (req, res) => {
  const p = await db.product.findUnique({ where: { slug: str(req.params.slug) } });
  if (!p) return res.status(404).json({ error: "Product not found." });
  const author = str(req.body.author).trim();
  const text = str(req.body.text).trim();
  if (!author || !text) return res.status(400).json({ error: "Name and review are required." });
  await db.review.create({ data: {
    productId: p.id, author, text, title: str(req.body.title),
    rating: Math.min(5, Math.max(1, num(req.body.rating, 5))), approved: false,
  } });
  res.json({ ok: true, message: "Thanks! Your review will appear once approved." });
}));

// ---- promotions (coupons + gift cards) ----
// Evaluate a coupon against a subtotal. Returns discount in cents + any error.
async function evalCoupon(code: string, subtotal: number): Promise<{ coupon: Prisma.CouponGetPayload<object> | null; discount: number; error?: string }> {
  const c = code ? await db.coupon.findUnique({ where: { code: code.trim().toUpperCase() } }) : null;
  if (!code) return { coupon: null, discount: 0 };
  if (!c || !c.active) return { coupon: null, discount: 0, error: "Invalid coupon code." };
  if (c.expiresAt && c.expiresAt.getTime() < Date.now()) return { coupon: null, discount: 0, error: "This coupon has expired." };
  if (c.maxUses != null && c.usedCount >= c.maxUses) return { coupon: null, discount: 0, error: "This coupon is no longer available." };
  if (subtotal < c.minOrderCents) return { coupon: null, discount: 0, error: `Spend at least ${(c.minOrderCents / 100).toFixed(0)}$ to use this coupon.` };
  const discount = c.type === "percent" ? Math.round((subtotal * c.value) / 100) : Math.min(c.value, subtotal);
  return { coupon: c, discount };
}

app.post("/api/coupons/validate", asyncH(async (req, res) => {
  const { discount, error } = await evalCoupon(str(req.body.code), num(req.body.subtotalCents));
  if (error) return res.status(400).json({ error });
  res.json({ ok: true, discountCents: discount });
}));

app.get("/api/gift-cards/:code", asyncH(async (req, res) => {
  const g = await db.giftCard.findUnique({ where: { code: str(req.params.code).trim().toUpperCase() } });
  if (!g || !g.active || g.balanceCents <= 0) return res.status(404).json({ error: "Invalid or empty gift card." });
  res.json({ ok: true, code: g.code, balanceCents: g.balanceCents });
}));

// ---- orders ----
function orderNumber() {
  return "TG-" + randomUUID().replace(/[^0-9a-z]/gi, "").slice(0, 6).toUpperCase();
}

app.post("/api/orders", withCustomer, asyncH(async (req, res) => {
  const b = req.body ?? {};
  const customerId = (req as express.Request & { customerId?: number }).customerId;
  const items: { productId: unknown; variantId?: unknown; qty?: unknown }[] = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: "Your cart is empty." });
  const fullName = str(b.fullName).trim();
  const phone = str(b.phone).trim();
  if (!fullName || !phone) return res.status(400).json({ error: "Name and phone are required." });

  // Price server-side from the live catalogue — never trust client prices.
  const ids: number[] = [...new Set(items.map((i: { productId: unknown }) => num(i.productId)))];
  const products = await db.product.findMany({ where: { id: { in: ids } }, include: { brand: true, images: { orderBy: { sortOrder: "asc" }, take: 1 }, variants: true } });
  const byId = new Map(products.map((p) => [p.id, p]));

  const orderItems: Prisma.OrderItemUncheckedCreateWithoutOrderInput[] = [];
  let subtotal = 0;
  for (const it of items) {
    const p = byId.get(num(it.productId));
    if (!p || p.status === "discontinued" || p.status === "hidden") continue;
    const variant = p.variants.find((v) => v.id === num(it.variantId));
    const unit = variant?.priceCents ?? p.saleCents ?? p.priceCents;
    const qty = Math.max(1, num(it.qty, 1));
    subtotal += unit * qty;
    orderItems.push({
      productId: p.id, name: p.name, brandName: p.brand?.name ?? "",
      variantLabel: variant?.label ?? "", glyph: p.glyph, tint: p.tint,
      // prefer the chosen shade's own photo so the order shows the exact shade bought
      imageUrl: variant?.imageUrl || p.images[0]?.url || "", priceCents: unit, qty,
    });
  }
  if (!orderItems.length) return res.status(400).json({ error: "None of your items are available." });

  const settings = await getSettings();
  const threshold = num(settings.freeDeliveryThresholdCents, 6000);
  const areaRow = b.areaId ? await db.deliveryArea.findUnique({ where: { id: num(b.areaId) } }) : null;
  let delivery = areaRow?.feeCents ?? num(settings.defaultDeliveryCents, 300);
  if (subtotal >= threshold) delivery = 0;

  // The tier delivery perk. Two independent reasons delivery might be cheap — the global
  // threshold above, and the customer's tier — so they compose as the LOWER of the two, never
  // as a sum. `freeDeliveryReason` is what the checkout line says; a perk the customer cannot
  // see they received is invisible marketing.
  //
  // Wrapped in `safely`: if the tier lookup throws, times out or the database is slow, delivery
  // falls back to the global rule and checkout completes. A loyalty bug must never break
  // pricing, and it must certainly never lose a sale. Same rule as the earn hook.
  let freeDeliveryReason = subtotal >= threshold && delivery === 0 ? "threshold" : "";
  const perk = await safely("tier delivery perk", () =>
    tierDeliveryCents(db, { phone, whatsapp: str(b.whatsapp || b.phone), merchandiseCents: subtotal }));
  if (perk && perk.cents < delivery) {
    delivery = perk.cents;
    freeDeliveryReason = `tier:${perk.tier}`;
  }

  // A coupon's remaining uses and a gift card's balance are shared, finite resources, so both
  // are *claimed* rather than read-then-written, and the order is written in the same
  // transaction as the claim.
  //
  // Before this, checkout read the balance, computed the discount, created the order and only
  // then decremented. Two orders paying with the same $50 card at the same moment both saw
  // $50, both applied $50 and both decremented — the card ended on -$50 and the store gave
  // away twice the value. A `maxUses: 1` coupon went the same way. The window was small but
  // it is exactly the window that opens when a promotion is shared in a WhatsApp group.
  //
  // Each claim is a conditional UPDATE. Postgres re-evaluates the WHERE after waiting on the
  // row lock, so a claim that would overdraw simply matches no rows and we know to fall back —
  // no advisory locks, no SERIALIZABLE retries.
  const requestedCoupon = str(b.couponCode);
  const requestedGiftCode = str(b.giftCardCode).trim().toUpperCase();
  const { coupon } = await evalCoupon(requestedCoupon, subtotal);

  /**
   * Points the customer asked to spend.
   *
   * Zero unless they are signed in AND redemption is switched on — so while the flag is off this
   * is always zero and every line below behaves exactly as it did before. The AMOUNT is never
   * trusted from the client; it is re-quoted against the ledger inside the transaction, because
   * the cap depends on a basket the browser can change after the quote was issued.
   */
  const requestedPoints = LOYALTY_REDEMPTION_ENABLED && customerId
    ? Math.max(0, num(b.redeemPoints, 0))
    : 0;

  const loyaltyAccount = requestedPoints > 0
    ? await safely("redeem lookup", () => db.loyaltyAccount.findUnique({ where: { customerId }, select: { id: true } }))
    : null;

  /**
   * The order transaction, as a function so it can be RETRIED.
   *
   * It is raised to Serializable when points are being spent, and a Serializable transaction
   * can abort for a reason that is nobody's fault — two transactions touching the same rows in
   * an order Postgres cannot serialise. Without a retry that abort propagated straight out of
   * the handler and the customer lost the whole order. That directly contradicts the rule this
   * codebase has followed everywhere else: a loyalty failure must never cost a sale.
   *
   * `spendPoints` is a parameter rather than a closure read, because the fallback below runs
   * the exact same code with points switched off.
   */
  const placeOrder = (spendPoints: number) => db.$transaction(async (tx) => {
    let discount = 0;
    let couponCode = "";
    if (coupon) {
      // `usedCount < maxUses` is checked by the database, not by us. Unlimited coupons have no
      // ceiling to race for, so they only need the id.
      const claimed = await tx.coupon.updateMany({
        where: coupon.maxUses == null ? { id: coupon.id } : { id: coupon.id, usedCount: { lt: coupon.maxUses } },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count === 1) {
        discount = coupon.type === "percent" ? Math.round((subtotal * coupon.value) / 100) : Math.min(coupon.value, subtotal);
        couponCode = coupon.code;
      }
      // count === 0 means someone took the last use first. The order still goes through at
      // full price rather than failing — the response reports the real numbers.
    }

    /**
     * Points, applied to MERCHANDISE only and after any coupon.
     *
     * The order of the three is deliberate and it is not interchangeable:
     *
     *   coupon      a discount on the goods
     *   points      a discount on the goods, capped at a share of what is left after the coupon
     *   delivery    added
     *   gift card   a means of PAYMENT against the total, not a discount on anything
     *
     * Points come off the goods, so they cannot pay for delivery — a customer in a far
     * governorate would otherwise redeem their way out of a fee that costs the shop real money.
     * And the 50% cap is measured against the post-coupon figure, which is what the customer is
     * actually paying for the items.
     *
     * The order row does not exist yet, so the ledger entry is written after it, still inside
     * this transaction. If anything below throws, the whole thing — order, points, coupon
     * claim, gift-card debit — rolls back together.
     */
    const merchandiseAfterCoupon = Math.max(0, subtotal - discount);
    let pointsDiscount = 0;

    if (loyaltyAccount && spendPoints > 0) {
      // Quoted here so the gift card and the total see the reduced figure. The authoritative
      // write happens after the order exists, via redeemWithin, which re-quotes against the
      // same transaction snapshot — so it cannot disagree with this, and if it somehow did it
      // throws and the entire order rolls back rather than shipping a wrong price.
      const quote = await previewRedemption(tx, {
        accountId: loyaltyAccount.id,
        requestedPoints: spendPoints,
        merchandiseCents: merchandiseAfterCoupon,
        signedIn: true,
      });
      // A refusal is not an error at checkout. The customer asked to spend points and cannot —
      // the order still goes through at the real price, exactly as a spent-out coupon does.
      if (quote.ok) pointsDiscount = quote.cents;
    }

    const afterDiscount = subtotal - discount - pointsDiscount + delivery;

    // Gift card, applied last against what is left.
    let giftUsed = 0;
    let giftCardCode = "";
    if (requestedGiftCode && afterDiscount > 0) {
      const card = await tx.giftCard.findUnique({ where: { code: requestedGiftCode } });
      if (card?.active && card.balanceCents > 0) {
        // One retry: the first attempt uses the balance we read, and if that lost the race the
        // second uses the balance the winner left behind. Bounded, so it cannot spin.
        for (let attempt = 0; attempt < 2 && giftUsed === 0; attempt++) {
          const balance = attempt === 0
            ? card.balanceCents
            : (await tx.giftCard.findUnique({ where: { id: card.id }, select: { balanceCents: true } }))?.balanceCents ?? 0;
          const want = Math.min(balance, afterDiscount);
          if (want <= 0) break;
          const debited = await tx.giftCard.updateMany({
            where: { id: card.id, active: true, balanceCents: { gte: want } },
            data: { balanceCents: { decrement: want } },
          });
          if (debited.count === 1) { giftUsed = want; giftCardCode = card.code; }
        }
      }
    }

    const total = afterDiscount - giftUsed;

    const order = await tx.order.create({
      data: {
        number: orderNumber(), status: "received", customerId: customerId ?? null,
        fullName, phone, whatsapp: str(b.whatsapp || b.phone), email: str(b.email),
        area: areaRow?.name ?? str(b.area), city: str(b.city), address: str(b.address), notes: str(b.notes),
        subtotalCents: subtotal, discountCents: discount, giftCardCents: giftUsed,
        pointsDiscountCents: pointsDiscount,
        couponCode, giftCardCode,
        deliveryCents: delivery, totalCents: total, paymentMethod: "cod",
        items: { create: orderItems },
        events: { create: { status: "received", note: "Order placed" } },
      },
      include: { items: true },
    });

    // The authoritative spend, inside the same transaction as the order it pays for. It
    // re-quotes against this snapshot; if it disagrees with the figure the total was built
    // from, it throws and everything above rolls back rather than shipping a wrong price.
    let pointsSpent = 0;
    if (loyaltyAccount && pointsDiscount > 0) {
      const spent = await redeemWithin(tx, {
        accountId: loyaltyAccount.id,
        orderId: order.id,
        requestedPoints: spendPoints,
        merchandiseCents: merchandiseAfterCoupon,
        signedIn: true,
      });
      pointsSpent = spent.points;
      if (spent.cents !== pointsDiscount) {
        throw new Error(`points quote moved inside the transaction: ${pointsDiscount} then ${spent.cents}`);
      }
    }

    return { order, discount, giftUsed, total, pointsDiscount, pointsSpent };
  }, spendPoints > 0
    // SERIALIZABLE only when points are actually being spent. A balance is derived from the
    // ledger, so it cannot be claimed with a conditional UPDATE the way a gift card's balance
    // is — two checkout tabs at read-committed would both read the same balance and both spend
    // it, which is precisely how this codebase once gave away $50 twice from one card.
    //
    // Every other checkout — and ALL of them while redemption is switched off — keeps the
    // default isolation and is completely unaffected.
    // TX_OPTIONS on BOTH branches: the 5-second default was losing checkouts to Neon's latency,
    // not to contention, so the plain read-committed path needs the same headroom as the
    // serialisable one. See tx.ts.
    ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, ...TX_OPTIONS }
    : { ...TX_OPTIONS });

  /**
   * Place it, retrying a serialisation conflict, and NEVER losing the sale to one.
   *
   * Three attempts with jitter — a conflict that survives three is not a conflict, it is a
   * problem. Then one final attempt with points switched OFF, which drops to the default
   * isolation and cannot conflict for this reason at all.
   *
   * That last step is the point. The customer asked to spend points and the shop could not
   * arrange it; the order still goes through at full price, exactly as a spent-out coupon
   * already does. Losing a points entry is recoverable — an admin can credit it in ten seconds
   * from the ledger view. A lost checkout is not recoverable at all.
   *
   * Retrying re-runs the whole transaction, which is safe precisely because it rolled back:
   * the coupon claim, the gift-card debit and the ledger write are all undone together.
   */
  const attemptedWithPoints = await withSerialisationRetry(() => placeOrder(requestedPoints));

  let result: Awaited<ReturnType<typeof placeOrder>>;
  if (attemptedWithPoints.value) {
    result = attemptedWithPoints.value;
  } else if (requestedPoints > 0) {
    // Every retry conflicted. Place it at full price instead of losing it: the customer asked
    // to spend points and the shop could not arrange it, which is the same outcome as a
    // spent-out coupon and is already handled everywhere downstream. A missing points entry is
    // recoverable from the admin ledger in seconds; a lost checkout is not recoverable at all.
    console.error("[checkout] serialisation conflicts spending points; placing at full price instead:",
      (attemptedWithPoints as { lastError: unknown }).lastError);
    result = await placeOrder(0);
  } else {
    // Not a points order, so there is no cheaper thing to fall back to — surface the conflict.
    throw (attemptedWithPoints as { lastError: unknown }).lastError ?? new Error("order could not be placed");
  }

  const { order, discount, giftUsed, total, pointsDiscount, pointsSpent } = result;

  // Loyalty runs AFTER the transaction has committed, and its failure is swallowed by `safely`.
  // Both halves of that matter: inside the transaction a ledger error would roll the order back,
  // and unwrapped it would turn a points problem into a lost sale. A missing entry is recovered
  // by the sweep or by hand; an abandoned checkout is not recoverable at all.
  await safely(`earn for order ${order.number}`, () => onOrderPlaced(db, order));

  // fire-and-forget confirmation email (no-op unless SMTP configured)
  // Queued, not sent-and-forgotten. With SMTP unconfigured this used to log and drop, so
  // every confirmation the store ever meant to send was simply gone. Now it waits — and
  // expires after three days, because a confirmation arriving after the parcel is noise.
  // Wrapped: a mail failure must never affect an order that has already been placed.
  if (order.email) {
    void queueMail(db, settings, {
      to: order.email,
      subject: `Order ${order.number} received`,
      html: orderConfirmationEmail(settings.storeName ?? "TulipGlam", fullName, order.number, "$" + (total / 100).toFixed(2)),
      kind: "order-confirmation",
      dedupeKey: `order-confirmation:${order.id}`,
    }).catch(() => { /* the outbox row is the record; nothing here may break checkout */ });
  }

  res.json({ number: order.number, totalCents: total, subtotalCents: subtotal, discountCents: discount, giftCardCents: giftUsed, pointsDiscountCents: pointsDiscount, pointsSpent, deliveryCents: delivery, freeDeliveryReason, whatsappNumber: settings.whatsappNumber ?? "" });
}));

/**
 * A customer asking for something the shop does not carry.
 *
 * ── WHY IT ANSWERS WITH FIELD ERRORS, UNLIKE THE SIGNUP CAPTURE ────────────────────
 *
 * `/api/launch-signup` deliberately answers identically to everything, because telling a
 * stranger whether an address is already known turns the endpoint into an oracle for who shops
 * here. Nothing comparable is at stake in a product request: there is no existing record to
 * probe and no membership to confirm. So this behaves like an ordinary form and says which
 * field is wrong — a customer who mistyped their number and is told only "something went wrong"
 * simply leaves.
 *
 * Identity is OPTIONAL and comes from the verified token via `withCustomer`, never from the
 * body. A request that could name its own `customerId` would be a way to attach yourself to
 * somebody else's account, which is the exact mistake `getOrCreateAccount` already made once in
 * this codebase and moved 1,200 points to an attacker's login.
 */
app.post("/api/product-requests", rateLimit(LIMITS.productRequest), withCustomer, asyncH(async (req, res) => {
  const input = {
    wanted: str(req.body?.wanted),
    note: str(req.body?.note),
    phone: str(req.body?.phone),
    email: str(req.body?.email),
    source: str(req.body?.source),
    searchTerm: str(req.body?.searchTerm),
  };

  const errors = validateRequest(input);
  if (errors) return res.status(400).json({ error: "Please check the form.", errors });

  const created = await createRequest(db, {
    ...input,
    customerId: (req as express.Request & { customerId?: number }).customerId ?? null,
  });

  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, id: created.id });
}));

/**
 * The coming-soon page's email capture.
 *
 * Public, unauthenticated, and reachable WHILE THE GATE IS ON — which is the whole point, since
 * the gate is the only thing a visitor can currently see. It is allowlisted by exact path in
 * comingSoon.ts rather than by prefix, so nothing else public gets opened up alongside it.
 *
 * Always answers 200 with the same body. Not a courtesy: an endpoint that distinguishes "added"
 * from "already on the list" lets anyone with a list of addresses test which belong to this
 * store's audience. Same rule as /api/auth/forgot and registration.
 *
 * A malformed address also gets 200. The page has already checked the shape, so a bad one here
 * is either a bot or a browser that let something odd through — and telling either of them
 * precisely what was wrong helps only the bot.
 */
app.post("/api/launch-signup", rateLimit(LIMITS.launchSignup), asyncH(async (req, res) => {
  await recordSignup(db, { email: str(req.body?.email), source: str(req.body?.source) });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true });
}));

// ============================================================ LOYALTY (customer-facing)

/**
 * The signed-in customer's rewards page, in one call.
 *
 * ── OWNERSHIP ──────────────────────────────────────────────────────────────────────
 *
 * The account is found by `customerId`, taken from the verified JWT by `requireCustomer`. It is
 * NEVER found by anything the client sends. Not a phone number, not an account id, not an email.
 * There is no parameter on this route at all, which is the only version of this that cannot be
 * got wrong later: a filter you could pass is a filter someone will eventually pass.
 *
 * That rule comes from a real finding. `getOrCreateAccount` used to accept a customerId and bind
 * it to whatever phone it was handed, and 1,200 points moved to an attacker's login in a test
 * against the live database. Looking an account up by a client-supplied phone here would be the
 * same mistake with a different shape — a phone number typed into a form proves nothing about
 * who owns it, and there is no SMS provider to prove otherwise.
 *
 * ── NO ENUMERATION SURFACE ─────────────────────────────────────────────────────────
 *
 * There is deliberately no endpoint anywhere that answers "does this phone have an account", "is
 * this number registered" or "how many points does account 91 have". This route answers exactly
 * one question, about exactly one account, to the person holding that account's token. A
 * customer with no account gets the empty view — the same body a brand-new customer gets — so
 * even the existence of an account is not observable from outside.
 */
app.get("/api/loyalty/me", requireCustomer, asyncH(async (req, res) => {
  if (!LOYALTY_ENABLED) return res.status(404).json({ error: "Not found." });

  // Set before ANY response leaves this handler. It used to be set only on the populated path,
  // 26 lines below an early return, so the empty view answered with no freshness directive and a
  // weak ETag while the populated one answered no-store. That difference is itself a signal:
  // "has an account" became observable from the response headers, which is exactly what the
  // byte-identical empty body was there to prevent.
  res.setHeader("Cache-Control", "no-store");

  const customerId = (req as express.Request & { customerId?: number }).customerId!;
  let account = await db.loyaltyAccount.findUnique({ where: { customerId } });

  // ── FIRST AUTHENTICATED READ ─────────────────────────────────────────────────────
  //
  // Two things happen here, once each, and both are wrapped so neither can break the page.
  //
  // AUTO-LINK. A customer who registered before they ever ordered has no loyalty account, and
  // linking is otherwise admin-only. `autoLinkOnFirstRead` opens and links one when the phone
  // on their profile has no existing account and no delivered orders — provably nothing to
  // steal. Anything with history goes to the admin queue instead. See the note on that function
  // for why nothing more generous is safe.
  //
  // SIGN-UP BONUS. Granted lazily rather than at registration, because registration predates the
  // programme for everyone who signed up before the flag was flipped. Keyed `signup:<accountId>`
  // on a unique index, so it lands exactly once however many times this route is hit.
  //
  // The order matters: link first, then grant. A customer who registers, gets auto-linked and
  // lands on this page sees their welcome points already there, in one motion, rather than an
  // empty state that fills in on a later visit.
  if (!account) {
    const me = await db.customer.findUnique({ where: { id: customerId }, select: { phone: true } });
    if (me?.phone) {
      const linked = await safely("auto-link", () => autoLinkOnFirstRead(db, { customerId, rawPhone: me.phone }));
      if (linked?.linked) account = await db.loyaltyAccount.findUnique({ where: { customerId } });
    }
  }
  if (account) await safely("signup bonus", () => recordSignupBonus(db, account!.id));

  if (!account) return res.json(emptyView());

  const now = new Date();
  const { state } = await readAccount(db, account.id, now);

  const [entries, totalEntries] = await Promise.all([
    db.loyaltyLedgerEntry.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: "desc" },
      // Bounded at the query, not after: an account with years of history must not pull every
      // row into memory to show forty. Over-fetched because the display order is not the
      // indexable order — see HISTORY_FETCH.
      take: HISTORY_FETCH,
      select: {
        id: true, type: true, status: true, points: true, orderId: true,
        createdAt: true, confirmedAt: true, multiplierApplied: true,
        reason: true, dedupeKey: true,
      },
    }),
    // Exact, so "showing your most recent activity" is true when it is shown and absent when it
    // is not. Counting the window instead made a voided row hide the rest of the history.
    db.loyaltyLedgerEntry.count({ where: { accountId: account.id, status: { not: "void" } } }),
  ]);

  const orderIds = [...new Set(entries.map((e) => e.orderId).filter((v): v is number => v !== null))];
  const orderRows = orderIds.length
    ? await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true, status: true, deliveredAt: true } })
    : [];

  const orders = new Map(orderRows.map((o) => [o.id, { id: o.id, status: o.status, deliveredAt: o.deliveredAt }]));
  const orderNumbers = new Map(orderRows.map((o) => [o.id, o.number]));

  res.setHeader("Cache-Control", "no-store");
  res.json(buildView({
    state,
    entries: entries.map((e) => ({ ...e, multiplierApplied: e.multiplierApplied === null ? 1 : Number(e.multiplierApplied) })) as never,
    orders,
    orderNumbers,
    totalEntries,
    now,
  }));
}));

/**
 * What this customer could spend against the basket in front of them.
 *
 * POST rather than GET so the basket total does not end up in access logs and browser history,
 * and — like /api/loyalty/me — it identifies the account from the token alone. The only input is
 * how much the goods cost and how many points they want to use.
 *
 * 404 when redemption is off, not 403 and not an empty quote: while the flag is down this
 * endpoint should be indistinguishable from one that was never built. A customer poking at the
 * network tab should find nothing to look forward to, because a promise they can see is a
 * promise with a date on it.
 *
 * The answer here is ADVISORY. Checkout re-quotes inside the order transaction against a basket
 * it priced itself, because this one is computed from a number the browser supplied.
 */
app.post("/api/loyalty/redeem-preview", requireCustomer, asyncH(async (req, res) => {
  if (!LOYALTY_ENABLED || !LOYALTY_REDEMPTION_ENABLED) return res.status(404).json({ error: "Not found." });

  const customerId = (req as express.Request & { customerId?: number }).customerId!;
  const account = await db.loyaltyAccount.findUnique({ where: { customerId }, select: { id: true } });

  const merchandiseCents = parseCents(req.body?.merchandiseCents);
  if (merchandiseCents === null || merchandiseCents < 0) {
    return res.status(400).json({ error: "Basket total must be a whole number of cents." });
  }
  const requestedPoints = parseCents(req.body?.points) ?? 0;

  res.setHeader("Cache-Control", "no-store");
  if (!account) return res.json({ ok: false, reason: "no-account", detail: "", maxPoints: 0, points: 0, cents: 0 });

  const quote = await previewRedemption(db, {
    accountId: account.id,
    requestedPoints,
    merchandiseCents,
    signedIn: true,
  });
  res.json(quote.ok
    ? { ok: true, points: quote.points, cents: quote.cents, maxPoints: quote.maxPoints }
    : { ok: false, reason: quote.reason, detail: quote.detail, maxPoints: quote.maxPoints, points: 0, cents: 0 });
}));

// ============================================================ INTERNAL (shared secret)

/**
 * Make the stored ledger rows agree with what the rules already say.
 *
 *     curl -X POST https://tulipglam.com/api/internal/loyalty-sweep \
 *          -H "x-loyalty-sweep-key: $LOYALTY_SWEEP_SECRET"
 *
 * Nothing customer-facing depends on this having run — balances, tiers and expiry are all
 * derived at read time. It writes them down so admin queries, exports and a dispute a year from
 * now read rows rather than derivations. Point any uptime pinger at it; missing a day costs
 * nothing.
 *
 * ── WHY EVERY FAILURE IS A BARE 404 ────────────────────────────────────────────────
 *
 * Wrong key, missing key, feature switched off: all identical, and byte-identical to the reply
 * the coming-soon gate gives a path that does not exist (`sendGateNotFound`, one implementation,
 * shared). A 401 would confirm the endpoint is real and worth attacking. There is no message, no
 * timing difference worth measuring — the comparison hashes both sides first — and nothing to
 * distinguish a near-miss from a wild guess.
 *
 * `x-loyalty-sweep-key` is a header, not a query parameter, so the secret does not end up in
 * access logs, `Referer` headers or a browser history.
 */
app.post("/api/internal/loyalty-sweep", asyncH(async (req, res) => {
  const offered = str(req.headers["x-loyalty-sweep-key"]);
  // The secret is guaranteed non-empty when the flag is on (`assertLoyaltyConfig` refuses to
  // boot otherwise), so this cannot degrade into comparing "" with "".
  if (!LOYALTY_ENABLED || !LOYALTY_SWEEP_SECRET || !sameSecret(offered, LOYALTY_SWEEP_SECRET)) {
    return sendGateNotFound(res);
  }

  const report = await runSweep(db);
  res.setHeader("Cache-Control", "no-store");
  res.json(report);
}));

/**
 * Track an order.
 *
 * ── WHY THIS IS REDACTED ───────────────────────────────────────────────────────────
 *
 * It used to `res.json(order)` — the whole row, unauthenticated: full name, phone, WhatsApp,
 * email, street address, city, area and the customer's free-text notes, to anyone who supplied
 * an order number.
 *
 * Order numbers are `TG-` plus six hex characters, so the whole space is about 16.7 million —
 * enumerable by anything with a loop, and every hit returned a complete, sellable identity.
 * Nothing rate-limits it. The only reason this has not been harvested is that the site is behind
 * the coming-soon gate, and the gate comes down at launch.
 *
 * The legitimate use is guest order tracking: someone with no account, who has just placed an
 * order, checking where it is. That needs the STATUS, the timeline, the items and the money —
 * none of which is personal data. So the public view carries all of that and none of the rest.
 *
 * A signed-in customer looking at their OWN order gets everything, because they are the person
 * the data is about and the account page already shows it to them.
 *
 * `withCustomer` rather than `requireCustomer`: a guest must still be able to track. It attaches
 * an identity when there is one and does not refuse when there is not.
 */
app.get("/api/orders/:number", withCustomer, asyncH(async (req, res) => {
  const order = await db.order.findUnique({
    where: { number: str(req.params.number).toUpperCase() },
    include: { items: true, events: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) return res.status(404).json({ error: "No order with that number." });

  const customerId = (req as express.Request & { customerId?: number }).customerId;
  const isOwner = customerId != null && order.customerId === customerId;
  if (isOwner) return res.json(order);

  // Everything the tracking page needs to do its job, and nothing that identifies a person.
  // Deliberately an allowlist: a column added to Order later is private until somebody decides
  // otherwise, which is the same rule `/api/site` follows for settings and for the same reason.
  const {
    id, number, status, createdAt, deliveredAt,
    subtotalCents, discountCents, giftCardCents, pointsDiscountCents, deliveryCents, totalCents,
    paymentMethod, area, city, items, events,
  } = order;

  res.json({
    id, number, status, createdAt, deliveredAt,
    subtotalCents, discountCents, giftCardCents,
    // Without this the breakdown a customer sees on the tracking page does not add up: the
    // subtotal and the total differ by an amount with nothing to explain it.
    pointsDiscountCents,
    deliveryCents, totalCents,
    paymentMethod,
    // Area and city stay: they are how a customer confirms this is the right order, and they
    // are a district, not an address. Street, name, phone, WhatsApp, email and notes do not.
    area, city,
    items, events,
    // Tells the page it is looking at the reduced view, so it can say so rather than rendering
    // an empty "delivering to" block that reads like missing data.
    redacted: true,
  });
}));

// ============================================================ CUSTOMER ACCOUNTS
const publicCustomer = (c: { id: number; email: string; fullName: string; phone: string }) => ({ id: c.id, email: c.email, fullName: c.fullName, phone: c.phone });

app.post("/api/auth/register", rateLimit(LIMITS.register), asyncH(async (req, res) => {
  const email = str(req.body.email).trim().toLowerCase();
  const password = str(req.body.password);
  const fullName = str(req.body.fullName).trim();
  if (!email || !password || !fullName) return res.status(400).json({ error: "Name, email and password are required." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

  // Registering an address that already has an account used to answer with a distinct 400 and a
  // distinct message, which turns this endpoint into a free "is this person a customer here"
  // oracle for anyone with a list of email addresses. `/api/auth/forgot` already answers
  // identically either way for exactly that reason; this is the same fix.
  //
  // The person who genuinely owns the address is not left stuck: they are told to sign in or
  // reset, which is what they need to do, and both of those paths work. The person who does NOT
  // own it learns nothing — the response is the same shape and status whether or not the
  // address exists.
  const taken = await db.customer.findUnique({ where: { email } });
  if (taken) {
    return res.status(400).json({
      error: "We couldn’t create an account with those details. If you already have one, sign in or reset your password.",
    });
  }

  let customer;
  try {
    customer = await db.customer.create({ data: { email, fullName, phone: str(req.body.phone), passwordHash: await hashPassword(password) } });
  } catch (e) {
    // Two registrations racing on the same address: one wins the unique index, the other lands
    // here and must get the SAME answer as the check above, or the race becomes the oracle.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(400).json({
        error: "We couldn’t create an account with those details. If you already have one, sign in or reset your password.",
      });
    }
    throw e;
  }
  res.json({ token: signToken(customer.id), customer: publicCustomer(customer) });
}));

app.post("/api/auth/login", rateLimit(LIMITS.login), asyncH(async (req, res) => {
  const email = str(req.body.email).trim().toLowerCase();
  const customer = await db.customer.findUnique({ where: { email } });
  if (!customer || !(await checkPassword(str(req.body.password), customer.passwordHash))) return res.status(401).json({ error: "Wrong email or password." });
  res.json({ token: signToken(customer.id), customer: publicCustomer(customer) });
}));

// ---- password reset ----
// The link *is* the mechanism, so this is only offered when mail can actually be delivered —
// see `mailConfigured`. Everything else in the app degrades quietly when SMTP is absent
// because WhatsApp carries the conversation; a reset has no such fallback.
const RESET_TTL_MIN = 30;
const resetTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

app.post("/api/auth/forgot", rateLimit(LIMITS.passwordReset), asyncH(async (req, res) => {
  const settings = await getSettings();
  if (!mailConfigured(settings)) {
    return res.status(503).json({ error: "Password reset by email isn't set up yet. Message us and we'll sort it out." });
  }
  const email = str(req.body.email).trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Enter your email address." });

  const customer = await db.customer.findUnique({ where: { email } });
  // The response is identical whether or not the address is registered. Saying "no account
  // with that email" turns this endpoint into a way to test which addresses have accounts.
  if (customer) {
    const token = randomUUID() + randomUUID().replace(/-/g, "");
    // Any earlier unused ticket is retired, so the newest link is the only one that works.
    await db.passwordReset.updateMany({ where: { customerId: customer.id, usedAt: null }, data: { usedAt: new Date() } });
    await db.passwordReset.create({
      data: { customerId: customer.id, tokenHash: resetTokenHash(token), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000) },
    });
    const base = str(settings.siteUrl).trim().replace(/\/+$/, "") || `${req.protocol}://${req.get("host") ?? ""}`;
    /**
     * Through the outbox, not `sendMail` directly.
     *
     * This was the last caller still sending straight out, which meant the one message that
     * genuinely cannot be re-sent — the token inside it dies in RESET_TTL_MIN minutes — was
     * also the only one leaving no evidence it was attempted. A customer saying "I never got
     * the email" had nothing to check against.
     *
     * `queueMail` still sends immediately when SMTP is configured, so nothing gets slower; it
     * just writes the row first. No `dedupeKey`: every request mints a fresh token and retires
     * the previous one, so two requests are two genuinely different messages and collapsing
     * them would strand the customer holding the newer link.
     */
    await queueMail(db, settings, {
      to: email,
      subject: `Reset your ${settings.storeName || "TulipGlam"} password`,
      html: passwordResetEmail(settings.storeName || "TulipGlam", customer.fullName || "there",
        `${base}/reset-password?token=${encodeURIComponent(token)}`, RESET_TTL_MIN),
      kind: "password-reset",
    });
  }
  res.json({ ok: true });
}));

app.post("/api/auth/reset", rateLimit(LIMITS.passwordReset), asyncH(async (req, res) => {
  const token = str(req.body.token).trim();
  const password = str(req.body.password);
  if (!token) return res.status(400).json({ error: "This reset link is incomplete. Request a new one." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

  const row = await db.passwordReset.findUnique({ where: { tokenHash: resetTokenHash(token) }, include: { customer: true } });
  if (!row) return res.status(400).json({ error: "This reset link isn't valid. Request a new one." });
  if (row.usedAt) return res.status(400).json({ error: "This link has already been used. Request a new one." });
  if (row.expiresAt < new Date()) return res.status(400).json({ error: `This link expired after ${RESET_TTL_MIN} minutes. Request a new one.` });

  // Marking used and changing the password go together: if the update fails the ticket must
  // stay live, and if it succeeds the ticket must not be replayable.
  await db.$transaction([
    db.customer.update({ where: { id: row.customerId }, data: { passwordHash: await hashPassword(password) } }),
    db.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
  // Signed straight in — asking someone to type the password they just chose is friction with
  // no security value, since they already proved control of the mailbox.
  res.json({ token: signToken(row.customerId), customer: publicCustomer(row.customer) });
}));

app.get("/api/auth/me", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  const customer = await db.customer.findUnique({ where: { id }, include: { addresses: { orderBy: { isDefault: "desc" } } } });
  if (!customer) return res.status(404).json({ error: "Account not found." });
  res.json({ customer: publicCustomer(customer), addresses: customer.addresses });
}));

app.put("/api/auth/me", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  const customer = await db.customer.update({ where: { id }, data: { fullName: str(req.body.fullName), phone: str(req.body.phone) } });
  res.json({ customer: publicCustomer(customer) });
}));

app.get("/api/auth/orders", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  const orders = await db.order.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, include: { items: true } });
  res.json({ orders });
}));

// addresses
app.get("/api/auth/addresses", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  res.json({ addresses: await db.address.findMany({ where: { customerId: id }, orderBy: { isDefault: "desc" } }) });
}));
app.post("/api/auth/addresses", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  const b = req.body;
  if (bool(b.isDefault)) await db.address.updateMany({ where: { customerId: id }, data: { isDefault: false } });
  const a = await db.address.create({ data: { customerId: id, label: str(b.label, "Home"), fullName: str(b.fullName), phone: str(b.phone), area: str(b.area), city: str(b.city), address: str(b.address), isDefault: bool(b.isDefault) } });
  res.json({ id: a.id });
}));
app.put("/api/auth/addresses/:id", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  const a = await db.address.findFirst({ where: { id: num(req.params.id), customerId: id } });
  if (!a) return res.status(404).json({ error: "Not found." });
  const b = req.body;
  if (bool(b.isDefault)) await db.address.updateMany({ where: { customerId: id }, data: { isDefault: false } });
  await db.address.update({ where: { id: a.id }, data: { label: str(b.label), fullName: str(b.fullName), phone: str(b.phone), area: str(b.area), city: str(b.city), address: str(b.address), isDefault: bool(b.isDefault) } });
  res.json({ ok: true });
}));
app.delete("/api/auth/addresses/:id", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  await db.address.deleteMany({ where: { id: num(req.params.id), customerId: id } });
  res.json({ ok: true });
}));

// ============================================================ ADMIN
const admin = express.Router();
admin.use(requireAdmin);

// image upload (base64 data URL or raw base64)
admin.post("/upload", asyncH(async (req, res) => {
  const data = str(req.body.data);
  const m = data.match(/^data:(image\/\w+);base64,(.+)$/);
  const b64 = m ? m[2] : data;
  const ext = m ? m[1].split("/")[1].replace("jpeg", "jpg") : "jpg";
  if (!b64) return res.status(400).json({ error: "No image data." });
  const name = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(b64, "base64"));
  res.json({ url: `/uploads/${name}` });
}));

// ---- dashboard summary ----
admin.get("/summary", asyncH(async (_req, res) => {
  const [products, active, orders, pendingReviews, byStatus] = await Promise.all([
    db.product.count(), db.product.count({ where: { status: "active" } }),
    db.order.count(), db.review.count({ where: { approved: false } }),
    db.order.groupBy({ by: ["status"], _count: true }),
  ]);
  const recent = await db.order.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { items: true } });
  const revenue = await db.order.aggregate({ _sum: { totalCents: true }, where: { status: { notIn: ["cancelled", "unavailable"] } } });
  res.json({ products, active, orders, pendingReviews, revenueCents: revenue._sum.totalCents ?? 0,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])), recent });
}));

// ---- products ----
admin.get("/products", asyncH(async (req, res) => {
  const where: Prisma.ProductWhereInput = {};
  if (req.query.status) where.status = str(req.query.status);
  // `mode: "insensitive"`, because without it Prisma emits plain `LIKE` on Postgres and an
  // admin searching "nivea" would not find "Nivea". Same defect the storefront search had —
  // found by hunting for the shape after fixing it there.
  if (req.query.q) where.name = { contains: str(req.query.q), mode: "insensitive" };
  // Paginated: unpaginated this returned all ~9.7k products as a 17 MB / 15-second
  // response, which made the admin product list unusable.
  const and: Prisma.ProductWhereInput[] = [];

  if (req.query.source) and.push({ source: str(req.query.source) });
  // "none" targets products with no brand at all — what the catalogue-health link uses.
  if (req.query.brandId === "none") and.push({ brandId: null });
  else if (req.query.brandId) and.push({ brandId: num(req.query.brandId) });
  // Shopper-visible only. `status` takes a single value, so this expresses the
  // active-or-unavailable pair the catalogue-health counts use.
  if (req.query.visible === "1") and.push({ status: { in: ["active", "unavailable"] } });

  // A department holds no products directly, so filtering by one must include its
  // children — same rollup the storefront listing uses.
  if (req.query.categoryId) {
    const catId = num(req.query.categoryId);
    const cat = await db.category.findUnique({ where: { id: catId }, select: { id: true, children: { select: { id: true } } } });
    if (!cat) return res.json({ products: [], total: 0, page: 1, pages: 1, limit: 50 });
    and.push({ categoryId: { in: [cat.id, ...cat.children.map((c) => c.id)] } });
  }

  // Price range in dollars, inclusive. Compared against the base price.
  const priceMin = str(req.query.priceMin).trim();
  const priceMax = str(req.query.priceMax).trim();
  if (priceMin || priceMax) {
    const range: Prisma.IntFilter = {};
    if (priceMin) range.gte = toCents(priceMin);
    if (priceMax) range.lte = toCents(priceMax);
    and.push({ priceCents: range });
  }

  // Who it's for. `unlocked` finds rows the classifier is still allowed to change, which is
  // how you review its work: run the report, spot-check, then lock what's right.
  if (AUDIENCES.includes(str(req.query.audience))) and.push({ audience: str(req.query.audience) });
  else if (req.query.audience === "locked") and.push({ audienceLocked: true });
  else if (req.query.audience === "unlocked") and.push({ audienceLocked: false });

  if (req.query.hasImage === "1") and.push({ images: { some: {} } });
  if (req.query.hasImage === "0") and.push({ images: { none: {} } });
  if (req.query.hasVariants === "1") and.push({ variants: { some: {} } });
  if (req.query.hasVariants === "0") and.push({ variants: { none: {} } });
  // "no description" means neither field has copy — matches the catalogue-health count.
  if (req.query.hasDescription === "1") and.push({ NOT: { shortDesc: "", description: "" } });
  if (req.query.hasDescription === "0") and.push({ shortDesc: "", description: "" });

  if (and.length) where.AND = and;

  // Sorting is server-side across the whole result set — never just the current page.
  const dir: Prisma.SortOrder = str(req.query.dir) === "asc" ? "asc" : "desc";
  const SORTS: Record<string, Prisma.ProductOrderByWithRelationInput[]> = {
    name: [{ name: dir }],
    price: [{ priceCents: dir }],
    status: [{ status: dir }, { name: "asc" }],
    updated: [{ updatedAt: dir }],
    category: [{ category: { name: dir } }, { name: "asc" }],
    brand: [{ brand: { name: dir } }, { name: "asc" }],
  };
  const orderBy = SORTS[str(req.query.sort)] ?? [{ updatedAt: "desc" as const }];

  const limit = Math.min(Math.max(num(req.query.limit, 50), 1), 200);
  const page = Math.max(num(req.query.page, 1), 1);
  const [total, products] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit,
      // image count as well as the thumbnail: the delete dialog warns about what it destroys
      include: { brand: true, category: true, images: { orderBy: { sortOrder: "asc" }, take: 1 }, _count: { select: { variants: true, images: true } } } }),
  ]);
  res.json({ products, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit });
}));

// ---- bulk product actions ----
// Each takes an explicit id list. Scoped by id only — never by source, so a bulk action
// can't sweep beyond what the operator selected.
const MAX_BULK = 500;
function bulkIds(body: unknown): number[] {
  const raw = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => num(v)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_BULK);
}

admin.post("/products/bulk", asyncH(async (req, res) => {
  const ids = bulkIds(req.body);
  if (!ids.length) return res.status(400).json({ error: "Select at least one product." });
  const action = str(req.body.action);

  /**
   * Add to / remove from Our Picks.
   *
   * A bulk action rather than only the per-product checkbox, because choosing eight products out
   * of 1,178 through an editor form is the kind of chore that gets abandoned halfway — which
   * would leave a rail half-picked and the owner believing it was done.
   *
   * `isBestSeller` is the column, and the name predates this decision. It has only ever meant
   * "the owner flagged this by hand", which is exactly what a pick is; renaming it would be a
   * destructive migration for no gain. What it must NOT do is speak for customers — see
   * `picks.ts`.
   */
  if (action === "pick" || action === "unpick") {
    const r = await db.product.updateMany({ where: { id: { in: ids } }, data: { isBestSeller: action === "pick" } });
    // The rail caches its mode and contents; a pick must show up now, not in a minute.
    invalidateRail();
    return res.json({ ok: true, updated: r.count });
  }

  if (action === "status") {
    const status = str(req.body.status);
    if (!STATUS_PRODUCT.includes(status)) return res.status(400).json({ error: "Bad status." });
    const r = await db.product.updateMany({ where: { id: { in: ids } }, data: { status } });
    return res.json({ ok: true, count: r.count });
  }

  if (action === "category") {
    const categoryId = num(req.body.categoryId);
    const cat = await db.category.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!cat) return res.status(400).json({ error: "That category no longer exists." });
    const r = await db.product.updateMany({ where: { id: { in: ids } }, data: { categoryId } });
    return res.json({ ok: true, count: r.count });
  }

  if (action === "brand") {
    // "" clears the brand; otherwise the brand must exist.
    const raw = str(req.body.brandId);
    const brandId = raw ? num(raw) : null;
    if (brandId !== null) {
      const brand = await db.brand.findUnique({ where: { id: brandId }, select: { id: true } });
      if (!brand) return res.status(400).json({ error: "That brand no longer exists." });
    }
    const r = await db.product.updateMany({ where: { id: { in: ids } }, data: { brandId } });
    return res.json({ ok: true, count: r.count });
  }

  if (action === "audience") {
    const value = str(req.body.audience);
    if (!["unisex", "men", "women"].includes(value)) return res.status(400).json({ error: "Audience must be unisex, men or women." });
    // Setting it by hand locks it, so neither an importer nor the classifier can undo the
    // decision on a later run.
    const r = await db.product.updateMany({ where: { id: { in: ids } }, data: { audience: value, audienceLocked: true } });
    return res.json({ ok: true, count: r.count });
  }

  if (action === "delete") {
    // Past orders keep their name/price snapshot; only the link is dropped.
    await db.orderItem.updateMany({ where: { productId: { in: ids } }, data: { productId: null } });
    const r = await db.product.deleteMany({ where: { id: { in: ids } } });
    return res.json({ ok: true, count: r.count });
  }

  res.status(400).json({ error: "Unknown bulk action." });
}));

/**
 * Hide every product of a brand in one action, and deactivate the brand so it also leaves the
 * directory and the filters. Scoped by brandId — the only bulk path that is not id-scoped,
 * which is the point of it, so it names the brand back in the response for confirmation.
 */
admin.post("/brands/:id/hide", asyncH(async (req, res) => {
  const brandId = num(req.params.id);
  const brand = await db.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } });
  if (!brand) return res.status(404).json({ error: "Brand not found." });
  const status = str(req.body.status, "hidden");
  if (!STATUS_PRODUCT.includes(status)) return res.status(400).json({ error: "Bad status." });

  const [products] = await db.$transaction([
    db.product.updateMany({ where: { brandId }, data: { status } },),
    db.brand.update({ where: { id: brandId }, data: { active: status === "active" } }),
  ]);
  res.json({ ok: true, brand: brand.name, count: products.count, status });
}));

admin.get("/products/:id", asyncH(async (req, res) => {
  const p = await db.product.findUnique({ where: { id: num(req.params.id) },
    include: { images: { orderBy: { sortOrder: "asc" } }, variants: { orderBy: { sortOrder: "asc" } } } });
  if (!p) return res.status(404).json({ error: "Not found." });
  res.json(p);
}));

function productData(b: Record<string, unknown>): Prisma.ProductUncheckedCreateInput {
  const price = toCents(b.price);
  const sale = b.sale === "" || b.sale == null ? null : toCents(b.sale);
  return {
    name: str(b.name).trim(),
    slug: str(b.slug).trim() || slugify(str(b.name), randomUUID().slice(0, 4)),
    sku: str(b.sku).trim(),
    status: STATUS_PRODUCT.includes(str(b.status)) ? str(b.status) : "active",
    priceCents: price, saleCents: sale && sale < price ? sale : null,
    shortDesc: str(b.shortDesc), description: str(b.description), howToUse: str(b.howToUse), ingredients: str(b.ingredients),
    glyph: str(b.glyph, "bottle"), tint: str(b.tint, "#f5e9f0"),
    isBestSeller: bool(b.isBestSeller), isNewMode: ["auto", "always", "never"].includes(str(b.isNewMode)) ? str(b.isNewMode) : "auto",
    concerns: Array.isArray(b.concerns) ? b.concerns.join(",") : str(b.concerns),
    attributes: Array.isArray(b.attributes) ? b.attributes.join(",") : str(b.attributes),
    audience: AUDIENCES.includes(str(b.audience)) ? str(b.audience) : "unisex",
    categoryId: num(b.categoryId), brandId: b.brandId ? num(b.brandId) : null, videoUrl: str(b.videoUrl),
  };
}
const STATUS_PRODUCT = ["active", "hidden", "unavailable", "discontinued"];

type VariantIn = { type?: string; label?: string; sku?: string; hex?: string; imageUrl?: string; priceCents?: unknown; available?: unknown };
type ImageIn = { url?: string; alt?: string };
async function syncChildren(productId: number, b: Record<string, unknown>) {
  if (Array.isArray(b.variants)) {
    await db.productVariant.deleteMany({ where: { productId } });
    // sku + imageUrl must be carried through: variants are delete-and-recreate, so
    // dropping them here would silently wipe every shade photo and supplier code.
    await db.productVariant.createMany({ data: (b.variants as VariantIn[]).filter((v) => str(v.label).trim()).map((v, i) => ({
      productId, type: v.type === "size" ? "size" : "shade", label: str(v.label).trim(),
      sku: str(v.sku), hex: str(v.hex), imageUrl: str(v.imageUrl),
      priceCents: v.priceCents ? toCents(v.priceCents) : null, available: v.available === undefined ? true : bool(v.available), sortOrder: i,
    })) });
  }
  if (Array.isArray(b.images)) {
    await db.productImage.deleteMany({ where: { productId } });
    await db.productImage.createMany({ data: (b.images as ImageIn[]).filter((i) => str(i.url).trim()).map((im, i) => ({
      productId, url: str(im.url), alt: str(im.alt), sortOrder: i,
    })) });
  }
}

admin.post("/products", asyncH(async (req, res) => {
  const b = req.body ?? {};
  if (!str(b.name).trim() || !num(b.categoryId)) return res.status(400).json({ error: "Name and category are required." });
  const data = productData(b);
  // Same rule as the update path: only an explicit non-default choice locks it.
  const p = await db.product.create({ data: { ...data, audienceLocked: data.audience !== "unisex" } });
  await syncChildren(p.id, b);
  res.json({ id: p.id });
}));

admin.put("/products/:id", asyncH(async (req, res) => {
  const id = num(req.params.id);
  const b = req.body ?? {};
  // slug is handled separately below, so drop the generated one
  const { slug: _generatedSlug, ...data } = productData(b);

  // `audienceLocked` marks a human decision, and only a human *changing* the value counts as
  // one. Locking on every save would mean opening a product, fixing a typo and saving would
  // silently pin its audience to "unisex" forever, which is how the classifier ends up unable
  // to touch anything anyone has ever edited.
  const before = await db.product.findUnique({ where: { id }, select: { audience: true, audienceLocked: true } });
  const audienceLocked = (before?.audienceLocked ?? false) || (before != null && data.audience !== before.audience);

  await db.product.update({
    where: { id },
    data: { ...data, audienceLocked, ...(str(b.slug).trim() ? { slug: str(b.slug).trim() } : {}) },
  });
  await syncChildren(id, b);
  res.json({ ok: true });
}));

admin.delete("/products/:id", asyncH(async (req, res) => {
  const id = num(req.params.id);
  // Unlink first so past orders keep their price/name snapshot and the delete can't trip
  // a foreign key. Matches the bulk path.
  await db.orderItem.updateMany({ where: { productId: id }, data: { productId: null } });
  await db.product.delete({ where: { id } });
  res.json({ ok: true });
}));

// quick status toggle
admin.patch("/products/:id/status", asyncH(async (req, res) => {
  const status = str(req.body.status);
  if (!STATUS_PRODUCT.includes(status)) return res.status(400).json({ error: "Bad status." });
  await db.product.update({ where: { id: num(req.params.id) }, data: { status } });
  res.json({ ok: true });
}));

// ---- categories ----
admin.get("/categories", asyncH(async (_req, res) => {
  res.json({ categories: await db.category.findMany({ orderBy: { sortOrder: "asc" },
    include: { _count: { select: { products: true } } } }) });
}));
admin.post("/categories", asyncH(async (req, res) => {
  const b = req.body;
  const row = await db.category.create({ data: {
    name: str(b.name).trim(), slug: str(b.slug).trim() || slugify(str(b.name)),
    blurb: str(b.blurb), glyph: str(b.glyph, "jar"), tint: str(b.tint, "#f5e9f0"),
    sortOrder: num(b.sortOrder), active: b.active === undefined ? true : bool(b.active),
    parentId: b.parentId ? num(b.parentId) : null,
  } });
  res.json({ id: row.id });
}));
admin.put("/categories/:id", asyncH(async (req, res) => {
  const b = req.body;
  await db.category.update({ where: { id: num(req.params.id) }, data: {
    name: str(b.name).trim(), blurb: str(b.blurb), glyph: str(b.glyph), tint: str(b.tint),
    sortOrder: num(b.sortOrder), active: bool(b.active), parentId: b.parentId ? num(b.parentId) : null,
    ...(str(b.slug).trim() ? { slug: str(b.slug).trim() } : {}),
  } });
  res.json({ ok: true });
}));
admin.delete("/categories/:id", asyncH(async (req, res) => {
  const count = await db.product.count({ where: { categoryId: num(req.params.id) } });
  if (count) return res.status(400).json({ error: `Move or delete ${count} product(s) first.` });
  await db.category.delete({ where: { id: num(req.params.id) } });
  res.json({ ok: true });
}));

// ---- brands ----
admin.get("/brands", asyncH(async (_req, res) => {
  res.json({ brands: await db.brand.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { products: true } } } }) });
}));
admin.post("/brands", asyncH(async (req, res) => {
  const b = req.body;
  const row = await db.brand.create({ data: {
    name: str(b.name).trim(), slug: str(b.slug).trim() || slugify(str(b.name)),
    blurb: str(b.blurb), featured: bool(b.featured), sortOrder: num(b.sortOrder), active: b.active === undefined ? true : bool(b.active),
    audience: brandAudience(b.audience),
  } });
  res.json({ id: row.id });
}));
/** "" means the owner hasn't said, which is different from "unisex" — don't collapse them. */
const brandAudience = (v: unknown) => (AUDIENCES.includes(str(v)) ? str(v) : "");
admin.put("/brands/:id", asyncH(async (req, res) => {
  const b = req.body;
  await db.brand.update({ where: { id: num(req.params.id) }, data: {
    name: str(b.name).trim(), blurb: str(b.blurb), featured: bool(b.featured), sortOrder: num(b.sortOrder), active: bool(b.active),
    audience: brandAudience(b.audience),
    ...(str(b.slug).trim() ? { slug: str(b.slug).trim() } : {}),
  } });
  res.json({ ok: true });
}));
admin.delete("/brands/:id", asyncH(async (req, res) => {
  await db.product.updateMany({ where: { brandId: num(req.params.id) }, data: { brandId: null } });
  await db.brand.delete({ where: { id: num(req.params.id) } });
  res.json({ ok: true });
}));

// ---- orders ----
admin.get("/orders", asyncH(async (req, res) => {
  const where: Prisma.OrderWhereInput = {};
  if (req.query.status) where.status = str(req.query.status);
  // Case-insensitive: an order for "Ahmad" must be findable by typing "ahmad" at the door.
  if (req.query.q) where.OR = [
    { number: { contains: str(req.query.q), mode: "insensitive" } },
    { fullName: { contains: str(req.query.q), mode: "insensitive" } },
    { phone: { contains: str(req.query.q) } }, // digits — case does not apply
  ];
  const limit = Math.min(Math.max(num(req.query.limit, 50), 1), 200);
  const page = Math.max(num(req.query.page, 1), 1);
  const [total, orders] = await Promise.all([
    db.order.count({ where }),
    db.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { items: true } }),
  ]);
  res.json({ orders, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit });
}));

admin.get("/orders/:id", asyncH(async (req, res) => {
  const order = await db.order.findUnique({ where: { id: num(req.params.id) }, include: { items: true, events: { orderBy: { createdAt: "asc" } } } });
  if (!order) return res.status(404).json({ error: "Not found." });
  const settings = await getSettings();
  const area = order.area ? await db.deliveryArea.findFirst({ where: { name: order.area }, select: { name: true, feeCents: true } }) : null;
  res.json({
    ...order,
    // context the admin needs to explain the money, rather than recomputing it client-side
    context: {
      freeDeliveryThresholdCents: num(settings.freeDeliveryThresholdCents, 6000),
      defaultDeliveryCents: num(settings.defaultDeliveryCents, 300),
      areaFeeCents: area?.feeCents ?? null,
      freeDeliveryApplied: order.deliveryCents === 0 && order.subtotalCents >= num(settings.freeDeliveryThresholdCents, 6000),
      whatsappConfigured: !validateSettingsField("whatsappNumber", settings.whatsappNumber ?? ""),
    },
    nextStatuses: nextStatuses(order.status),
  });
}));

/** Single-field settings check, for places that only care about one key. */
function validateSettingsField(key: string, value: string): string | null {
  const errs = validateSettings({ [key]: value });
  return errs[key] ?? (value.trim() ? null : "Not set.");
}

admin.put("/orders/:id/status", asyncH(async (req, res) => {
  const status = str(req.body.status);
  const note = str(req.body.note);
  if (!STATUS_KEYS.includes(status as (typeof STATUS_KEYS)[number])) return res.status(400).json({ error: "Bad status." });

  const current = await db.order.findUnique({ where: { id: num(req.params.id) }, select: { status: true } });
  if (!current) return res.status(404).json({ error: "Not found." });

  // Enforced here, not just offered in the UI: an order must not skip the sourcing
  // workflow or climb back out of a terminal state.
  if (!canTransition(current.status, status)) {
    const allowed = nextStatuses(current.status);
    return res.status(400).json({
      error: allowed.length
        ? `Cannot move from “${statusMeta(current.status).label}” to “${statusMeta(status).label}”. Allowed next: ${allowed.map((k) => statusMeta(k).label).join(", ")}.`
        : `“${statusMeta(current.status).label}” is a final status — this order cannot change again.`,
    });
  }

  // Leaving awaiting_customer clears the blocked-item record.
  const clearAwaiting = current.status === "awaiting_customer" && status !== "awaiting_customer";
  const order = await db.order.update({
    where: { id: num(req.params.id) },
    data: {
      status,
      ...(clearAwaiting ? { awaitingItemId: null, awaitingNote: "", awaitingSince: null } : {}),
      events: { create: { status, note } },
    },
  });
  // Stamps deliveredAt on delivery, voids the pending earn and refunds points on a terminal
  // status. Swallowed on failure — an admin must never be blocked from moving an order because
  // the ledger is unhappy.
  await safely(`status hook for order ${order.number}`, () => onOrderStatusChanged(db, { orderId: order.id, to: status }));

  // A delivery can be the one that tips the rail from "Our Picks" to "Best Sellers", so the
  // cached decision is dropped here rather than waiting out its TTL.
  if (status === "delivered" || status === "completed") invalidateRail();

  if (order.email) {
    const settings = await getSettings();
    void queueMail(db, settings, {
      to: order.email,
      subject: `Order ${order.number}: ${statusMeta(status).label}`,
      html: statusUpdateEmail(settings.storeName ?? "TulipGlam", order.fullName, order.number, statusMeta(status).label, note),
      kind: "status-update",
      // One per (order, status): a re-saved status must not mail the customer twice.
      dedupeKey: `status:${order.id}:${status}`,
    }).catch(() => {});
  }
  res.json({ ok: true, status: order.status });
}));

// Flag a line we could not source and move the order into awaiting_customer.
admin.post("/orders/:id/awaiting", asyncH(async (req, res) => {
  const id = num(req.params.id);
  const itemId = num(req.body.itemId);
  const note = str(req.body.note).trim();
  const order = await db.order.findUnique({ where: { id }, select: { status: true, items: { select: { id: true } }, email: true, number: true, fullName: true } });
  if (!order) return res.status(404).json({ error: "Not found." });
  if (!order.items.some((i) => i.id === itemId)) return res.status(400).json({ error: "That item is not on this order." });
  if (!canTransition(order.status, "awaiting_customer")) {
    return res.status(400).json({ error: `Cannot ask the customer from “${statusMeta(order.status).label}”.` });
  }
  if (!note) return res.status(400).json({ error: "Say what you asked the customer — it is shown on the order." });

  await db.order.update({
    where: { id },
    data: {
      status: "awaiting_customer",
      awaitingItemId: itemId, awaitingNote: note, awaitingSince: new Date(),
      events: { create: { status: "awaiting_customer", note } },
    },
  });
  res.json({ ok: true });
}));

// One-click resolutions for awaiting_customer.
//   accept  — customer took a substitute: nothing to recost, back to confirmed
//   remove  — drop the line and recompute every figure server-side
//   cancel  — customer walked away
admin.post("/orders/:id/resolve", asyncH(async (req, res) => {
  const id = num(req.params.id);
  const action = str(req.body.action);
  const note = str(req.body.note).trim();
  const order = await db.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) return res.status(404).json({ error: "Not found." });
  if (order.status !== "awaiting_customer") return res.status(400).json({ error: "This order is not awaiting the customer." });

  const clear = { awaitingItemId: null, awaitingNote: "", awaitingSince: null };

  if (action === "accept") {
    await db.order.update({ where: { id }, data: { status: "confirmed", ...clear,
      events: { create: { status: "confirmed", note: note || "Customer accepted a substitute." } } } });
    return res.json({ ok: true });
  }

  if (action === "cancel") {
    await db.order.update({ where: { id }, data: { status: "cancelled", ...clear,
      events: { create: { status: "cancelled", note: note || "Customer cancelled after an item could not be sourced." } } } });
    await safely(`cancel hook for order ${id}`, () => onOrderStatusChanged(db, { orderId: id, to: "cancelled" }));
    return res.json({ ok: true });
  }

  if (action === "remove") {
    const itemId = order.awaitingItemId;
    const item = order.items.find((i) => i.id === itemId);
    if (!item) return res.status(400).json({ error: "No blocked item is recorded on this order." });
    if (order.items.length === 1) return res.status(400).json({ error: "That is the only item — cancel the order instead." });

    // Recomputed here, on the server, from the surviving lines. The client sends no money.
    const remaining = order.items.filter((i) => i.id !== itemId);
    const subtotal = remaining.reduce((sum, i) => sum + i.priceCents * i.qty, 0);

    const settings = await getSettings();
    const threshold = num(settings.freeDeliveryThresholdCents, 6000);
    const area = order.area ? await db.deliveryArea.findFirst({ where: { name: order.area }, select: { feeCents: true } }) : null;
    let delivery = area?.feeCents ?? num(settings.defaultDeliveryCents, 300);
    if (subtotal >= threshold) delivery = 0;

    // Re-evaluate the stored coupon against the smaller subtotal — it may no longer qualify.
    const { discount } = await evalCoupon(order.couponCode, subtotal);

    /**
     * The tier free-delivery perk, re-applied.
     *
     * This block recomputes delivery from the store-wide threshold only, so removing an item
     * used to silently re-charge a Bloom or Bouquet customer the delivery fee their tier had
     * already earned them. Lower of the two, same as checkout.
     */
    const perk = await safely("tier delivery perk (resolve)", () =>
      tierDeliveryCents(db, { phone: order.phone, whatsapp: order.whatsapp, merchandiseCents: subtotal }));
    if (perk && perk.cents < delivery) delivery = perk.cents;

    /**
     * POINTS ALREADY SPENT STAY SPENT.
     *
     * This recompute wrote subtotal, discount, delivery, gift card and total — and NOT
     * pointsDiscountCents. The row kept the old value while the total silently stopped
     * subtracting it, so a customer who had spent 300 points on an order would have been asked
     * for those $9 back at the door, with the ledger still showing the points as gone.
     *
     * The ledger entry already exists and the customer already paid for it with their balance,
     * so the discount is carried through untouched. It is capped at what is left of the goods
     * only so the order cannot go negative — see the note in the morning document about the
     * case where removing an item leaves less merchandise than the points already covered.
     */
    const pointsDiscount = Math.min(order.pointsDiscountCents, Math.max(0, subtotal - discount));
    const afterDiscount = subtotal - discount - pointsDiscount + delivery;
    const giftUsed = Math.min(order.giftCardCents, Math.max(0, afterDiscount));
    const total = afterDiscount - giftUsed;

    /**
     * THE GIFT CARD GETS THE DIFFERENCE BACK.
     *
     * The card was debited at checkout for the ORIGINAL total. Lowering `giftCardCents` on the
     * order without touching the card left the gap stranded: a card debited $20 for an order
     * that now only needs $12 kept $12 of order credit and $8 of nothing — money taken from the
     * customer's card, applied to no order, recorded nowhere. The card's balance is the only
     * ledger it has, so not writing it back is not "a manual decision", it is a silent loss.
     *
     * An increment, not a recomputed balance: the card may have been spent on another order in
     * between, and we are returning our own debit, not asserting what the balance should be.
     * `updateMany` so a deleted or renamed card is a no-op instead of an exception that would
     * roll back the removal the customer is waiting on.
     */
    const giftRefund = Math.max(0, order.giftCardCents - giftUsed);
    const giftRefundOps = giftRefund > 0 && order.giftCardCode
      ? [db.giftCard.updateMany({ where: { code: order.giftCardCode }, data: { balanceCents: { increment: giftRefund } } })]
      : [];

    await db.$transaction([
      ...giftRefundOps,
      db.orderItem.delete({ where: { id: item.id } }),
      db.order.update({
        where: { id },
        data: {
          status: "confirmed", ...clear,
          subtotalCents: subtotal, discountCents: discount, giftCardCents: giftUsed,
          pointsDiscountCents: pointsDiscount,
          deliveryCents: delivery, totalCents: total,
          events: {
            create: {
              status: "confirmed",
              // The refund is appended to whatever the operator wrote, never instead of it —
              // a balance moving with no line explaining it is how the last one went unnoticed.
              note: (note || `Removed “${item.name}” at the customer's request. Total recalculated.`)
                + (giftRefund > 0 ? ` Returned $${(giftRefund / 100).toFixed(2)} to gift card ${order.giftCardCode}.` : ""),
            },
          },
        },
      }),
    ]);
    // The basket shrank, so the pending earn is now for goods the customer is not getting.
    // Re-priced from the same figure the money was recomputed from, not from a second sum.
    await safely(`reprice earn for order ${id}`, () =>
      repricePendingEarn(db, id, merchandiseCentsOf({ subtotalCents: subtotal, discountCents: discount, pointsDiscountCents: pointsDiscount })));
    return res.json({ ok: true });
  }

  res.status(400).json({ error: "Unknown resolution." });
}));

// ---- reviews moderation ----
admin.get("/reviews", asyncH(async (req, res) => {
  const where = req.query.pending ? { approved: false } : {};
  res.json({ reviews: await db.review.findMany({ where, orderBy: { createdAt: "desc" }, include: { product: { select: { name: true, slug: true } } } }) });
}));
admin.patch("/reviews/:id", asyncH(async (req, res) => {
  await db.review.update({ where: { id: num(req.params.id) }, data: { approved: bool(req.body.approved) } });
  res.json({ ok: true });
}));
admin.delete("/reviews/:id", asyncH(async (req, res) => {
  await db.review.delete({ where: { id: num(req.params.id) } });
  res.json({ ok: true });
}));

// ---- setup audit ----
// What stands between this store and being safe to promote. Drives the Dashboard banner.
admin.get("/setup", asyncH(async (_req, res) => {
  const settings = await getSettings();
  const { promo, reason } = await resolvePromo(db, settings);
  const promoWanted = (settings.promoActive ?? "").trim().toLowerCase() === "true";
  res.json({
    checks: setupChecks({
      settings,
      adminKeyIsDefault: ADMIN_KEY === DEV_ADMIN_KEY,
      promoActiveButUnresolved: promoWanted && !promo,
      promoUnresolvedReason: reason,
    }),
    // never echo the key itself, only whether it is still the shipped default
    adminKeyIsDefault: ADMIN_KEY === DEV_ADMIN_KEY,
  });
}));

// ---- catalogue health ----
// Counts of products that would embarrass the store if a customer landed on them.
admin.get("/catalogue-health", asyncH(async (_req, res) => {
  const visible: Prisma.ProductWhereInput = { status: { in: ["active", "unavailable"] } };
  const [total, noImage, noBrand, noPrice, noDescription, hidden, bySource] = await Promise.all([
    db.product.count(),
    db.product.count({ where: { AND: [visible, { images: { none: {} } }] } }),
    db.product.count({ where: { AND: [visible, { brandId: null }] } }),
    db.product.count({ where: { AND: [visible, { priceCents: { lte: 0 } }] } }),
    db.product.count({ where: { AND: [visible, { shortDesc: "", description: "" }] } }),
    db.product.count({ where: { status: "hidden" } }),
    db.product.groupBy({ by: ["source"], _count: { _all: true }, _max: { createdAt: true } }),
  ]);
  res.json({
    total,
    // Each filter reproduces exactly the query behind its count, so clicking through lands
    // on the same set of rows the number describes.
    issues: [
      { key: "noImage", label: "Visible with no image", count: noImage, filter: "visible=1&hasImage=0" },
      { key: "noBrand", label: "Visible with no brand", count: noBrand, filter: "visible=1&brandId=none" },
      { key: "noPrice", label: "Visible with no price", count: noPrice, filter: "visible=1&priceMax=0" },
      { key: "noDescription", label: "Visible with no description", count: noDescription, filter: "visible=1&hasDescription=0" },
      { key: "hidden", label: "Hidden — needs a decision", count: hidden, filter: "status=hidden" },
    ],
    // "recent imports" derived from Product.source rather than an import log table
    imports: bySource
      .map((s) => ({ source: s.source || "manual", count: s._count._all, lastAt: s._max.createdAt }))
      .sort((a, b) => b.count - a.count),
  });
}));

// ---- settings + delivery areas ----
admin.get("/settings", asyncH(async (_req, res) => {
  res.json({ settings: await getSettings(), areas: await db.deliveryArea.findMany({ orderBy: { sortOrder: "asc" } }) });
}));
admin.put("/settings", asyncH(async (req, res) => {
  const patch = (req.body?.settings ?? {}) as Record<string, unknown>;
  // Reject placeholders and malformed values before anything is persisted, so a bad
  // WhatsApp number can never reach the storefront. All-or-nothing: one bad field
  // blocks the whole save rather than half-applying it.
  // Stored values are passed too, so cross-field rules still work when only one side of a
  // pair is being edited — changing the delivery threshold alone must not leave the
  // announcement quoting the old figure.
  const errors = validateSettings(patch, await getSettings());
  if (Object.keys(errors).length) return res.status(400).json({ error: "Some settings need fixing.", errors });
  for (const [key, value] of Object.entries(patch)) {
    await db.setting.upsert({ where: { key }, update: { value: str(value) }, create: { key, value: str(value) } });
  }
  // Before the response, so the admin's next read cannot race their own save.
  invalidateSettings();
  res.json({ ok: true });
}));
admin.put("/delivery-areas", asyncH(async (req, res) => {
  const areas = Array.isArray(req.body?.areas) ? req.body.areas : [];
  for (const [i, a] of areas.entries()) {
    if (a.id) await db.deliveryArea.update({ where: { id: num(a.id) }, data: { name: str(a.name), feeCents: toCents(a.fee ?? a.feeCents / 100), active: bool(a.active), sortOrder: i } });
    else await db.deliveryArea.create({ data: { name: str(a.name), feeCents: toCents(a.fee), active: true, sortOrder: i } });
  }
  res.json({ ok: true });
}));

// ---- coupons ----
admin.get("/coupons", asyncH(async (_req, res) => {
  res.json({ coupons: await db.coupon.findMany({ orderBy: { createdAt: "desc" } }) });
}));
admin.post("/coupons", asyncH(async (req, res) => {
  const b = req.body;
  const code = str(b.code).trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Code is required." });
  if (await db.coupon.findUnique({ where: { code } })) return res.status(400).json({ error: "That code already exists." });
  const row = await db.coupon.create({ data: {
    code, type: b.type === "fixed" ? "fixed" : "percent",
    value: b.type === "fixed" ? toCents(b.value) : num(b.value),
    minOrderCents: toCents(b.minOrder), maxUses: b.maxUses ? num(b.maxUses) : null,
    expiresAt: b.expiresAt ? new Date(str(b.expiresAt)) : null, active: b.active === undefined ? true : bool(b.active),
  } });
  res.json({ id: row.id });
}));
admin.put("/coupons/:id", asyncH(async (req, res) => {
  const b = req.body;
  await db.coupon.update({ where: { id: num(req.params.id) }, data: {
    type: b.type === "fixed" ? "fixed" : "percent",
    value: b.type === "fixed" ? toCents(b.value) : num(b.value),
    minOrderCents: toCents(b.minOrder), maxUses: b.maxUses ? num(b.maxUses) : null,
    expiresAt: b.expiresAt ? new Date(str(b.expiresAt)) : null, active: bool(b.active),
  } });
  res.json({ ok: true });
}));
admin.delete("/coupons/:id", asyncH(async (req, res) => { await db.coupon.delete({ where: { id: num(req.params.id) } }); res.json({ ok: true }); }));

// ---- gift cards ----
function giftCode() { return "TG-GIFT-" + randomUUID().replace(/[^0-9a-z]/gi, "").slice(0, 6).toUpperCase(); }
admin.get("/gift-cards", asyncH(async (_req, res) => {
  res.json({ giftCards: await db.giftCard.findMany({ orderBy: { createdAt: "desc" } }) });
}));
admin.post("/gift-cards", asyncH(async (req, res) => {
  const b = req.body;
  const amount = toCents(b.amount);
  if (amount <= 0) return res.status(400).json({ error: "Enter an amount." });
  const row = await db.giftCard.create({ data: {
    code: str(b.code).trim().toUpperCase() || giftCode(), initialCents: amount, balanceCents: amount,
    recipientName: str(b.recipientName), senderName: str(b.senderName), message: str(b.message), active: true,
  } });
  res.json({ id: row.id, code: row.code });
}));
admin.put("/gift-cards/:id", asyncH(async (req, res) => {
  const b = req.body;
  await db.giftCard.update({ where: { id: num(req.params.id) }, data: {
    balanceCents: b.balance != null ? toCents(b.balance) : undefined, active: bool(b.active),
    recipientName: str(b.recipientName), senderName: str(b.senderName), message: str(b.message),
  } });
  res.json({ ok: true });
}));
admin.delete("/gift-cards/:id", asyncH(async (req, res) => { await db.giftCard.delete({ where: { id: num(req.params.id) } }); res.json({ ok: true }); }));

// ---- what is happening ----

admin.get("/pulse", asyncH(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await pulse(db));
}));

admin.get("/errors", asyncH(async (_req, res) => {
  res.json({ errors: await recentErrors(db) });
}));

/** Mark one as dealt with. A recurrence re-opens it automatically — see recordError. */
admin.post("/errors/:id/resolve", asyncH(async (req, res) => {
  await resolveError(db, num(req.params.id));
  res.json({ ok: true });
}));

// ---- email outbox ----
//
// SMTP is unconfigured. Everything the store intends to send is recorded rather than dropped,
// so the day credentials are pasted in there is a backlog to flush rather than a silent gap.

admin.get("/outbox", asyncH(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await outboxStatus(db, await getSettings()));
}));

/** Send what is waiting. No-op, and says so, while SMTP is unconfigured. */
admin.post("/outbox/flush", asyncH(async (_req, res) => {
  res.json(await flushOutbox(db, await getSettings()));
}));

// ---- dispatch ----
//
// What a delivery driver needs to know at the door. See dispatch.ts for why this exists at all:
// there is no courier integration, and the only place an order total currently reaches a human
// is a WhatsApp message the customer composes. That is the last thing standing between
// redemption and going live.

admin.get("/dispatch", asyncH(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await manifest(db));
}));

/**
 * What is actually in the till, after the round.
 *
 * `?since=` is an ISO timestamp; it defaults to the start of today in the server's zone, which
 * is the question being asked ninety-nine times out of a hundred. This is deliberately a
 * separate call from the manifest: one is a forecast made in the morning and the other is a
 * count made in the evening, and conflating them is how a refused parcel starts reading as
 * missing money.
 */
admin.get("/dispatch/reconcile", asyncH(async (req, res) => {
  const raw = str(req.query.since).trim();
  const parsed = raw ? new Date(raw) : null;
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const since = parsed && !Number.isNaN(parsed.getTime()) ? parsed : startOfToday;
  res.setHeader("Cache-Control", "no-store");
  res.json(await reconcile(db, since));
}));

admin.get("/dispatch/:id", asyncH(async (req, res) => {
  const line = await dispatchLine(db, num(req.params.id));
  if (!line) return res.status(404).json({ error: "No such order." });
  res.setHeader("Cache-Control", "no-store");
  res.json({ ...line, courierMessage: courierMessage(line) });
}));

// ---- product requests ----
//
// What customers asked for and we do not carry. The most valuable list in the admin for a shop
// that holds no inventory: it is the catalogue's gaps, written by the people who wanted them.

admin.get("/product-requests", asyncH(async (req, res) => {
  const status = str(req.query.status);
  const where = status && status !== "all" ? { status } : {};
  const [requests, summary] = await Promise.all([
    db.productRequest.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
      include: { customer: { select: { id: true, fullName: true, email: true } } },
    }),
    requestSummary(db),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({ requests, summary });
}));

/**
 * Move a request along, or annotate it.
 *
 * `handledAt` is stamped the first time it leaves `open` and never cleared, so "how long did
 * people wait" stays answerable even if the status is changed again afterwards.
 */
admin.patch("/product-requests/:id", asyncH(async (req, res) => {
  const id = num(req.params.id);
  const status = str(req.body?.status);
  const adminNote = req.body?.adminNote === undefined ? undefined : str(req.body.adminNote);

  if (status && !["open", "sourced", "declined"].includes(status)) {
    return res.status(400).json({ error: "Unknown status." });
  }

  const existing = await db.productRequest.findUnique({ where: { id }, select: { handledAt: true } });
  if (!existing) return res.status(404).json({ error: "No such request." });

  await db.productRequest.update({
    where: { id },
    data: {
      ...(status ? { status } : {}),
      ...(adminNote !== undefined ? { adminNote } : {}),
      ...(status && status !== "open" && !existing.handledAt ? { handledAt: new Date() } : {}),
    },
  });
  res.json({ ok: true });
}));

// ---- launch list ----

admin.get("/launch-signups", asyncH(async (_req, res) => {
  res.json(await launchListStats(db));
}));

/**
 * The list as a file.
 *
 * `Content-Disposition: attachment` with a dated filename, because the likeliest thing that
 * happens to this file is that it gets uploaded to a mail provider months from now, and
 * "launch-list.csv" three times in a downloads folder is a guessing game.
 */
admin.get("/launch-signups.csv", asyncH(async (_req, res) => {
  const csv = await launchListCsv(db);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="tulipglam-launch-list-${stamp}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(csv);
}));

// ---- loyalty ----
//
// Everything under here is behind `admin.use(requireAdmin)` — the x-admin-key header, same gate
// as the rest of admin. That is what makes it acceptable for this surface to do the things the
// customer API deliberately refuses: search by phone, show raw entry types, expose row ids.
// The protection is the key, not the absence of a search box.

admin.get("/loyalty/dashboard", asyncH(async (_req, res) => {
  res.json(await loyaltyDashboard(db));
}));

admin.get("/loyalty/accounts", asyncH(async (req, res) => {
  res.json({ accounts: await findAccounts(db, str(req.query.q)) });
}));

admin.get("/loyalty/accounts/:id", asyncH(async (req, res) => {
  const detail = await accountDetail(db, num(req.params.id));
  if (!detail) return res.status(404).json({ error: "No such loyalty account." });
  const [guest, signedIn] = await Promise.all([
    guestClaims(db, detail.id),
    signedInBackfill(db, detail.id),
  ]);
  res.json({ ...detail, claims: { guest, signedIn } });
}));

/** A correction. `enteredBy` and a real reason are both mandatory — see manualAdjustment. */
admin.post("/loyalty/accounts/:id/adjust", asyncH(async (req, res) => {
  try {
    const r = await manualAdjustment(db, {
      accountId: num(req.params.id),
      points: num(req.body.points),
      reason: str(req.body.reason),
      enteredBy: str(req.body.enteredBy),
      orderId: req.body.orderId ? num(req.body.orderId) : undefined,
    });
    res.json({ ok: true, id: r.id });
  } catch (e) {
    if (e instanceof LoyaltyError) return res.status(400).json({ error: e.message, code: e.code });
    throw e;
  }
}));

/** Rule on a back-fill claim. Approving writes a ledger entry and nothing else. */
admin.post("/loyalty/accounts/:id/claims/:orderId", asyncH(async (req, res) => {
  const decision = str(req.body.decision);
  if (decision !== "approved" && decision !== "rejected") {
    return res.status(400).json({ error: "Decision must be approved or rejected." });
  }
  const r = await decideClaim(db, {
    accountId: num(req.params.id),
    orderId: num(req.params.orderId),
    decision,
    decidedBy: str(req.body.decidedBy),
    note: str(req.body.note),
  });
  if (!r.ok) return res.status(400).json({ error: r.error, code: r.code });
  res.json({ ok: true, granted: r.granted });
}));

/**
 * Attach a storefront login to a loyalty account.
 *
 * Admin-only and explicit, because a phone number typed at checkout proves nothing about who
 * owns it and there is no SMS provider to prove otherwise. The automatic path
 * (`autoLinkOnFirstRead`) only ever fires on an account with no balance and no history; anything
 * with something to steal arrives here instead.
 */
admin.post("/loyalty/accounts/:id/link", asyncH(async (req, res) => {
  try {
    const r = await linkCustomerToAccount(db, {
      accountId: num(req.params.id),
      customerId: num(req.body.customerId),
      approvedBy: str(req.body.approvedBy),
    });
    res.json({ ok: true, linked: r.linked });
  } catch (e) {
    if (e instanceof LoyaltyError) return res.status(400).json({ error: e.message, code: e.code });
    throw e;
  }
}));

/** Run the sweep by hand, for an operator who wants the stored rows to agree right now. */
admin.post("/loyalty/accounts/:id/materialise", asyncH(async (req, res) => {
  res.json(await materialise(db, num(req.params.id)));
}));

// ---- customers ----
admin.get("/customers", asyncH(async (req, res) => {
  const where: Prisma.CustomerWhereInput = {};
  if (req.query.q) where.OR = [
    { fullName: { contains: str(req.query.q), mode: "insensitive" } },
    // Email especially: addresses are commonly stored with capitals and typed without.
    { email: { contains: str(req.query.q), mode: "insensitive" } },
    { phone: { contains: str(req.query.q) } },
  ];
  const customers = await db.customer.findMany({ where, orderBy: { createdAt: "desc" },
    include: { _count: { select: { orders: true } }, orders: { select: { totalCents: true, status: true } } } });
  res.json({ customers: customers.map((c) => ({
    id: c.id, email: c.email, fullName: c.fullName, phone: c.phone, createdAt: c.createdAt,
    orderCount: c._count.orders,
    spentCents: c.orders.filter((o) => !["cancelled", "unavailable"].includes(o.status)).reduce((s, o) => s + o.totalCents, 0),
  })) });
}));

// ---- Excel import ----
admin.get("/import/template", (_req, res) => {
  const rows = [{
    name: "Velvet Lipstick", brand: "Lâme", category: "makeup", price: 22, sale: "", status: "active",
    shortDesc: "Weightless matte colour", description: "Full description here", glyph: "lipstick", tint: "#f7e2e6",
    bestSeller: "yes", concerns: "", attributes: "vegan,cruelty-free",
    shades: "Rosewood:#9b5b5b; Brick:#a4432f", sizes: "",
  }];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=tulipglam-import-template.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
});

admin.post("/import", asyncH(async (req, res) => {
  const data = str(req.body.data).replace(/^data:.*?;base64,/, "");
  if (!data) return res.status(400).json({ error: "No file." });
  const wb = XLSX.read(Buffer.from(data, "base64"), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
  const cats = new Map((await db.category.findMany()).map((c) => [c.slug.toLowerCase(), c.id]));
  const catByName = new Map((await db.category.findMany()).map((c) => [c.name.toLowerCase(), c.id]));
  const brands = new Map((await db.brand.findMany()).map((b) => [b.name.toLowerCase(), b.id]));

  let created = 0, updated = 0; const errors: string[] = [];
  for (const [i, r] of rows.entries()) {
    try {
      const name = str(r.name).trim();
      if (!name) continue;
      const catKey = str(r.category).toLowerCase().trim();
      const categoryId = cats.get(catKey) ?? catByName.get(catKey);
      if (!categoryId) { errors.push(`Row ${i + 2}: unknown category "${r.category}"`); continue; }
      let brandId: number | null = null;
      const bName = str(r.brand).trim();
      if (bName) {
        brandId = brands.get(bName.toLowerCase()) ?? null;
        if (!brandId) { const nb = await db.brand.create({ data: { name: bName, slug: slugify(bName) } }); brandId = nb.id; brands.set(bName.toLowerCase(), nb.id); }
      }
      const price = toCents(r.price);
      const sale = r.sale === "" || r.sale == null ? null : toCents(r.sale);
      const slug = slugify(`${bName || "tulipglam"}-${name}`);
      const base = {
        name, status: STATUS_PRODUCT.includes(str(r.status)) ? str(r.status) : "active",
        priceCents: price, saleCents: sale && sale < price ? sale : null,
        shortDesc: str(r.shortDesc), description: str(r.description),
        glyph: str(r.glyph, "bottle"), tint: str(r.tint, "#f5e9f0"),
        isBestSeller: bool(r.bestSeller) || str(r.bestSeller).toLowerCase() === "yes",
        concerns: str(r.concerns), attributes: str(r.attributes), categoryId, brandId,
      };
      const existing = await db.product.findUnique({ where: { slug } });
      const p = existing
        ? await db.product.update({ where: { slug }, data: base })
        : await db.product.create({ data: { ...base, slug } });
      if (existing) updated++; else created++;

      const parseVariants = (s: string, type: "shade" | "size") => str(s).split(";").map((x) => x.trim()).filter(Boolean).map((x, k) => {
        const [label, hex] = x.split(":").map((y) => y.trim());
        return { productId: p.id, type, label, hex: hex ?? "", sortOrder: k };
      });
      const variants = [...parseVariants(str(r.shades), "shade"), ...parseVariants(str(r.sizes), "size")];
      if (variants.length) { await db.productVariant.deleteMany({ where: { productId: p.id } }); await db.productVariant.createMany({ data: variants }); }
    } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); }
  }
  res.json({ created, updated, errors });
}));

app.use("/api/admin", admin);

// ---- crawler-facing routes ----
// Both are served whether or not the built web exists, so they can be checked in development.

/**
 * Where this store lives, for canonical URLs and absolute image URLs.
 *
 * The `siteUrl` setting wins, because behind Render's proxy the request host is the internal
 * one. Falling back to the request keeps everything working before it is set.
 */
function originOf(req: express.Request, settings: Record<string, string>): string {
  const configured = str(settings.siteUrl).trim();
  if (configured) return configured.replace(/\/+$/, "");
  // Behind Render's proxy the scheme is only in the forwarded header.
  const proto = str(req.get("x-forwarded-proto")).split(",")[0] || req.protocol;
  return `${proto}://${req.get("host") ?? "localhost"}`;
}
async function seoContext(req: express.Request) {
  const settings = await getSettings();
  return { db, origin: originOf(req, settings), settings, visible: VISIBLE };
}

app.get("/robots.txt", asyncH(async (req, res) => {
  const { origin } = await seoContext(req);
  // While gated: crawl the homepage, nothing else. Every other URL serves the identical
  // placeholder, and inviting a crawler to index thousands of copies of one page is how a
  // site arrives at launch already carrying a duplicate-content problem.
  if (COMING_SOON) {
    return res.type("text/plain").set("Cache-Control", "public, max-age=0, must-revalidate").send(
      ["User-agent: *", "Allow: /$", "Disallow: /", "", `Sitemap: ${origin}/sitemap.xml`, ""].join("\n"),
    );
  }
  res.type("text/plain").send(robotsTxt(origin));
}));

app.get("/sitemap.xml", asyncH(async (req, res) => {
  // Same reason: one URL while gated, not the catalogue's 8,488. This is the single most
  // damaging thing a coming-soon page can get wrong, because the harm outlives the gate.
  if (COMING_SOON) {
    const { origin } = await seoContext(req);
    return res.type("application/xml").set("Cache-Control", "public, max-age=0, must-revalidate").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${origin}/</loc>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`,
    );
  }
  const xml = await sitemapXml(await seoContext(req));
  // Ten minutes. The catalogue changes on an import, not per request, and regenerating ~9,500
  // rows on every crawler hit is pure waste.
  res.type("application/xml").set("Cache-Control", "public, max-age=600").send(xml);
}));

// serve built web in production (single service like the other stores)
const WEB_DIST = path.resolve(process.cwd(), "..", "web", "dist");
if (fs.existsSync(WEB_DIST)) {
  /**
   * Cache headers.
   *
   * Everything was served with Express's default, which is a `Last-Modified` revalidation —
   * so a returning shopper made a conditional request for every file including all ~48 product
   * photos on a shop page. Each is a full round trip to us-east-2 before a 304 comes back.
   *
   * `/assets/*` filenames carry a content hash, so they can be immutable for a year: a changed
   * file gets a new name and a stale one can never be served.
   *
   * Product photos are not hashed — a re-import can overwrite a filename in place — so they get
   * a week rather than a year. Long enough that a repeat visit is free, short enough that a
   * corrected photo reaches people without a cache-busting scheme this store has no way to run.
   */
  app.use(express.static(WEB_DIST, {
    index: false,
    setHeaders: (res, filePath) => {
      const rel = filePath.slice(WEB_DIST.length).replace(/\\/g, "/");
      if (rel.startsWith("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      else if (/^\/(products|hero|category)\//.test(rel)) res.setHeader("Cache-Control", "public, max-age=604800");
      // index.html is left alone: it must be revalidated or a deploy never reaches anyone.
    },
  }));

  /**
   * The SPA fallback, with a head resolved on the server.
   *
   * A client-side app shows one title and one description to any crawler that doesn't run
   * JavaScript — and WhatsApp's link preview crawler doesn't. Since pasting a product link into
   * a chat is how products actually get shared here, every share produced the same generic
   * homepage card with no photo, name or price.
   *
   * Also fixes a quieter problem: this route answered 200 for every unknown path, so a
   * mistyped URL was indexable as a real page. Unknown paths and missing slugs now answer 404
   * with the app's own not-found screen.
   */
  const template = fs.readFileSync(path.join(WEB_DIST, "index.html"), "utf8");
  app.get("*", asyncH(async (req, res) => {
    /**
     * THE GATE HAS TO BE RE-CHECKED HERE, and this is not belt-and-braces.
     *
     * `comingSoonGate` runs before the routes and calls next() for anything on its allowlist —
     * `/api/admin/`, `/api/auth/`, `/api/internal/`, `/api/launch-signup`. An allowlisted path
     * that matches NO route then falls all the way through to this catch-all, which serves the
     * real storefront shell. Four paths did exactly that:
     *
     *     GET /api/launch-signup          (allowlisted exact path; only POST has a route)
     *     GET /api/auth/does-not-exist
     *     GET /api/internal/anything
     *     GET /api/auth/..%2findex.html
     *
     * Each answered 404 with the full real index.html in the body — enough for a browser to
     * boot the SPA. The store is supposed to be invisible while COMING_SOON is on, and it was
     * one guessable URL away from not being.
     *
     * The allowlist is about letting specific ENDPOINTS through, never about letting the site
     * through. A request that reached here matched no endpoint, so it gets the gate's answer.
     */
    if (COMING_SOON && !hasPreviewAccess(req)) return comingSoonFallback(req, res);

    const ctx = await seoContext(req);
    const meta = await metaForPath(req.path, ctx);
    const html = injectHead(template, renderHead(meta, ctx.settings.storeName || "TulipGlam"));
    res.status(meta.status ?? 200).type("html").send(html);
  }));
}

app.listen(PORT, () => console.log(`TulipGlam API on http://localhost:${PORT}`));
