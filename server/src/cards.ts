import type { PrismaClient } from "@prisma/client";

/**
 * Loading product cards in ONE round trip.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────
 *
 * Type-ahead search was taking 1–2 seconds per keystroke, and the trigram query was not the
 * reason. Measured against Neon, for six products:
 *
 *     bare round trip (SELECT 1)                     147 ms   <- the Ohio distance, unavoidable today
 *     searchProductIds("mascarra")                   385 ms   <- the actual search
 *     findMany({ include: { brand, category, images } })  1173 ms   <- loading six cards
 *
 * Prisma does not join. `include` issues a **separate query per relation** and stitches the
 * results in the client, so three includes cost four sequential round trips. On a database
 * 9,000 km away that is four times the latency floor before any work happens — and the work
 * itself is trivial: three indexed lookups on six ids.
 *
 * The fix is not a cache and not a smaller payload. It is asking the database the question
 * once. Postgres joins are what Postgres is for.
 *
 * ── WHY IT SHAPES ROWS INSTEAD OF SERIALISING THEM ─────────────────────────────────
 *
 * This returns rows shaped exactly like Prisma's `include` payload, so `cardOf` — the one
 * function that decides what a customer sees — is unchanged and still the only serialiser.
 * A second card serialiser would be the `rules.ts`/`ledger.ts` split all over again: two
 * places computing the same thing, each self-consistent, drifting apart unwatched.
 *
 * ── IT SURVIVES THE MOVE OFF NEON ──────────────────────────────────────────────────
 *
 * Nothing here is Neon-specific: a LEFT JOIN and a LATERAL subquery, both plain SQL. After
 * Stage C the 147 ms floor collapses to sub-millisecond and this gets faster for free, while
 * the four-round-trip version would still pay four times whatever the new floor is.
 */

/**
 * The shape a product card is built from — and therefore the complete list of columns a
 * customer-facing card is allowed to depend on.
 *
 * Prisma's own `include` payload satisfies this structurally, so both loaders feed `cardOf`.
 * Note what is absent: `sku` (the supplier's reorder code) has no way in.
 */
export type CardRow = {
  id: number;
  slug: string;
  name: string;
  status: string;
  priceCents: number;
  saleCents: number | null;
  glyph: string;
  tint: string;
  isBestSeller: boolean;
  isNewMode: string;
  createdAt: Date;
  images: { url: string }[];
  /** Carried for `spreadBrands`, which interleaves the homepage rails so one brand cannot fill a row. */
  brandId: number | null;
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string };
};

type Flat = {
  id: number; slug: string; name: string; status: string;
  priceCents: number; saleCents: number | null;
  glyph: string; tint: string;
  isBestSeller: boolean; isNewMode: string; createdAt: Date;
  image: string | null;
  brandId: number | null;
  brandName: string | null; brandSlug: string | null;
  categoryName: string; categorySlug: string;
};

/**
 * Load cards for the given ids, **in the order given**.
 *
 * Callers pass ids that came out of a ranking query, so the order is the answer — losing it
 * would turn a relevance-sorted search into an arbitrary one. SQL does not promise to return
 * rows in the order of an `IN` list, so the order is reapplied here rather than assumed.
 *
 * This does no visibility filtering of its own. It loads what it is asked for, and every
 * caller has already decided which statuses may be seen — keeping that decision in one place
 * per route rather than splitting it across two functions that each half-enforce it.
 */
export async function loadCards(db: PrismaClient, ids: number[]): Promise<CardRow[]> {
  if (ids.length === 0) return [];
  const { Prisma: P } = await import("@prisma/client");

  const rows = await db.$queryRaw<Flat[]>(P.sql`
    SELECT
      p.id, p.slug, p.name, p.status, p."priceCents", p."saleCents",
      p.glyph, p.tint, p."isBestSeller", p."isNewMode", p."createdAt", p."brandId",
      b.name AS "brandName", b.slug AS "brandSlug",
      c.name AS "categoryName", c.slug AS "categorySlug",
      img.url AS image
    FROM "Product" p
    -- INNER: categoryId is a non-null FK, so this cannot drop a row.
    JOIN "Category" c ON c.id = p."categoryId"
    -- LEFT: brandId is nullable and plenty of products have no brand.
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    -- LATERAL rather than a correlated scalar subquery: it uses the
    -- (productId, sortOrder) index directly and stops after one row.
    LEFT JOIN LATERAL (
      SELECT i.url FROM "ProductImage" i
      WHERE i."productId" = p.id
      ORDER BY i."sortOrder" ASC, i.id ASC
      LIMIT 1
    ) img ON TRUE
    WHERE p.id IN (${P.join(ids)})
  `);

  const byId = new Map<number, CardRow>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id, slug: r.slug, name: r.name, status: r.status,
      priceCents: r.priceCents, saleCents: r.saleCents,
      glyph: r.glyph, tint: r.tint,
      isBestSeller: r.isBestSeller, isNewMode: r.isNewMode, createdAt: r.createdAt,
      brandId: r.brandId,
      // `take: 1` in the Prisma version meant zero or one image, and `cardOf` reads `[0]`.
      images: r.image ? [{ url: r.image }] : [],
      brand: r.brandName && r.brandSlug ? { name: r.brandName, slug: r.brandSlug } : null,
      category: { name: r.categoryName, slug: r.categorySlug },
    });
  }

  // Requested order, and ids that matched nothing simply drop out.
  return ids.map((id) => byId.get(id)).filter((r): r is CardRow => r !== undefined);
}
