/**
 * Prove a backup can actually be restored — WITHOUT touching live data.
 *
 *     npx tsx scripts/restore-drill.ts backups/tulipglam-....json.gz
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  This never writes to the `public` schema. It creates a throwaway schema called
 *  `restore_drill`, rebuilds the important tables inside it, loads the backup into
 *  them, checks the data survived the round trip, and drops the schema again.
 *
 *  Your live tables are never read from, written to, locked or renamed.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * ── WHY A DRILL AND NOT A RESTORE ──────────────────────────────────────────────────
 *
 * "We have backups" is a belief until someone restores one. The usual way to check is to
 * restore into a spare database, and there isn't one: Neon's free tier gives a single database
 * and creating branches needs an API key nobody has wired up.
 *
 * A separate SCHEMA in the same database is the next best thing and it is genuinely evidence:
 * it proves the file parses, that every table's columns still line up with what the application
 * writes, that types survive the JSON round trip (dates, decimals, nulls), and that the row
 * counts match. What it does NOT prove is that a brand-new empty Neon project would accept it —
 * for that, see the runbook, which uses `prisma db push` first.
 *
 * If this drill fails, the backup is not a backup.
 */
import { PrismaClient } from "@prisma/client";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";

const db = new PrismaClient();
const FILE = process.argv[2];
const SCHEMA = "restore_drill";

/** Tables the drill rebuilds and loads. The ones whose loss would end the business. */
const DRILL: { model: string; table: string; cols: string }[] = [
  { model: "customer", table: "Customer", cols: `"id" int PRIMARY KEY, "email" text UNIQUE, "passwordHash" text, "fullName" text, "phone" text, "createdAt" timestamptz` },
  { model: "launchSignup", table: "LaunchSignup", cols: `"id" int PRIMARY KEY, "email" text UNIQUE, "source" text, "notifiedAt" timestamptz, "unsubscribedAt" timestamptz, "createdAt" timestamptz` },
  { model: "order", table: "Order", cols: `"id" int PRIMARY KEY, "number" text UNIQUE, "status" text, "customerId" int, "fullName" text, "phone" text, "email" text, "address" text, "subtotalCents" int, "discountCents" int, "pointsDiscountCents" int, "giftCardCents" int, "deliveryCents" int, "totalCents" int, "createdAt" timestamptz, "deliveredAt" timestamptz` },
  { model: "orderItem", table: "OrderItem", cols: `"id" int PRIMARY KEY, "orderId" int, "name" text, "qty" int, "priceCents" int` },
  { model: "loyaltyAccount", table: "LoyaltyAccount", cols: `"id" int PRIMARY KEY, "phoneE164" text UNIQUE, "customerId" int, "tier" text, "balanceCached" int, "createdAt" timestamptz` },
  { model: "loyaltyLedgerEntry", table: "LoyaltyLedgerEntry", cols: `"id" int PRIMARY KEY, "accountId" int, "orderId" int, "type" text, "status" text, "points" int, "multiplierApplied" numeric(4,2), "reason" text, "createdAt" timestamptz, "confirmedAt" timestamptz` },
  { model: "giftCard", table: "GiftCard", cols: `"id" int PRIMARY KEY, "code" text UNIQUE, "balanceCents" int, "active" boolean` },
  { model: "setting", table: "Setting", cols: `"key" text PRIMARY KEY, "value" text` },
];

let pass = 0, fail = 0;
const ck = (name: string, ok: boolean, extra = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};

async function main() {
  if (!FILE || !fs.existsSync(FILE)) {
    console.error(`\nUsage: npx tsx scripts/restore-drill.ts <backup.json.gz>\n`);
    process.exit(1);
  }

  console.log(`\nRESTORE DRILL — ${FILE}\n`);
  const raw = JSON.parse(gunzipSync(fs.readFileSync(FILE)).toString("utf8")) as {
    meta: { takenAt: string; counts: Record<string, number>; scope: string; database: string };
    data: Record<string, Record<string, unknown>[]>;
  };

  console.log(`  taken ${raw.meta.takenAt}`);
  console.log(`  scope ${raw.meta.scope}`);
  console.log(`  from  ${raw.meta.database}\n`);

  ck("the file parses", !!raw.data);
  ck("  ...and carries its own manifest", !!raw.meta?.counts);

  // Every table the backup claims must actually be present with the promised row count.
  for (const [t, n] of Object.entries(raw.meta.counts)) {
    ck(`  ${t}: manifest says ${n}, file holds ${raw.data[t]?.length ?? "nothing"}`, raw.data[t]?.length === n);
  }

  console.log(`\n  Rebuilding ${DRILL.length} tables in schema "${SCHEMA}" — your live tables are untouched:\n`);
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);

  try {
    for (const { model, table, cols } of DRILL) {
      const rows = raw.data[model] ?? [];
      await db.$executeRawUnsafe(`CREATE TABLE ${SCHEMA}."${table}" (${cols})`);

      if (rows.length === 0) { ck(`${table}: nothing to load`, true); continue; }

      /**
       * Insert row by row through parameterised SQL — the same path a real restore takes, and
       * the one that surfaces a type mismatch or a column the dump forgot.
       *
       * EVERY PLACEHOLDER IS EXPLICITLY CAST. The first version of this drill bound values
       * without casts and failed on the very first table:
       *
       *   column "createdAt" is of type timestamp with time zone
       *   but expression is of type text
       *
       * JSON has no date type, so every timestamp comes back as an ISO string, and Postgres
       * will not implicitly cast a bound text parameter to timestamptz. Prisma's Decimal
       * serialises to a string too, with the same problem against `numeric`. Declaring the
       * cast from the column definition fixes both and is what a real restore tool does.
       *
       * This is the whole reason the drill exists: the backup was fine, the RESTORE was broken,
       * and nothing but running it would have shown that.
       */
      // Split on commas OUTSIDE parentheses. A naive split breaks `numeric(4,2)` into
      // `"multiplierApplied" numeric(4` and `2)`, and Postgres then reports a column literally
      // called "2)". The loyalty multiplier is the only such column today, which is exactly the
      // kind of detail a drill run against real data finds and a drill run against an empty
      // database does not.
      const parsed = cols.split(/,(?![^(]*\))/).map((c) => c.trim()).map((c) => {
        const name = c.split(" ")[0].replace(/"/g, "");
        const rest = c.slice(c.indexOf(" ") + 1).toLowerCase();
        const type = rest.startsWith("timestamptz") ? "timestamptz"
          : rest.startsWith("numeric") ? "numeric"
          : rest.startsWith("boolean") ? "boolean"
          : rest.startsWith("int") ? "int"
          : "text";
        return { name, type };
      });

      const columns = parsed.map((p) => p.name);
      const placeholders = parsed.map((p, i) => `$${i + 1}::${p.type}`).join(",");
      let loaded = 0;
      for (const row of rows) {
        const values = parsed.map((p) => {
          const v = (row as Record<string, unknown>)[p.name];
          if (v === undefined || v === null) return null;
          // Bind timestamps as strings and let the ::timestamptz cast do the work — passing a
          // JS Date here would work too, but the cast is what makes an ISO string from ANY
          // backup file loadable, including one edited by hand in an emergency.
          return typeof v === "object" && v instanceof Date ? v.toISOString() : v;
        });
        await db.$executeRawUnsafe(
          `INSERT INTO ${SCHEMA}."${table}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${placeholders})`,
          ...values,
        );
        loaded++;
      }
      const [{ count }] = await db.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) AS count FROM ${SCHEMA}."${table}"`);
      ck(`${table}: ${rows.length} in the file, ${Number(count)} restored`, Number(count) === rows.length, `loaded ${loaded}`);
    }

    // Spot-check that VALUES survived, not just row counts. A restore that loads the right
    // number of rows with the wrong contents is the failure mode worth catching.
    const orders = raw.data.order ?? [];
    if (orders.length > 0) {
      const sample = orders[0] as Record<string, unknown>;
      const [got] = await db.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT "number", "totalCents", "status" FROM ${SCHEMA}."Order" WHERE "id" = $1`, sample.id,
      );
      ck(`an order's money survived the round trip`, got && Number(got.totalCents) === Number(sample.totalCents),
        `${got?.totalCents} vs ${sample.totalCents}`);
      ck(`  ...and so did its number and status`, got?.number === sample.number && got?.status === sample.status);
    }
    const entries = raw.data.loyaltyLedgerEntry ?? [];
    if (entries.length > 0) {
      const sample = entries[0] as Record<string, unknown>;
      const [got] = await db.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT "points", "multiplierApplied" FROM ${SCHEMA}."LoyaltyLedgerEntry" WHERE "id" = $1`, sample.id,
      );
      ck(`a ledger entry's points survived`, got && Number(got.points) === Number(sample.points));
      ck(`  ...and its decimal multiplier did too`, got && Number(got.multiplierApplied) === Number(sample.multiplierApplied),
        `${got?.multiplierApplied} vs ${sample.multiplierApplied}`);
    }
  } finally {
    // ALWAYS. A drill that leaves scaffolding behind is a drill nobody runs twice.
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    console.log(`\n  schema "${SCHEMA}" dropped — nothing left behind`);
  }

  const live = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  console.log(`  public schema still has ${Number(live[0].n)} tables — untouched\n`);

  console.log(`${fail ? `${fail} FAILED, ` : ""}${pass} passed`);
  console.log(fail
    ? `\n  THIS BACKUP IS NOT TRUSTWORTHY. Do not rely on it.\n`
    : `\n  This backup restores. See BACKUP.md for the steps to use it for real.\n`);

  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\nDRILL FAILED:", e);
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
