/**
 * The coming-soon email capture, end to end.
 *
 *     node --import tsx scripts/test-launch-list.mjs            # pure + gate + auth
 *     node --import tsx scripts/test-launch-list.mjs --write    # + real rows against Neon
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. --write creates signups on a reserved
 *  @tulipglam-test.invalid domain and deletes every one of them.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * The thing this file exists to prove is the one the whole outcome rests on: a stranger, seeing
 * only the placeholder, with the gate ON, can leave an address and it lands somewhere the owner
 * can export. Everything else here is guarding that path.
 */
const { PrismaClient } = await import("@prisma/client");
const { spawn } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");
const { readFileSync } = await import("node:fs");

const WRITE = process.argv.includes("--write");
let pass = 0, fail = 0;
const ck = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ADMIN_KEY = "test-admin-key-long-enough-for-this";
const PREVIEW = "test-preview-key-long-enough-24-chars";

// ════════════════════════════════════════════════════ the address rules

section("What counts as an address:");
{
  const { normaliseEmail } = await import("../src/launchList.ts");
  ck("a plain address is kept", normaliseEmail("someone@example.com") === "someone@example.com");
  ck("case is folded", normaliseEmail("Someone@Example.COM") === "someone@example.com");
  ck("whitespace is trimmed", normaliseEmail("  a@b.co  ") === "a@b.co");
  ck("plus addressing survives", normaliseEmail("me+launch@gmail.com") === "me+launch@gmail.com");
  ck("subdomains survive", normaliseEmail("me@mail.example.co.uk") === "me@mail.example.co.uk");
  ck("a long TLD survives", normaliseEmail("me@example.photography") === "me@example.photography");

  ck("no @ is refused", normaliseEmail("nobody") === null);
  ck("two @ are refused", normaliseEmail("a@b@c.com") === null);
  ck("nothing before @ is refused", normaliseEmail("@example.com") === null);
  ck("a dotless domain is refused", normaliseEmail("a@localhost") === null);
  ck("a trailing dot is refused", normaliseEmail("a@example.com.") === null);
  ck("a double dot is refused", normaliseEmail("a@ex..com") === null);
  ck("embedded whitespace is refused", normaliseEmail("a b@c.com") === null);
  ck("a non-string is refused", normaliseEmail(null) === null && normaliseEmail(42) === null);
  ck("something absurdly long is refused", normaliseEmail("a".repeat(250) + "@b.com") === null);
}

section("The page is wired to the endpoint:");
{
  const page = readFileSync(new URL("../../web/public/coming-soon.html", import.meta.url), "utf8");
  ck("signupEndpoint points at the API", /signupEndpoint:\s*"\/api\/launch-signup"/.test(page));
  ck("  ...and the page still POSTs JSON to it", /fetch\(CONFIG\.signupEndpoint/.test(page));
  const gate = readFileSync(new URL("../src/comingSoon.ts", import.meta.url), "utf8");
  ck("the gate allowlists it by EXACT path, not by prefix",
    /"\/api\/launch-signup"/.test(gate) && !/ALLOW_PREFIX[\s\S]{0,400}launch-signup/.test(gate));
}

// ════════════════════════════════════════════════════ against a real server, gate ON

const db = new PrismaClient();
const made = [];
const PORT = 4371;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: ROOT,
  env: {
    ...process.env, PORT: String(PORT),
    // THE GATE IS ON. That is the state the store is in tonight, and the state this has to
    // work in — a test with the gate off would prove nothing about tonight.
    COMING_SOON: "true", PREVIEW_KEY: PREVIEW,
    ADMIN_KEY, LOYALTY_ENABLED: "false", NODE_ENV: "development",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => { log += d; });
server.stderr.on("data", (d) => { log += d; });

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`${BASE}/api/health`)).ok; } catch { /* not up */ }
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  ck("a server with the gate ON boots", up, log.slice(-400));
  if (!up) throw new Error("server never came up");

  section("With the gate ON, a stranger still sees the placeholder:");
  {
    const home = await fetch(`${BASE}/`, { headers: { accept: "text/html", "sec-fetch-dest": "document" } });
    const html = await home.text();
    ck("the homepage is the placeholder", home.status === 200 && !html.includes('id="root"'));
    ck("  ...and it carries the signup form", html.includes('type="email"'));
    const shop = await fetch(`${BASE}/shop`, { headers: { accept: "text/html", "sec-fetch-dest": "document" } });
    ck("  ...and the real shop is still unreachable", !(await shop.text()).includes('id="root"'));
  }

  section("…and can leave an address:");
  {
    const stamp = Date.now().toString(36);
    const post = (body, headers = {}) => fetch(`${BASE}/api/launch-signup`, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    });

    const email = `stranger-${stamp}@tulipglam-test.invalid`;
    const r = await post({ email, source: "coming-soon" });
    ck("the endpoint answers 200 through the gate", r.status === 200, String(r.status));
    ck("  ...with nothing cacheable", r.headers.get("cache-control") === "no-store");

    if (WRITE) {
      const row = await db.launchSignup.findUnique({ where: { email } });
      if (row) made.push(row.id);
      ck("  ...and the address is stored", !!row, "no row found");
      ck("  ...with its source", row?.source === "coming-soon", row?.source);
      ck("  ...unnotified, so a later send can find it", row?.notifiedAt === null);
    }

    // The oracle test: same status, same body, whether or not we already had it.
    const again = await post({ email });
    const first = await (await post({ email: `fresh-${stamp}@tulipglam-test.invalid` })).text();
    if (WRITE) {
      const extra = await db.launchSignup.findUnique({ where: { email: `fresh-${stamp}@tulipglam-test.invalid` } });
      if (extra) made.push(extra.id);
    }
    ck("re-submitting a known address looks identical to a new one",
      again.status === 200 && (await again.text()) === first);

    const bad = await post({ email: "not-an-address" });
    ck("a malformed address also gets 200 — it tells a bot nothing", bad.status === 200);
    const empty = await post({});
    ck("a missing body does not crash the endpoint", empty.status === 200, String(empty.status));

    if (WRITE) {
      const junk = await db.launchSignup.count({ where: { email: { in: ["not-an-address", ""] } } });
      ck("  ...and nothing junk was stored", junk === 0, `${junk} junk rows`);
    }
  }

  section("The list is admin-only:");
  {
    const noKey = await fetch(`${BASE}/api/admin/launch-signups`);
    ck("no admin key is refused", noKey.status === 401, String(noKey.status));
    const wrong = await fetch(`${BASE}/api/admin/launch-signups`, { headers: { "x-admin-key": "nope" } });
    ck("a wrong key is refused", wrong.status === 401);
    const csvNoKey = await fetch(`${BASE}/api/admin/launch-signups.csv`);
    ck("the export is refused too", csvNoKey.status === 401);

    const ok = await fetch(`${BASE}/api/admin/launch-signups`, { headers: { "x-admin-key": ADMIN_KEY } });
    ck("the right key works", ok.status === 200, String(ok.status));
    const stats = await ok.json();
    ck("  ...and reports counts the owner can act on",
      typeof stats.total === "number" && typeof stats.today === "number" && Array.isArray(stats.recent),
      JSON.stringify(stats).slice(0, 120));

    const csv = await fetch(`${BASE}/api/admin/launch-signups.csv`, { headers: { "x-admin-key": ADMIN_KEY } });
    ck("the CSV downloads", csv.status === 200);
    ck("  ...as an attachment with a dated name",
      /attachment; filename="tulipglam-launch-list-\d{4}-\d{2}-\d{2}\.csv"/.test(csv.headers.get("content-disposition") ?? ""),
      csv.headers.get("content-disposition") ?? "");
    // Read the RAW BYTES. Response.text() decodes UTF-8 and strips the BOM per spec, so
    // asserting on the decoded string would report a missing BOM that is actually present.
    const bytes = new Uint8Array(await csv.clone().arrayBuffer());
    const text = await csv.text();
    ck("  ...with a header row", text.includes("email,source,signed_up"));
    ck("  ...and a UTF-8 BOM on the wire, so Excel does not mangle it",
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      [...bytes.slice(0, 3)].join(","));
  }

  if (WRITE) {
    section("CSV injection — the payload is an address a stranger typed:");
    {
      const { launchListCsv } = await import("../src/launchList.ts");
      // A formula that a spreadsheet would execute on open. It cannot reach the DB through
      // normaliseEmail, so it is inserted directly — the escaping is what is under test.
      const nasty = await db.launchSignup.create({
        data: { email: `=cmd|'/c calc'!a1-${Date.now()}@tulipglam-test.invalid`, source: "test" },
      });
      made.push(nasty.id);
      const csv = await launchListCsv(db);
      const line = csv.split("\r\n").find((l) => l.includes("calc"));
      ck("a leading = is neutralised with a quote", line?.startsWith(`"'=`), String(line).slice(0, 40));
      ck("  ...and the address is still readable", line?.includes("calc"));

      const quoted = await db.launchSignup.create({
        data: { email: `has"quote-${Date.now()}@tulipglam-test.invalid`, source: "test" },
      });
      made.push(quoted.id);
      const csv2 = await launchListCsv(db);
      ck("an embedded quote is doubled, not left to break the row", csv2.includes('has""quote'));
    }

    section("Unsubscribe, then sign up again:");
    {
      const { recordSignup } = await import("../src/launchList.ts");
      const email = `resub-${Date.now().toString(36)}@tulipglam-test.invalid`;
      await recordSignup(db, { email });
      const row = await db.launchSignup.findUnique({ where: { email } });
      made.push(row.id);
      await db.launchSignup.update({ where: { email }, data: { unsubscribedAt: new Date(), notifiedAt: new Date() } });

      await recordSignup(db, { email });
      const after = await db.launchSignup.findUnique({ where: { email } });
      ck("signing up again clears the unsubscribe", after.unsubscribedAt === null);
      ck("  ...but does NOT reset notified, so they are not mailed twice", after.notifiedAt !== null);
      const count = await db.launchSignup.count({ where: { email } });
      ck("  ...and there is still exactly one row", count === 1, String(count));
    }
  } else {
    console.log("\n(storage tests skipped — pass --write to run them against the database)");
  }
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 5).join("\n        ")}`);
} finally {
  server.kill();
  if (made.length) await db.launchSignup.deleteMany({ where: { id: { in: made } } });
  await db.$disconnect();
  if (made.length) console.log(`\n  cleaned up ${made.length} signups`);
  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}
