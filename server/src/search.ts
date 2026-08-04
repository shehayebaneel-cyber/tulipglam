import type { PrismaClient } from "@prisma/client";

/**
 * Search that survives the way people actually type.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────
 *
 * Both search paths used Prisma's `contains`, which on Postgres is `LIKE` — **case
 * sensitive**. Before any question of typos, "nivea" did not find "Nivea" and "dior" did not
 * find "Dior". A customer had to match capitalisation exactly, on a phone keyboard.
 *
 * ── ONE EXTENSION, AND IT EXISTS IN BOTH PLACES ────────────────────────────────────
 *
 * `pg_trgm` only. Checked on Neon before building anything — available at 1.6 — and it is a
 * standard contrib module shipped with every Postgres distribution, so it is equally present on
 * a self-hosted box after Stage C. This is deliberately not a Neon-shaped interim.
 *
 * `unaccent` was available too and is NOT used: accents are folded in TypeScript instead, on
 * both the stored text and the query, so the two sides are normalised by the same code. One
 * fewer extension to exist on two machines, and no chance of the database and the application
 * disagreeing about what "é" means.
 *
 * ── WHY A STORED COLUMN ────────────────────────────────────────────────────────────
 *
 * "nivea cream" has to match a Nivea product called "Soft Cream", where neither the name nor
 * the brand contains both words. That is impossible to express as a per-column comparison, so
 * name, brand, category and tags are folded into one normalised `searchText` per product and
 * matched as a whole. It is also what makes a trigram index possible — an expression index
 * cannot reach across a join.
 */

/**
 * Fold text to its searchable form.
 *
 * Applied identically to the stored column and to the query, which is the only way "L'Oréal"
 * and "loreal" can meet. Accents decomposed and stripped, punctuation dropped, whitespace
 * collapsed — so apostrophes, hyphens and dots stop mattering.
 */
export function normalise(raw: string): string {
  return (raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // strip the decomposed accent marks
    .toLowerCase()
    .replace(/['’`´]/g, "")            // l'oréal -> loreal, johnson's -> johnsons
    .replace(/[^a-z0-9]+/g, " ")       // dashes, dots, slashes, & — all become spaces
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * The text a product is found by.
 *
 * Includes a SPACE-STRIPPED copy of the whole thing, so "lipliner" finds "Lip Liner" and
 * "eyeshadow" finds "Eye Shadow". Trigram similarity alone handles that case poorly — the
 * space is a character, and removing it shifts every trigram after it.
 */
export function buildSearchText(p: {
  name: string;
  brandName?: string | null;
  categoryName?: string | null;
  parentCategoryName?: string | null;
  concerns?: string | null;
  attributes?: string | null;
}): string {
  const spaced = normalise(
    [p.name, p.brandName, p.categoryName, p.parentCategoryName, p.concerns, p.attributes]
      .filter(Boolean)
      .join(" "),
  );
  const squashed = spaced.replace(/ /g, "");
  return `${spaced} ${squashed}`.trim();
}

/**
 * How close a typo may be before it stops counting.
 *
 * 0.42 was chosen by running the real misspelling list against the real catalogue and moving it
 * until "mascarra", "nivia" and "shampo" were found and junk was not. Lower and a two-letter
 * query drags in half the shop; higher and a doubled letter stops matching. It is a floor, not
 * a target — forgiving is not the same as returning everything.
 */
export const WORD_THRESHOLD = 0.42;

/**
 * The second, lower bar — tried ONLY when the strict pass found nothing at all.
 *
 * Trigram similarity has one blind spot the requirement names directly: a **transposition near
 * the start of a short word**. "granier" for Garnier shares only two trigrams with it (`nie`,
 * `ier`) because swapping the `a` and `r` rewrites the other three, so it scored 0.375 and the
 * 0.42 floor rejected it — a customer who knows exactly which brand they want, shown nothing.
 *
 * Measured against the live catalogue rather than guessed:
 *
 *     worst real typo   "granier" -> Garnier      0.375
 *     best junk         "zxcvbnmasdf"             0.167
 *     junk ceiling across a wider mash set        0.20
 *
 * 0.30 sits in that gap with room on both sides. It is a *fallback*, not a lower floor: a query
 * that already matched something keeps the strict 0.42, so a good result set can never be
 * flooded by weaker matches. The bar only drops when the alternative is an empty page, which is
 * the one case where a slightly-wrong answer beats no answer.
 */
export const FALLBACK_THRESHOLD = 0.30;

/** Ranked ids. Ranking and filtering live in SQL; Prisma then loads the rows it already fetches. */
export type Hit = { id: number; score: number };

/**
 * Find products matching a query, most relevant first.
 *
 * EVERY token must match something — that is what makes "nivea cream" mean both words rather
 * than either. A token matches if it appears as a substring, or if pg_trgm judges it close
 * enough to a word in the text.
 *
 * `statuses` is passed in rather than defaulted, so the caller — never this function — decides
 * what is visible. There is no path here that can widen it.
 */
export async function searchProductIds(
  db: PrismaClient,
  query: string,
  statuses: string[],
  limit: number,
): Promise<Hit[]> {
  const q = normalise(query);
  if (!q) return [];
  const tokens = q.split(" ").filter(Boolean).slice(0, 6); // a 7-word query is not a search
  if (tokens.length === 0) return [];

  const squashed = q.replace(/ /g, "");

  /**
   * Built with Prisma.sql so every value is a bound parameter.
   *
   * This is a raw query over a string a stranger typed into a public box. Interpolating it
   * would be the most ordinary SQL injection there is.
   */
  const { Prisma: P } = await import("@prisma/client");

  const run = async (threshold: number) => {
    const tokenConditions = tokens.map(
      (t) => P.sql`("searchText" LIKE ${"%" + t + "%"} OR word_similarity(${t}, "searchText") >= ${threshold})`,
    );
    return runQuery(tokenConditions);
  };

  const runQuery = async (tokenConditions: ReturnType<typeof P.sql>[]) => {
  const rows = await db.$queryRaw<{ id: number; score: number }[]>(P.sql`
    SELECT id,
      (
        -- The whole query, as typed, appearing intact. Nothing beats this.
        CASE WHEN "searchText" LIKE ${"%" + q + "%"} THEN 4.0 ELSE 0 END
        -- Spaces removed: "lipliner" against "lip liner".
        + CASE WHEN "searchText" LIKE ${"%" + squashed + "%"} THEN 2.0 ELSE 0 END
        -- A word starts with the query: type-ahead's real job.
        + CASE WHEN "searchText" LIKE ${q + "%"} OR "searchText" LIKE ${"% " + q + "%"} THEN 1.5 ELSE 0 END
        -- How close the whole thing is, which orders the fuzzy tail sensibly.
        + similarity("searchText", ${q})
        -- A best-seller wins a tie, and only a tie.
        + CASE WHEN "isBestSeller" THEN 0.05 ELSE 0 END
      ) AS score
    FROM "Product"
    WHERE status = ANY(${statuses})
      AND ${P.join(tokenConditions, " AND ")}
    ORDER BY score DESC, "isBestSeller" DESC, id ASC
    LIMIT ${limit}
  `);
    return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
  };

  const strict = await run(WORD_THRESHOLD);
  if (strict.length > 0) return strict;

  /**
   * Nothing at the strict bar — try once more at the lower one before giving up.
   *
   * The extra round trip is only ever paid on a search that was about to show an empty page,
   * so it costs nothing on the queries customers actually make and buys back the whole class
   * of near-miss typos the strict floor rejects. See FALLBACK_THRESHOLD for why 0.30.
   */
  return run(FALLBACK_THRESHOLD);
}
