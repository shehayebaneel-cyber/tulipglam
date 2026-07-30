-- Additive index migration for the rebuilt admin product list.
--
-- STATUS: already applied on 2026-07-30 via `npm run db:push`, because schema.prisma
-- declares the same indexes and the app needed them. Verified afterwards: 12 indexes
-- created, 0 invalid, row counts unchanged. This file is kept as the lock-free equivalent
-- — `db push` builds indexes non-concurrently, which is fine at 10k rows but would hold a
-- write lock on a much larger table. Re-running it is a no-op.
--
-- WHY: the admin list sorts and filters ~10k products by status, category, brand, source,
-- price and updatedAt, and the only indexes on "Product" were the primary key and the slug
-- unique. Every sort and every filter was a sequential scan. Prisma does not create indexes
-- for relation scalar fields on PostgreSQL, so ProductImage.productId and
-- ProductVariant.productId were unindexed too — those are hit by the thumbnail include and
-- the variant count on every row of every page.
--
-- SAFETY: purely additive. No column is added, altered or dropped and no row is written.
-- CREATE INDEX CONCURRENTLY does not take a write lock, so the live storefront keeps
-- serving throughout. IF NOT EXISTS makes the whole file idempotent.
--
-- CONCURRENTLY cannot run inside a transaction block. Run with psql, which does not wrap
-- statements by default:
--
--     psql "$DIRECT_URL" -f scripts/2026-07-30-admin-indexes.sql
--
-- Use DIRECT_URL (the non-pooled Neon endpoint), not DATABASE_URL — CONCURRENTLY through
-- a pooler can fail. Afterwards the schema and database agree; `prisma db push` will
-- report nothing to do because schema.prisma already declares these.
--
-- If any index ends up INVALID (a concurrent build can fail without aborting), drop that
-- one index and re-run this file:
--     SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;

-- ---------------------------------------------------------------- Product
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_status_idx"     ON "Product" ("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_categoryId_idx" ON "Product" ("categoryId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_brandId_idx"    ON "Product" ("brandId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_source_idx"     ON "Product" ("source");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_priceCents_idx" ON "Product" ("priceCents");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_updatedAt_idx"  ON "Product" ("updatedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_name_idx"       ON "Product" ("name");

-- ---------------------------------------------------------------- children
-- Composite so the ordered "first image" / ordered variant reads are covered.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProductImage_productId_sortOrder_idx"
  ON "ProductImage" ("productId", "sortOrder");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProductVariant_productId_sortOrder_idx"
  ON "ProductVariant" ("productId", "sortOrder");

-- ---------------------------------------------------------------- Order
-- The admin order list filters by status and always sorts by createdAt desc.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_status_idx"    ON "Order" ("status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Order_createdAt_idx" ON "Order" ("createdAt");

-- Verify afterwards:
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND tablename IN ('Product','ProductImage','ProductVariant','Order')
--   ORDER BY tablename, indexname;
