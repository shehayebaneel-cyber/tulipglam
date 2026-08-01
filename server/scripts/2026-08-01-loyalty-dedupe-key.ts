/**
 * Add LoyaltyLedgerEntry.dedupeKey — a nullable, unique idempotency key.
 *
 *     npx tsx scripts/2026-08-01-loyalty-dedupe-key.ts            # report only, writes nothing
 *     npx tsx scripts/2026-08-01-loyalty-dedupe-key.ts --write    # applies
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. --write is live immediately.
 *
 *  This is PURELY ADDITIVE and cannot lose data:
 *
 *    ALTER TABLE "LoyaltyLedgerEntry" ADD COLUMN "dedupeKey" TEXT;
 *    CREATE UNIQUE INDEX CONCURRENTLY ... ON "LoyaltyLedgerEntry"("dedupeKey");
 *
 *  No column is dropped, renamed or retyped, and no existing row is updated. Every existing
 *  row gets NULL, and Postgres treats NULLs as DISTINCT in a unique index, so the constraint
 *  cannot collide with anything already stored.
 *
 *  Both statements are IF NOT EXISTS, so running this twice is a no-op.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS AS A SCRIPT RATHER THAN `prisma db push`
 *
 * `db push` reports "there might be data loss" for ANY new unique constraint, because in the
 * general case an existing column can already hold duplicates. It cannot tell that this column
 * is new and therefore empty, and it will not proceed without `--accept-data-loss` — a flag
 * whose name is a poor description of what is happening here and a bad habit to acquire on a
 * database that is shared with production.
 *
 * So the change is spelled out instead. `CONCURRENTLY` also means the table is never locked
 * against writes, which `db push` would not have given us.
 *
 * AFTERWARDS: run `npx prisma db push` normally to confirm the schema and the database agree.
 * It should report no changes.
 *
 * WHAT THE COLUMN IS FOR
 *
 * Four writes used to be read-then-write — look for an existing row, insert if absent — which
 * grants twice whenever two requests interleave: a double-clicked button, a client retry, a
 * replayed status change. The sign-up bonus, the birthday bonus, the redemption reversal and the
 * earn reversal were all live examples. Keys are namespaced strings; see schema.prisma.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const WRITE = process.argv.includes("--write");

const COLUMN = `ALTER TABLE "LoyaltyLedgerEntry" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT`;
const INDEX = `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "LoyaltyLedgerEntry_dedupeKey_key" ON "LoyaltyLedgerEntry"("dedupeKey")`;

async function main() {
  const [{ exists: hasColumn }] = await db.$queryRawUnsafe<{ exists: boolean }[]>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'LoyaltyLedgerEntry' AND column_name = 'dedupeKey'
    ) AS "exists"`);

  const [{ exists: hasIndex }] = await db.$queryRawUnsafe<{ exists: boolean }[]>(`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'LoyaltyLedgerEntry' AND indexname = 'LoyaltyLedgerEntry_dedupeKey_key'
    ) AS "exists"`);

  const rows = await db.loyaltyLedgerEntry.count();

  console.log(`\nLoyaltyLedgerEntry holds ${rows} row(s).`);
  console.log(`  column "dedupeKey"  ${hasColumn ? "already present" : "MISSING — will be added"}`);
  console.log(`  unique index        ${hasIndex ? "already present" : "MISSING — will be created"}\n`);

  if (hasColumn && hasIndex) {
    console.log("Nothing to do.\n");
    await db.$disconnect();
    return;
  }

  console.log("Statements:");
  if (!hasColumn) console.log(`  ${COLUMN}`);
  if (!hasIndex) console.log(`  ${INDEX}`);

  if (!WRITE) {
    console.log("\n───────────────────────────────────────────────────────────────");
    console.log("DRY RUN — nothing was written.");
    console.log("To apply:  npx tsx scripts/2026-08-01-loyalty-dedupe-key.ts --write");
    console.log("───────────────────────────────────────────────────────────────\n");
    await db.$disconnect();
    return;
  }

  if (!hasColumn) {
    await db.$executeRawUnsafe(COLUMN);
    console.log("\n  column added");
  }
  if (!hasIndex) {
    // CONCURRENTLY cannot run inside a transaction block, which is why these are separate
    // $executeRawUnsafe calls rather than a $transaction.
    await db.$executeRawUnsafe(INDEX);
    console.log("  unique index created (concurrently — the table was never locked)");
  }

  console.log("\nDone. Now run `npx prisma db push` — it should report no changes.\n");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
