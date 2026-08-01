/**
 * Backfill Order.deliveredAt from the order event history.
 *
 *     npx tsx scripts/backfill-delivered-at.ts            # report only, writes nothing
 *     npx tsx scripts/backfill-delivered-at.ts --write    # applies
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. --write is live immediately.
 *
 *  It only ever fills deliveredAt where it is currently NULL. It never overwrites a value,
 *  never touches status, and never touches an order that was already backfilled — so it is
 *  safe to run twice.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * WHY MIN(), NOT "the delivered event"
 *
 * `canTransition` returns true when from === to (status.ts), and the admin status endpoint
 * writes an OrderEvent unconditionally. So an admin re-saving "Delivered" — a double-click, a
 * second look at the same order — produces a SECOND delivered event with a later timestamp.
 * Taking the latest would silently push the 7-day loyalty maturity window back by however long
 * passed between the two clicks. The first one is when delivery actually happened.
 *
 * ORDERS WITH NO EVENT
 *
 * Every code path that writes Order.status also writes an OrderEvent, so this should find none.
 * If it does, they are LISTED rather than given a guessed date: inventing a delivery date sets
 * a customer's points maturing on a day nothing happened, and a wrong date here is invisible
 * afterwards. Decide those by hand.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const WRITE = process.argv.includes("--write");

/** Statuses that mean the parcel reached the customer. `completed` implies delivery happened. */
const DELIVERED_STATES = ["delivered", "completed"];

async function main() {
  const orders = await db.order.findMany({
    where: { status: { in: DELIVERED_STATES }, deliveredAt: null },
    select: { id: true, number: true, status: true, createdAt: true },
    orderBy: { id: "asc" },
  });

  const alreadyDone = await db.order.count({ where: { deliveredAt: { not: null } } });
  const total = await db.order.count();

  console.log(`\n${total} orders in total; ${alreadyDone} already have deliveredAt.`);
  console.log(`${orders.length} are ${DELIVERED_STATES.join("/")} and still need it.\n`);

  if (orders.length === 0) {
    console.log("Nothing to backfill.");
    await db.$disconnect();
    return;
  }

  // One query for every delivered event across the whole set, rather than a query per order.
  const events = await db.orderEvent.findMany({
    where: { orderId: { in: orders.map((o) => o.id) }, status: "delivered" },
    select: { orderId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // First delivered event per order — see the note above on why the first and not the last.
  const firstDelivered = new Map<number, Date>();
  const eventCount = new Map<number, number>();
  for (const e of events) {
    eventCount.set(e.orderId, (eventCount.get(e.orderId) ?? 0) + 1);
    if (!firstDelivered.has(e.orderId)) firstDelivered.set(e.orderId, e.createdAt);
  }

  const resolvable = orders.filter((o) => firstDelivered.has(o.id));
  const orphans = orders.filter((o) => !firstDelivered.has(o.id));
  const duplicated = [...eventCount.entries()].filter(([, n]) => n > 1);

  if (duplicated.length) {
    console.log(`${duplicated.length} order(s) have more than one 'delivered' event — the earliest is used:`);
    for (const [orderId, n] of duplicated.slice(0, 20)) {
      const o = orders.find((x) => x.id === orderId)!;
      console.log(`  ${o.number}  ${n} events, using ${firstDelivered.get(orderId)!.toISOString()}`);
    }
    console.log();
  }

  if (orphans.length) {
    console.log("─────────────────────────────────────────────────────────────────");
    console.log(`${orphans.length} order(s) are marked delivered but have NO delivered event.`);
    console.log("These are NOT being given a date — a guessed delivery date would mature a");
    console.log("customer's points on a day nothing happened, and be invisible afterwards.");
    console.log("Decide each by hand:\n");
    for (const o of orphans) {
      console.log(`  ${o.number}  status=${o.status}  placed ${o.createdAt.toISOString().slice(0, 10)}`);
    }
    console.log("─────────────────────────────────────────────────────────────────\n");
  }

  console.log(`${resolvable.length} order(s) can be backfilled:`);
  for (const o of resolvable.slice(0, 20)) {
    console.log(`  ${o.number}  -> ${firstDelivered.get(o.id)!.toISOString()}`);
  }
  if (resolvable.length > 20) console.log(`  … and ${resolvable.length - 20} more`);

  if (!WRITE) {
    console.log("\n───────────────────────────────────────────────────────────────");
    console.log("DRY RUN — nothing was written.");
    console.log("To apply:  npx tsx scripts/backfill-delivered-at.ts --write");
    console.log("───────────────────────────────────────────────────────────────\n");
    await db.$disconnect();
    return;
  }

  // Grouped by timestamp so this is a handful of statements rather than one per order.
  // `deliveredAt: null` in the where clause makes a concurrent run or a re-run a no-op.
  const byTime = new Map<number, number[]>();
  for (const o of resolvable) {
    const t = firstDelivered.get(o.id)!.getTime();
    byTime.set(t, [...(byTime.get(t) ?? []), o.id]);
  }

  let applied = 0;
  for (const [time, ids] of byTime) {
    const r = await db.order.updateMany({
      where: { id: { in: ids }, deliveredAt: null },
      data: { deliveredAt: new Date(time) },
    });
    applied += r.count;
  }

  console.log(`\nDone — ${applied} order(s) updated.`);
  if (orphans.length) console.log(`${orphans.length} left alone, listed above.`);
  await db.$disconnect();
}

main();
