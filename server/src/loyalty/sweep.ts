/**
 * The sweep: make the stored ledger rows agree with what the rules already say.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────────────
 *
 * It is not a cron job that grants points, and nothing customer-facing waits on it. Every
 * balance, tier and expiry is derived at read time; this only writes those conclusions down.
 * A customer whose account is never swept sees the same numbers as one swept hourly — there is
 * a test that asserts exactly that (`sweepChangesNothing`).
 *
 * It exists because the DATABASE should eventually agree with the reports: admin queries, CSV
 * exports and a dispute a year later all read rows, not derivations. Render's free tier spins
 * down and there is no reliable scheduler, so this is an endpoint anything can poke — an
 * external uptime pinger, a laptop, a phone — rather than a process that must stay alive.
 *
 * ── BOUNDED ON PURPOSE ─────────────────────────────────────────────────────────────
 *
 * One call does a limited number of accounts and reports what it left behind. An unbounded
 * sweep over a growing table on a free-tier instance is a request that eventually always times
 * out, which is the same as a sweep that never runs, except harder to notice.
 */
import type { PrismaClient } from "@prisma/client";
import { RATES, DELIVERED_STATUSES } from "./config.js";
import { materialise } from "./ledger.js";
import { addDays, addMonths } from "./rules.js";

/**
 * Accounts touched per call. Small enough to finish inside a cold-start request budget.
 *
 * **Not a Neon accommodation** — this one is about Render, and about any HTTP endpoint wanting
 * bounded work. It survives the flake verdict of 3 Aug (see `runSweep`) untouched, and retires
 * with Render rather than with Neon.
 */
const BATCH = 40;

export type SweepReport = {
  scanned: number;
  confirmed: number;
  expiredPoints: number;
  tiersChanged: number;
  failed: number;
  /** Accounts still owed work after this call. Non-zero means: call it again. */
  remaining: number;
};

/**
 * Which accounts have work waiting.
 *
 * Two sources, and neither needs a queue table:
 *
 *   1. Pending earns whose order was delivered long enough ago to have matured.
 *   2. Accounts whose last confirmed activity is old enough that the balance has lapsed.
 *
 * Both are plain queries over facts already stored, so a sweep that has never run and a sweep
 * that runs constantly find the same accounts.
 */
async function accountsNeedingWork(db: PrismaClient, now: Date, take: number): Promise<number[]> {
  const matured = addDays(now, -RATES.holdDaysAfterDelivery);

  const ready = await db.loyaltyLedgerEntry.findMany({
    where: {
      status: "pending",
      type: "earn",
      order: { status: { in: [...DELIVERED_STATUSES] }, deliveredAt: { not: null, lte: matured } },
    },
    select: { accountId: true },
    distinct: ["accountId"],
    take,
  });

  const ids = new Set(ready.map((r) => r.accountId));
  if (ids.size >= take) return [...ids];

  // Lapse candidates: a confirmed entry older than the expiry window, on an account that still
  // shows a positive cached balance. `balanceCached` is only a hint here — `materialise` re-reads
  // and decides — but it is a cheap way to skip accounts that plainly have nothing to lose.
  const stale = await db.loyaltyLedgerEntry.findMany({
    where: {
      status: "confirmed",
      type: { in: ["earn", "redeem"] },
      confirmedAt: { not: null, lte: addMonths(now, -RATES.expiryMonths) },
      account: { balanceCached: { gt: 0 } },
    },
    select: { accountId: true },
    distinct: ["accountId"],
    take: take - ids.size,
  });
  for (const s of stale) ids.add(s.accountId);

  return [...ids];
}

/**
 * Materialise a batch. One account's failure does not stop the rest.
 *
 * Sequential rather than parallel, and it STAYS sequential — but for one reason now, not two.
 *
 * ── THE FLAKE VERDICT, 3 Aug 2026 ──────────────────────────────────────────────────
 *
 * `test-redemption.mjs` flaked intermittently against Neon and the standing theory was its
 * free-tier connection ceiling. Settled by experiment: 20 controlled runs against a local
 * Postgres 16.4, **20 passed, 0 failed**, where the same suite had lost 13 of 17 sibling suites
 * when a second process was holding pools against Neon. The ceiling is confirmed.
 *
 * So the first justification below is dead, and it is struck:
 *
 *   ~~Neon's free tier has a small connection pool, and forty concurrent transactions would
 *   spend longer contending than they save.~~  Confirmed as the flake's cause; retires with Neon.
 *
 * ── WHAT THE VERDICT DID NOT TOUCH ─────────────────────────────────────────────────
 *
 * It keeps serialisation pressure off `redeem()`, **which matters because a customer is waiting
 * on that and nobody is waiting on this.** That is true on Neon, on a local Postgres, and on the
 * Hetzner box. The experiment measured the sweep in isolation; it never measured a sweep racing
 * a checkout, which is the case this protects.
 *
 * The deletion was pre-approved on a positive verdict, and the verdict is positive. It is not
 * being executed, because the approval rested on these being Neon accommodations and only one of
 * them was. Parallelising this would trade nothing for a customer's checkout contending with a
 * cache refresh that no one is waiting for. If that trade is wanted anyway, it is one line.
 */
export async function runSweep(db: PrismaClient, now = new Date()): Promise<SweepReport> {
  const ids = await accountsNeedingWork(db, now, BATCH + 1);
  const batch = ids.slice(0, BATCH);

  const report: SweepReport = {
    scanned: batch.length, confirmed: 0, expiredPoints: 0,
    tiersChanged: 0, failed: 0, remaining: Math.max(0, ids.length - BATCH),
  };

  for (const accountId of batch) {
    try {
      const r = await materialise(db, accountId, now);
      report.confirmed += r.confirmed;
      report.expiredPoints += r.expiredPoints;
      if (r.tierChanged) report.tiersChanged++;
    } catch (e) {
      report.failed++;
      console.error(`[loyalty] sweep failed for account ${accountId}:`, e instanceof Error ? e.message : e);
    }
  }

  return report;
}
