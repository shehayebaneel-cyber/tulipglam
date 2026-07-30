/**
 * End-to-end check of the password-reset flow, driven through the HTTP API.
 *
 *     node scripts/test-password-reset.mjs             # read-only checks
 *     node scripts/test-password-reset.mjs --write     # + the full ticket lifecycle
 *
 * The server must already be running on PORT (default 4230).
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production.
 *
 *  Without --write this only sends requests that are rejected, so nothing is stored.
 *  With --write it creates ONE throwaway customer on a `.invalid` domain, exercises the
 *  lifecycle against it, and deletes it in a `finally`. It never reads, updates or deletes
 *  any row it did not create.
 * ══════════════════════════════════════════════════════════════════════════════════
 */
import { createHash, randomUUID } from "node:crypto";

const BASE = `http://localhost:${process.env.PORT ?? 4230}/api`;
const WRITE = process.argv.includes("--write");

const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};

// ---------------------------------------------------------------- read-only
console.log("\nRejections (nothing is written):");

// The whole flow is the email, so with no SMTP the endpoint must refuse rather than
// accept the address and quietly send nothing.
const forgot = await post("/auth/forgot", { email: "nobody@example.invalid" });
if (forgot.status === 503) {
  check("forgot refuses when mail isn't configured", true);
  check("  ...and explains why", /isn.t set up/i.test(forgot.body.error ?? ""), forgot.body.error);
} else {
  // Mail IS configured — then the answer must be identical for any address, so that this
  // endpoint can't be used to discover which addresses have accounts.
  check("forgot accepts without confirming the address exists", forgot.status === 200, JSON.stringify(forgot.body));
}

check("reset rejects an unknown token",
  await post("/auth/reset", { token: "not-a-real-token", password: "abcdef" }).then((r) => r.status === 400 && /isn.t valid/i.test(r.body.error ?? "")));
check("reset rejects a missing token",
  await post("/auth/reset", { token: "", password: "abcdef" }).then((r) => r.status === 400 && /incomplete/i.test(r.body.error ?? "")));
check("reset rejects a short password before spending the token",
  await post("/auth/reset", { token: "x", password: "abc" }).then((r) => r.status === 400 && /at least 6/i.test(r.body.error ?? "")));

// ---------------------------------------------------------------- lifecycle
if (!WRITE) {
  console.log("\n  (ticket lifecycle skipped — pass --write to run it against a throwaway account)");
} else {
  console.log("\nTicket lifecycle (one throwaway account, deleted at the end):");
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const hash = (t) => createHash("sha256").update(t).digest("hex");
  const email = `reset-test-${randomUUID().slice(0, 8)}@tulipglam-test.invalid`;

  try {
    const reg = await post("/auth/register", { fullName: "Reset Test", email, password: "original123" });
    check("throwaway account created", reg.status === 200 && !!reg.body.token, JSON.stringify(reg.body).slice(0, 120));
    if (reg.status !== 200) throw new Error("cannot continue without the test account");
    const customerId = reg.body.customer.id;

    const good = randomUUID() + randomUUID();
    await db.passwordReset.create({ data: { customerId, tokenHash: hash(good), expiresAt: new Date(Date.now() + 600_000) } });

    const used = await post("/auth/reset", { token: good, password: "brandnew456" });
    check("a valid link resets the password and signs in", used.status === 200 && !!used.body.token, JSON.stringify(used.body).slice(0, 120));
    check("the old password stops working",
      await post("/auth/login", { email, password: "original123" }).then((r) => r.status === 401));
    check("the new password works",
      await post("/auth/login", { email, password: "brandnew456" }).then((r) => r.status === 200));

    // A used link must say it was used. "Invalid" would send someone hunting for a typo.
    const replay = await post("/auth/reset", { token: good, password: "third789xyz" });
    check("the same link can't be used twice", replay.status === 400 && /already been used/i.test(replay.body.error ?? ""), replay.body.error);

    const stale = randomUUID() + randomUUID();
    await db.passwordReset.create({ data: { customerId, tokenHash: hash(stale), expiresAt: new Date(Date.now() - 1000) } });
    const expired = await post("/auth/reset", { token: stale, password: "another999" });
    check("an expired link is refused as expired", expired.status === 400 && /expired/i.test(expired.body.error ?? ""), expired.body.error);

    // A leaked database must not hand out working reset links.
    const rows = await db.passwordReset.findMany({ where: { customerId } });
    check("only token hashes are stored, never the token",
      rows.length > 0 && rows.every((r) => r.tokenHash !== good && r.tokenHash !== stale && r.tokenHash.length === 64));
  } finally {
    await db.passwordReset.deleteMany({ where: { customer: { email } } });
    await db.customer.deleteMany({ where: { email } });
    console.log(`  cleaned up ${email}`);
    await db.$disconnect();
  }
}

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exit(fail ? 1 : 0);
