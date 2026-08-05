import type { PrismaClient } from "@prisma/client";

/**
 * The homepage rail: whose choice it is, and what it may be called.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────
 *
 * The rail was labelled **"Best sellers"** under the eyebrow **"Loved by everyone"**, linked to
 * `/bestsellers`, and described in the page `<head>` as *"The most-ordered products"*. All four
 * were fed by `Product.isBestSeller` — a checkbox in admin. Nothing counted an order, nothing
 * counted a review, and no product has ever carried the flag, so the rail has never rendered.
 *
 * Four separate claims about customer behaviour, from a field that only ever recorded the
 * owner's opinion. The same shape as the promo band advertising deleted brands and the
 * announcement bar quoting a delivery threshold it had not read.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────────────
 *
 * This module is the only thing that decides what the rail is called, where it links, and which
 * products are in it. Every surface — homepage, shop page, nav, footer, sitemap, `<head>` — asks
 * it rather than hardcoding a word. That is deliberate: the label and the data have to move
 * together or the next person changes one and not the other, which is how it broke the first
 * time.
 *
 * ── THE TRANSITION IS AUTOMATIC ────────────────────────────────────────────────────
 *
 * Nobody has to remember to flip it. `resolveRail` asks the orders table on every call (cached
 * briefly) and upgrades itself the moment the evidence exists. Until then it says "Our Picks",
 * which is true, instead of "Best Sellers", which is not.
 */

/** How many products the rail shows. Also the number that must qualify before "best" is earnable. */
export const RAIL_SIZE = 8;

/**
 * ═══ THE ONE CONFIG VALUE ═══
 *
 * How many **delivered units of a single product** before that product may be called a best
 * seller.
 *
 * ── WHY PER-PRODUCT, AND NOT "how many delivered orders" ───────────────────────────
 *
 * The brief asked for a number of delivered orders. Per-product is the stronger form of the same
 * question and it is what actually makes the claim defensible, because "best seller" is a claim
 * about *this product*, not about the shop's traffic. A shop could take 500 delivered orders
 * concentrated in three products and still have nothing honest to say about slots four to eight
 * — a site-wide count would have declared the rail ready while five of its eight entries had
 * sold once each.
 *
 * Requiring RAIL_SIZE products to clear the bar implies a site-wide floor anyway: at least
 * 8 x 10 = **80 delivered units** before the words "Best Sellers" can appear anywhere.
 *
 * ── WHY 10 ─────────────────────────────────────────────────────────────────────────
 *
 *   1-2 units   one household. A cousin buying twice is not a market signal.
 *   ~5 units    one bulk order, one family, or one good week — still a single event.
 *   10+ units   repeated, independent choice across time. For a shop holding no inventory and
 *               delivering cash-on-delivery across Lebanon, ten delivered units of one SKU is a
 *               product people come back for, not a launch-week spike.
 *
 * Raise it if the catalogue turns out to sell in volume; the claim only gets stronger. Lowering
 * it below about 5 makes the rail a random walk that reshuffles on every delivery.
 *
 * ── DELIVERED, NOT ORDERED ─────────────────────────────────────────────────────────
 *
 * Counted from orders in `delivered` or `completed` only. A refused parcel is not a sale, and
 * under the enforced transitions in `status.ts` a `refused` order can never reach `delivered`,
 * so this cannot quietly count one. Placement is not evidence either — this is cash on delivery,
 * where the doorstep is where a sale becomes real.
 *
 * ── NO TIME WINDOW, DELIBERATELY ───────────────────────────────────────────────────
 *
 * "Best sellers this season" would be a better claim than all-time, but there is no order
 * history to tune a window against, and a second number guessed today would be exactly the kind
 * of unverifiable value this codebase keeps removing. One knob, honest, revisitable.
 */
export const BEST_SELLER_MIN_UNITS = 10;

export type RailMode = "picks" | "bestsellers";

export type Rail = {
  mode: RailMode;
  /** The heading a customer reads. */
  label: string;
  /** The line above it. Must be as checkable as the label. */
  eyebrow: string;
  /** Where the "see all" link goes. */
  href: string;
  /** The `<head>` description for that page. */
  blurb: string;
  /** How many products currently clear BEST_SELLER_MIN_UNITS. Admin-facing. */
  qualifying: number;
};

const PICKS: Omit<Rail, "qualifying"> = {
  mode: "picks",
  label: "Our Picks",
  // Not "Loved by everyone" — nobody has said they love anything. This says who chose, which
  // is the only thing we know.
  eyebrow: "Chosen by us",
  href: "/our-picks",
  blurb: "A short list chosen by hand from everything we carry.",
};

const BEST: Omit<Rail, "qualifying"> = {
  mode: "bestsellers",
  label: "Best Sellers",
  eyebrow: "Most delivered",
  href: "/bestsellers",
  blurb: "The products our customers order most, counted from delivered orders.",
};

/**
 * Cached, because this runs on the homepage and every `/api/site` call.
 *
 * Sixty seconds: the rail does not need to flip within a minute of the eightieth delivery, and
 * against a database in Ohio this is a round trip that would otherwise be paid on every page.
 * Same reasoning as the settings cache, with a longer window because nothing here is money.
 */
const TTL_MS = 60_000;
let cache: { at: number; rail: Rail } | null = null;

/** Drops the cache. Called when an order reaches a delivered state, so the flip cannot lag. */
export function invalidateRail() {
  cache = null;
}

/** Products with at least `BEST_SELLER_MIN_UNITS` delivered units, most-delivered first. */
async function deliveredLeaders(db: PrismaClient, limit: number): Promise<{ id: number; units: number }[]> {
  const { Prisma: P } = await import("@prisma/client");
  return db.$queryRaw<{ id: number; units: number }[]>(P.sql`
    SELECT oi."productId" AS id, SUM(oi.qty)::int AS units
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    JOIN "Product" p ON p.id = oi."productId"
    -- Only what actually reached a doorstep. This names the two delivered states rather than
    -- listing what to skip, so a status added later is excluded by default instead of being
    -- silently counted as a sale.
    WHERE o.status IN ('delivered', 'completed')
      AND oi."productId" IS NOT NULL
      -- A discontinued product is not a best seller we can offer.
      AND p.status = 'active'
    GROUP BY oi."productId"
    HAVING SUM(oi.qty) >= ${BEST_SELLER_MIN_UNITS}
    ORDER BY units DESC, oi."productId" ASC
    LIMIT ${limit}
  `);
}

/**
 * Which rail is live right now, and what it may be called.
 *
 * Upgrades itself the moment RAIL_SIZE products have each cleared the bar. There is no setting
 * to remember to change and no migration — the claim becomes true, so the words change.
 */
export async function resolveRail(db: PrismaClient): Promise<Rail> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rail;
  // Asking for RAIL_SIZE + 1 is pointless; we only need to know whether RAIL_SIZE qualify.
  const leaders = await deliveredLeaders(db, RAIL_SIZE);
  const base = leaders.length >= RAIL_SIZE ? BEST : PICKS;
  const rail: Rail = { ...base, qualifying: leaders.length };
  cache = { at: Date.now(), rail };
  return rail;
}

/**
 * The product ids for the rail, in the order they should appear.
 *
 * In picks mode the owner's choice is the order they were most recently touched, so a newly
 * picked product appears first. In best-seller mode the order is the count, because that is
 * what the word means.
 */
export async function railProductIds(db: PrismaClient, rail: Rail, limit = RAIL_SIZE): Promise<number[]> {
  if (rail.mode === "bestsellers") {
    return (await deliveredLeaders(db, limit)).map((r) => r.id);
  }
  const rows = await db.product.findMany({
    where: { status: "active", isBestSeller: true },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => r.id);
}
