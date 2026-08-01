/**
 * The email outbox — built dark, ready for the day credentials arrive.
 *
 *     node --import tsx scripts/test-outbox.mjs --write
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  Creates outbox rows on a reserved @tulipglam-test.invalid domain and deletes them.
 *  Never sends mail: SMTP is unconfigured and these tests pass empty settings.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * The behaviour worth protecting is the SHELF LIFE. Queue-and-flush is the obvious design and
 * the obvious version of it is wrong: flushing everything means an order confirmation arrives
 * three weeks after the parcel, and a password reset arrives after its own token expired. Each
 * kind ages differently, and the launch announcement does not age at all.
 */
const { PrismaClient } = await import("@prisma/client");
const { queueMail, flushOutbox, outboxStatus } = await import("../src/outbox.ts");

const db = new PrismaClient();
let pass = 0, fail = 0;
const ck = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${ok ? "" : "  " + x}`); };
const made = [];
const NO_SMTP = {};
const stamp = Date.now();

try {
  console.log("\nWith SMTP unconfigured — nothing is lost, nothing is sent:");
  const r = await queueMail(db, NO_SMTP, {
    to: "a@tulipglam-test.invalid", subject: "Order TG-1 received",
    html: "<p>hi</p>", kind: "order-confirmation", dedupeKey: `t-${stamp}`,
  });
  ck("the message is queued", r.queued === true);
  ck("  ...and explicitly NOT reported as sent", r.sent === false);
  const row = await db.outboxEmail.findFirst({ where: { dedupeKey: `t-${stamp}` } });
  made.push(row.id);
  ck("  ...with the whole rendered body stored, not a template reference", row.html === "<p>hi</p>");

  const dup = await queueMail(db, NO_SMTP, { to: "a@tulipglam-test.invalid", subject: "again", html: "x", kind: "order-confirmation", dedupeKey: `t-${stamp}` });
  ck("a repeated queue with the same key does not duplicate", dup.queued === true);
  ck("  ...exactly one row exists", (await db.outboxEmail.count({ where: { dedupeKey: `t-${stamp}` } })) === 1);

  console.log("\nShelf life differs by kind, because a late message is not always welcome:");
  const expect = [["password-reset", 30 / 1440], ["order-confirmation", 3], ["status-update", 2], ["points-confirmed", 14], ["welcome", 30]];
  for (const [kind, days] of expect) {
    const key = `k-${kind}-${stamp}`;
    await queueMail(db, NO_SMTP, { to: `k@tulipglam-test.invalid`, subject: kind, html: "x", kind, dedupeKey: key });
    const w = await db.outboxEmail.findFirst({ where: { dedupeKey: key } });
    made.push(w.id);
    const got = (w.expiresAt - w.createdAt) / 86400000;
    ck(`  ${kind.padEnd(18)} ${days === 30 / 1440 ? "30 minutes" : days + " days"}`, Math.abs(got - days) < 0.01, `got ${got.toFixed(3)} days`);
  }

  // The regression that matters. `SHELF_LIFE[kind] ?? default` treats an intentional null as
  // absent, so the launch announcement quietly got a 7-day life and would have expired unsent
  // before the store opened. It is the ONE message that must wait indefinitely.
  await queueMail(db, NO_SMTP, { to: "l@tulipglam-test.invalid", subject: "We're open", html: "x", kind: "launch", dedupeKey: `l-${stamp}` });
  const lrow = await db.outboxEmail.findFirst({ where: { dedupeKey: `l-${stamp}` } });
  made.push(lrow.id);
  ck("  launch             NEVER expires — it waits for a decision, not a delivery", lrow.expiresAt === null, String(lrow.expiresAt));

  console.log("\nFlushing while unconfigured is honest about it:");
  const f = await flushOutbox(db, NO_SMTP);
  ck("it reports not-configured rather than pretending", f.configured === false);
  ck("  ...sends nothing", f.sent === 0);
  ck("  ...and still counts what is waiting", f.remaining >= made.length, String(f.remaining));

  const st = await outboxStatus(db, NO_SMTP);
  ck("status breaks the backlog down by kind", st.byKind.length >= 4, JSON.stringify(st.byKind));
  ck("  ...and reports the age of the oldest, so a silent backlog is visible", st.oldestWaiting instanceof Date);
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 4).join("\n        ")}`);
} finally {
  await db.outboxEmail.deleteMany({ where: { to: { endsWith: "@tulipglam-test.invalid" } } });
  await db.$disconnect();
  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}
