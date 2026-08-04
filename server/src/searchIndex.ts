import type { PrismaClient } from "@prisma/client";
import { buildSearchText } from "./search.js";

/**
 * Keeping `searchText` true, and the index that makes it fast.
 *
 * ── WHY THIS RUNS AFTER EVERY IMPORT ───────────────────────────────────────────────
 *
 * All three importers `deleteMany` and recreate every product for their source, so a product's
 * `searchText` is empty the moment an import finishes — and an empty searchText means the
 * product is invisible to search while looking perfectly fine everywhere else. That is the
 * worst shape of bug this codebase keeps meeting: a success log, and something quietly missing.
 *
 * Same answer as the brand allowlist and the AI-image filter — the rule runs at the end of
 * every import rather than once, by hand, hopefully.
 */

/**
 * Create the extension and the trigram index if they are not already there.
 *
 * `IF NOT EXISTS` throughout, so this is safe to run on every deploy and on a fresh box.
 * `pg_trgm` is a standard contrib module — verified present on Neon (1.6) before any of this
 * was built, and shipped with every Postgres distribution, so the same call works after Stage C.
 */
export async function ensureSearchIndex(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  // GIN over trigrams: what makes `LIKE '%…%'` and word_similarity fast rather than a scan of
  // every row. gin_trgm_ops is the operator class that teaches GIN about trigrams.
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Product_searchText_trgm_idx" ON "Product" USING gin ("searchText" gin_trgm_ops)`,
  );
}

export type RefreshResult = {
  scanned: number;
  changed: number;
  samples: { name: string; text: string }[];
};

/**
 * Recompute `searchText` for products whose value is stale.
 *
 * Only writes rows that actually differ, so a re-run over an unchanged catalogue is a read.
 * `source` narrows it to one importer's rows, which is what the import hooks pass.
 */
export async function refreshSearchText(
  db: PrismaClient,
  opts: { write?: boolean; source?: string } = {},
): Promise<RefreshResult> {
  const products = await db.product.findMany({
    where: opts.source ? { source: opts.source } : {},
    select: {
      id: true, name: true, searchText: true, concerns: true, attributes: true,
      brand: { select: { name: true } },
      category: { select: { name: true, parent: { select: { name: true } } } },
    },
  });

  const samples: { name: string; text: string }[] = [];
  const pending: { id: number; text: string }[] = [];

  for (const p of products) {
    const next = buildSearchText({
      name: p.name,
      brandName: p.brand?.name,
      categoryName: p.category?.name,
      parentCategoryName: p.category?.parent?.name,
      concerns: p.concerns,
      attributes: p.attributes,
    });
    if (next === p.searchText) continue;
    if (samples.length < 5) samples.push({ name: p.name, text: next });
    pending.push({ id: p.id, text: next });
  }

  /**
   * Written in batches, not one row at a time.
   *
   * The first version issued one `update` per product. Against Neon in Ohio that ran at roughly
   * 360 rows a minute — 27 minutes for the catalogue — which is unusable for something that has
   * to run at the end of every import. This repository already learned the same lesson once,
   * when the Feel22 importer's per-product inserts took two and a half hours and `createMany`
   * took about a minute.
   *
   * One statement per 500 rows, each a single round trip: `UPDATE … FROM (VALUES …)`.
   */
  if (opts.write && pending.length) {
    const { Prisma: P } = await import("@prisma/client");
    const SIZE = 500;
    for (let i = 0; i < pending.length; i += SIZE) {
      const chunk = pending.slice(i, i + SIZE);
      const values = P.join(chunk.map((c) => P.sql`(${c.id}::int, ${c.text}::text)`), ", ");
      await db.$executeRaw(P.sql`
        UPDATE "Product" AS p SET "searchText" = v.text
        FROM (VALUES ${values}) AS v(id, text)
        WHERE p.id = v.id
      `);
    }
  }

  return { scanned: products.length, changed: pending.length, samples };
}
