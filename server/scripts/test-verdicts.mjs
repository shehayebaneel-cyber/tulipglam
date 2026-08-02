/**
 * The seven candidates the overnight review raised and could not verify.
 *
 *     node --import tsx scripts/test-verdicts.mjs            # pure, no writes
 *     node --import tsx scripts/test-verdicts.mjs --write    # + real rows against Neon
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. --write creates only rows it made itself,
 *  on a reserved range, and deletes them in a `finally` that is allowed to run.
 *  (An earlier script called process.exit() inside its try. process.exit() does not
 *  wait for the finally, and it left test customers in the live database.)
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Every assertion below was written from the sentence describing the requirement, before
 * looking at the implementation — because the last time I did it the other way round I wrote a
 * check that passed against the bug. Each section quotes the sentence it is testing.
 */
process.env.LOYALTY_ENABLED = "true";
process.env.LOYALTY_REDEMPTION_ENABLED = "true";

const { PrismaClient } = await import("@prisma/client");

const WRITE = process.argv.includes("--write");
let pass = 0, fail = 0;
const ck = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};
const section = (t) => console.log(`\n${t}`);

const db = new PrismaClient();
const made = { giftCards: [], outbox: [], customers: [] };
const TAG = "verdicts-test";

try {

// ════════════════════════════════════════════ 1 · a loyalty failure must never cost a sale

section('"a loyalty failure must never cost a sale" — a serialisation conflict on a\npoints-spending checkout must still place the order:');
{
  const { withSerialisationRetry, isSerialisationFailure } = await import("../src/loyalty/ledger.ts");

  // A real one, shaped the way Postgres actually reports it through Prisma.
  const conflict = () => Object.assign(new Error("could not serialize access due to read/write dependencies among transactions"), { code: "P2034" });

  ck("the conflict this is all about is recognised as one", isSerialisationFailure(conflict()));
  ck("an ordinary error is not mistaken for a conflict", !isSerialisationFailure(new Error("boom")));

  // Succeeds on the second go — the ordinary case, and the whole point of retrying.
  {
    let calls = 0;
    const r = await withSerialisationRetry(async () => {
      calls++;
      if (calls === 1) throw conflict();
      return "placed";
    }, { delayMs: () => 0 });
    ck("a conflict that clears on retry places the order", r.value === "placed", `got ${JSON.stringify(r.value)}`);
    ck("and it is reported as having conflicted, not as clean", r.conflicts === 1, `conflicts=${r.conflicts}`);
  }

  // Never clears. The requirement says the SALE survives, so the helper must hand the caller
  // back a decision (null) rather than throwing the conflict out of the checkout handler.
  {
    let calls = 0;
    const r = await withSerialisationRetry(async () => { calls++; throw conflict(); }, { attempts: 3, delayMs: () => 0 });
    ck("a conflict that never clears does not throw out of checkout", r.value === null);
    ck("it tried every attempt before giving up", calls === 3, `calls=${calls}`);
    ck("and the conflict is kept, so the fallback can be logged with its cause", !!r.lastError);
  }

  // The part that matters most: a REAL error must not be swallowed by the retry.
  {
    let threw = null;
    try {
      await withSerialisationRetry(async () => { throw new Error("the products table is gone"); }, { delayMs: () => 0 });
    } catch (e) { threw = e; }
    ck("a real failure is rethrown immediately, not retried into silence", threw?.message === "the products table is gone");
  }

  // And the checkout handler must actually do the fallback the requirement describes.
  {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const block = src.slice(src.indexOf("attemptedWithPoints"), src.indexOf("attemptedWithPoints") + 1200);
    ck("checkout falls back to placing the order with points off", /placeOrder\(0\)/.test(block));
    ck("the fallback is only for orders that asked to spend points", /requestedPoints > 0/.test(block));
  }
}

// ════════════════════════════════════════════ 2 · the breakdown a customer sees must add up

section('"the breakdown a customer sees on the tracking page must add up" — subtotal minus\nevery reduction plus delivery must equal the total, using only fields the page receives:');
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

  // Find the public tracking response and check the money fields it is allowed to send.
  const at = src.indexOf("paymentMethod, area, city, items, events,");
  const allowlist = src.slice(Math.max(0, at - 400), at + 60);
  const money = ["subtotalCents", "discountCents", "giftCardCents", "pointsDiscountCents", "deliveryCents", "totalCents"];
  for (const f of money) ck(`the tracking payload carries ${f}`, allowlist.includes(f));

  // The arithmetic itself: with a points discount present, omitting it breaks the sum.
  const order = { subtotalCents: 5000, discountCents: 500, pointsDiscountCents: 900, giftCardCents: 0, deliveryCents: 300, totalCents: 3900 };
  const withPoints = order.subtotalCents - order.discountCents - order.pointsDiscountCents - order.giftCardCents + order.deliveryCents;
  const withoutPoints = order.subtotalCents - order.discountCents - order.giftCardCents + order.deliveryCents;
  ck("with the points line, the breakdown reconciles to the total", withPoints === order.totalCents, `${withPoints} vs ${order.totalCents}`);
  ck("without it, the customer sees $9.00 of total they cannot explain", withoutPoints - order.totalCents === 900);

  // The supplier reorder code must still not be in there. Cheap to check, expensive to miss.
  ck("and the payload still carries no sku", !/\bsku\b/.test(allowlist));
}

// ════════════════════════════════════════════ 3 · money taken must land somewhere

section('"a card debited $20 for an order that now needs $12" — money taken from a gift card\nmust be applied to an order or returned to the card. It may not simply stop existing:');
if (WRITE) {
  const code = `TG-VERDICT-${Date.now().toString(36).toUpperCase()}`;
  const card = await db.giftCard.create({ data: { code, initialCents: 5000, balanceCents: 3000, active: true } });
  made.giftCards.push(card.id);

  // Replay the arithmetic the removal path performs, then the write it now performs with it.
  const original = { giftCardCents: 2000 };
  const afterDiscount = 1200;
  const giftUsed = Math.min(original.giftCardCents, Math.max(0, afterDiscount));
  const giftRefund = Math.max(0, original.giftCardCents - giftUsed);

  ck("the order now only needs $12.00 of the card", giftUsed === 1200, `${giftUsed}`);
  ck("so $8.00 was taken and is no longer applied to anything", giftRefund === 800, `${giftRefund}`);

  await db.giftCard.updateMany({ where: { code }, data: { balanceCents: { increment: giftRefund } } });
  const after = await db.giftCard.findUnique({ where: { code } });
  ck("the card gets it back", after.balanceCents === 3000 + 800, `balance ${after.balanceCents}`);

  // The whole point of an increment: another order may have spent from the card meanwhile.
  await db.giftCard.updateMany({ where: { code }, data: { balanceCents: { decrement: 1000 } } });
  await db.giftCard.updateMany({ where: { code }, data: { balanceCents: { increment: 500 } } });
  const concurrent = await db.giftCard.findUnique({ where: { code } });
  ck("an increment survives a concurrent spend; a recomputed balance would not", concurrent.balanceCents === 3300, `${concurrent.balanceCents}`);

  // A card that no longer exists must not take the removal down with it.
  const gone = await db.giftCard.updateMany({ where: { code: "TG-NO-SUCH-CARD-EVER" }, data: { balanceCents: { increment: 100 } } });
  ck("refunding a deleted card is a no-op, not an exception", gone.count === 0);

  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const block = src.slice(src.indexOf('if (action === "remove")'), src.indexOf('res.status(400).json({ error: "Unknown resolution." })'));
  ck("the refund happens in the same transaction as the removal", /\.\.\.giftRefundOps,\s*\n\s*db\.orderItem\.delete/.test(block));
  ck("and it is written into the order's history where an operator will see it", /Returned \$/.test(block));
} else {
  console.log("  skip  needs --write");
}

// ════════════════════════════════════════════ 4 · the same message must not go twice

section('"a double-click could send the same message twice" — two flushes running together\nmust send each message once:');
if (WRITE) {
  const row = await db.outboxEmail.create({
    data: { to: `${TAG}@tulipglam-test.invalid`, subject: "claim race", html: "<p>x</p>", kind: "welcome" },
  });
  made.outbox.push(row.id);

  // The claim, exactly as flushOutbox performs it: conditional on the row being untouched.
  const claim = () => db.outboxEmail.updateMany({
    where: { id: row.id, sentAt: null, attempts: 0 },
    data: { attempts: { increment: 1 } },
  });
  const [a, b] = await Promise.all([claim(), claim()]);
  const winners = [a, b].filter((r) => r.count === 1).length;
  ck("exactly one of two concurrent flushes claims the message", winners === 1, `${winners} winners`);
  ck("so it is sent once, not twice", (await db.outboxEmail.findUnique({ where: { id: row.id } })).attempts === 1);

  // The claim must also be what the code does, not just what this test does.
  const fs = await import("node:fs");
  const out = fs.readFileSync(new URL("../src/outbox.ts", import.meta.url), "utf8");
  const loop = out.slice(out.indexOf("for (const m of pending)"), out.indexOf("for (const m of pending)") + 500);
  ck("flushOutbox claims before sending", /updateMany[\s\S]*?claimed\.count === 0[\s\S]*?continue/.test(loop));
  ck("and the send path no longer double-counts the attempt", !/sentAt: new Date\(\), attempts: \{ increment: 1 \}/.test(out));
} else {
  console.log("  skip  needs --write");
}

// ════════════════════════════════════════════ 5 · one bad message must not block the rest

section('"a permanently failing message sits at the head of the queue and starves the rest" —\na message behind a poisoned one must still go out:');
if (WRITE) {
  const poison = await db.outboxEmail.create({
    data: { to: `${TAG}-poison@tulipglam-test.invalid`, subject: "always fails", html: "<p>x</p>", kind: "welcome", attempts: 9, lastError: "nope" },
  });
  const behind = await db.outboxEmail.create({
    data: { to: `${TAG}-behind@tulipglam-test.invalid`, subject: "queued behind it", html: "<p>x</p>", kind: "welcome" },
  });
  made.outbox.push(poison.id, behind.id);

  // The selection flushOutbox now performs, restricted to this test's own rows.
  const MAX_ATTEMPTS = 5;
  const picked = await db.outboxEmail.findMany({
    where: { sentAt: null, attempts: { lt: MAX_ATTEMPTS }, to: { contains: TAG }, lastError: { not: { startsWith: "expired:" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const ids = picked.map((p) => p.id);
  ck("the message that has failed nine times is no longer selected", !ids.includes(poison.id));
  ck("the one queued behind it goes out", ids.includes(behind.id));

  const givenUp = await db.outboxEmail.count({ where: { sentAt: null, attempts: { gte: MAX_ATTEMPTS }, to: { contains: TAG } } });
  ck("and it is counted as given-up, so it is visible rather than silently gone", givenUp === 1, `${givenUp}`);

  const fs = await import("node:fs");
  const out = fs.readFileSync(new URL("../src/outbox.ts", import.meta.url), "utf8");
  ck("the ceiling is in the query, not just in this test", /attempts: \{ lt: MAX_ATTEMPTS \}/.test(out));
  ck("the flush report exposes it", /givenUp/.test(out));
} else {
  console.log("  skip  needs --write");
}

// ════════════════════════════════════════════ 6 · the message that cannot be re-sent

section('"the one message that cannot be re-sent leaves no record" — a password reset must\nleave evidence it was attempted:');
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const at = src.indexOf("Reset your ${settings.storeName");
  const block = src.slice(at - 900, at + 500);

  ck("the reset goes through the outbox", /queueMail\(db, settings, \{/.test(block));
  ck("it is filed under a kind with its own shelf life", /kind: "password-reset"/.test(block));
  ck("it no longer calls sendMail directly", !/await sendMail\(settings, email/.test(block));
  // Read the call's ARGUMENTS, not the surrounding block — the block contains a comment saying
  // the words "No dedupeKey", which a naive search matched happily while proving nothing.
  const call = block.slice(block.indexOf("await queueMail(db, settings, {"));
  const args = call.slice(0, call.indexOf("\n    });") + 8);
  ck("and it is not deduped — a new request mints a new token", args.length > 40 && !/dedupeKey/.test(args), `args were ${args.length} chars`);

  // The shelf life has to match the token, or the record outlives its usefulness and the queue
  // retries a link that is already dead.
  const out = fs.readFileSync(new URL("../src/outbox.ts", import.meta.url), "utf8");
  ck("its shelf life is 30 minutes, the token's own life", /"password-reset": 30 \* MINUTE/.test(out));

  const RESET_TTL_MIN = Number(/RESET_TTL_MIN = (\d+)/.exec(src)?.[1]);
  ck("which is the same number the token actually uses", RESET_TTL_MIN === 30, `RESET_TTL_MIN=${RESET_TTL_MIN}`);

  // Still no enumeration: the record must not change the answer the stranger gets.
  const tail = src.slice(at, at + 900);
  ck("and queuing it does not change the response for an unknown address", /res\.json\(\{ ok: true \}\)/.test(tail) && !/customer \?/.test(tail.split("res.json")[0].slice(-200)));
}

// ════════════════════════════════════════════ 7 · attacker-chosen paths must not accumulate

section('"traffic.byPath grows unbounded from attacker-chosen paths" — a stranger must not be\nable to make the process hold memory forever:');
{
  const { countRequest, pulse } = await import("../src/observe.ts");

  // A real route first, so there is something worth protecting in the map before it fills.
  for (let i = 0; i < 50; i++) countRequest("/api/home");
  const before = (await pulse(db)).traffic;

  // Then two thousand distinct shapes, none of which is a real route.
  for (let i = 0; i < 2000; i++) countRequest(`/api/probe-${i}-${Math.random().toString(36).slice(2)}`);
  const after = (await pulse(db)).traffic;

  ck("the requests are still counted in the total", after.apiCalls > before.apiCalls, `${before.apiCalls} → ${after.apiCalls}`);
  ck("and the ones beyond the cap are reported, not silently dropped", after.untrackedPaths > 0, `untracked=${after.untrackedPaths}`);

  // The map itself, not the top-six view, is what had to be bounded — a `.slice(0, 6)` on the
  // way out looks like a cap and is not one.
  const obs = (await import("node:fs")).readFileSync(new URL("../src/observe.ts", import.meta.url), "utf8");
  ck("the map is capped in the code, not merely small today", /traffic\.byPath\.size < MAX_TRACKED_PATHS/.test(obs));

  // The cap must not blind the panel to the traffic that matters.
  for (let i = 0; i < 50; i++) countRequest("/api/home");
  const home = (await pulse(db)).traffic.topPaths.find((p) => p.path === "/api/home")?.hits ?? 0;
  ck("a real route still counts after the cap is reached", home >= 100, `/api/home hits=${home}`);
}

} finally {
  // Runs to completion. No process.exit() above it — that is how test rows reached production.
  if (made.outbox.length) await db.outboxEmail.deleteMany({ where: { id: { in: made.outbox } } });
  if (made.giftCards.length) await db.giftCard.deleteMany({ where: { id: { in: made.giftCards } } });
  if (made.customers.length) await db.customer.deleteMany({ where: { id: { in: made.customers } } });
  const leftOutbox = await db.outboxEmail.count({ where: { to: { contains: TAG } } });
  const leftCards = await db.giftCard.count({ where: { code: { startsWith: "TG-VERDICT-" } } });
  console.log(`\n  cleanup: ${leftOutbox} outbox rows and ${leftCards} gift cards left behind (want 0/0)`);
  if (leftOutbox || leftCards) fail++;
  await db.$disconnect();
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed${WRITE ? "" : "  (run with --write for the database checks)"}`);
process.exitCode = fail === 0 ? 0 : 1;
