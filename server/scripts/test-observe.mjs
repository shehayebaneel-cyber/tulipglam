/**
 * Observability — knowing what is happening, without a tracker on the storefront.
 *
 *     node --import tsx scripts/test-observe.mjs --write
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  Writes ErrorLog rows with a reserved test path and deletes them.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * The behaviour worth protecting is GROUPING. A row per occurrence means one broken loop fills
 * the table and buries everything else; the dashboard then shows four thousand symptoms instead
 * of five problems.
 */
const { PrismaClient } = await import("@prisma/client");
const { recordError, routeShape, fingerprintOf, pulse, recentErrors, resolveError } = await import("../src/observe.ts");

const db = new PrismaClient();
let pass = 0, fail = 0;
const ck = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${ok ? "" : "  " + x}`); };
const TEST_PATH = "/api/__observe_test__";

try {
  console.log("\nPaths collapse so one broken route is one problem:");
  ck("order numbers collapse", routeShape("/api/orders/TG-A1B2C3") === "/api/orders/:orderNumber", routeShape("/api/orders/TG-A1B2C3"));
  ck("  ...whatever the number", routeShape("/api/orders/TG-A1B2C3") === routeShape("/api/orders/TG-ZZZ999"));
  ck("numeric ids collapse", routeShape("/api/admin/loyalty/accounts/412") === "/api/admin/loyalty/accounts/:id", routeShape("/api/admin/loyalty/accounts/412"));
  ck("long opaque segments collapse", routeShape("/api/auth/reset/" + "a".repeat(40)) === "/api/auth/reset/:token");
  ck("ordinary paths are left alone", routeShape("/api/site") === "/api/site");

  console.log("\nThe same failure is one row, counted:");
  const err = new TypeError("cannot read properties of null (reading 'id')");
  for (let i = 0; i < 5; i++) await recordError(db, { method: "GET", path: `${TEST_PATH}/${i}`, status: 500, err });
  const rows = await db.errorLog.findMany({ where: { path: { startsWith: TEST_PATH } } });
  ck("five identical failures on five ids became ONE row", rows.length === 1, `${rows.length} rows`);
  ck("  ...with a count of 5", rows[0]?.count === 5, String(rows[0]?.count));
  ck("  ...and the path collapsed", rows[0]?.path === `${TEST_PATH}/:id`, rows[0]?.path);
  ck("  ...keeping a stack to find the line", (rows[0]?.stack ?? "").includes("TypeError"));

  console.log("\nA different failure is a different row:");
  await recordError(db, { method: "GET", path: `${TEST_PATH}/9`, status: 500, err: new RangeError("out of range") });
  const two = await db.errorLog.findMany({ where: { path: { startsWith: TEST_PATH } } });
  ck("now there are two distinct problems", two.length === 2, String(two.length));

  console.log("\nDealing with one hides it — until it happens again:");
  const first = two.find((r) => r.message.includes("cannot read"));
  await resolveError(db, first.id);
  const afterResolve = await db.errorLog.findUnique({ where: { id: first.id } });
  ck("it is marked resolved", afterResolve.resolvedAt !== null);
  await recordError(db, { method: "GET", path: `${TEST_PATH}/1`, status: 500, err });
  const reopened = await db.errorLog.findUnique({ where: { id: first.id } });
  ck("a recurrence REOPENS it — something broken again is news", reopened.resolvedAt === null);
  ck("  ...and the count kept climbing", reopened.count === 6, String(reopened.count));

  console.log("\nThe dashboard reads in one round trip:");
  const p = await pulse(db);
  ck("it reports open errors", p.openErrors >= 1, String(p.openErrors));
  ck("  ...orders, signups and revenue together", typeof p.ordersToday === "number" && typeof p.signupsTotal === "number" && typeof p.revenueTodayCents === "number");
  ck("  ...the outbox backlog", typeof p.outboxWaiting === "number");
  ck("  ...and traffic counted in memory", typeof p.traffic.pageViews === "number" && p.traffic.since instanceof Date);
  const list = await recentErrors(db);
  ck("recent errors put the unresolved first", list.length > 0 && !list[0].resolvedAt);
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 4).join("\n        ")}`);
} finally {
  await db.errorLog.deleteMany({ where: { path: { startsWith: TEST_PATH } } });
  await db.$disconnect();
  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}
