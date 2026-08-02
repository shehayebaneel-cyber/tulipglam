/**
 * Can the coming-soon gate be walked past?
 *
 *     node --import tsx scripts/test-gate-bypass.mjs
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────────────
 *
 * `comingSoonGate` runs before the routes and calls next() for anything on its allowlist.
 * An allowlisted path that matches NO route then fell all the way through to the SPA catch-all,
 * which served the real storefront shell — 404 status, real site in the body, enough for a
 * browser to boot the app. Four paths did it, and one of them was simply
 * `GET /api/launch-signup`, the endpoint added tonight, because only POST has a route.
 *
 * The allowlist is about letting specific ENDPOINTS through. It was never about letting the
 * site through, and the distinction had no test until now.
 */
const { spawn } = await import("node:child_process");
const { fileURLToPath } = await import("node:url");

let pass = 0, fail = 0;
const ck = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${ok ? "" : "  " + x}`); };

const PORT = 4392, BASE = `http://127.0.0.1:${PORT}`;
const s = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: {
    ...process.env, PORT: String(PORT), COMING_SOON: "true",
    PREVIEW_KEY: "test-preview-key-long-enough-24-chars",
    ADMIN_KEY: "test-admin-key-long-enough-here", LOYALTY_ENABLED: "false", NODE_ENV: "development",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; s.stdout.on("data", (d) => { log += d; }); s.stderr.on("data", (d) => { log += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`${BASE}/api/health`)).ok; } catch { /* waking */ } if (!up) await sleep(500); }
  ck("a gated server boots", up, log.slice(-300));
  if (!up) throw new Error("server never came up");

  const doc = { accept: "text/html", "sec-fetch-dest": "document" };
  const leaks = async (path) => (await (await fetch(`${BASE}${path}`, { headers: doc, redirect: "manual" })).text()).includes('id="root"');

  console.log("\nNo path may serve the real storefront while the gate is on:");
  // The four that did, plus the shapes around them.
  for (const path of [
    "/",
    "/shop",
    "/api/launch-signup",            // allowlisted exactly; only POST has a route
    "/api/auth/does-not-exist",      // allowlisted prefix, no route
    "/api/internal/anything",        // allowlisted prefix, no route
    "/api/admin/nope",               // allowlisted prefix, no route (401s before the catch-all)
    "/api/auth/../index.html",       // traversal out of an allowlisted prefix
    "/api/auth/..%2findex.html",     // encoded traversal
    "/api/auth/%2e%2e/index.html",   // encoded dot-dot
    "/assets/index.js",
    "/some/deep/unknown/path",
  ]) {
    ck(`  ${path}`, !(await leaks(path)), "SERVED THE REAL SITE");
  }

  console.log("\nAnd the endpoints that ARE allowlisted still work:");
  const health = await fetch(`${BASE}/api/health`);
  ck("  GET /api/health answers", health.status === 200);
  const signup = await fetch(`${BASE}/api/launch-signup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "gate-test@tulipglam-test.invalid" }),
  });
  ck("  POST /api/launch-signup answers", signup.status === 200, String(signup.status));
  const admin = await fetch(`${BASE}/api/admin/summary`, { headers: { "x-admin-key": "test-admin-key-long-enough-here" } });
  ck("  admin is reachable with its key", admin.status === 200, String(admin.status));

  console.log("\nA holder of the preview key still sees the real site:");
  const withKey = await fetch(`${BASE}/?preview=test-preview-key-long-enough-24-chars`, { headers: doc, redirect: "manual" });
  const cookie = withKey.headers.get("set-cookie") ?? "";
  ck("  the preview key sets a cookie", cookie.includes("tg_preview="), cookie.slice(0, 40));
  const real = await fetch(`${BASE}/shop`, { headers: { ...doc, cookie: cookie.split(";")[0] } });
  ck("  and then the real shop renders", (await real.text()).includes('id="root"'));
} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 4).join("\n        ")}`);
} finally {
  s.kill();
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  await db.launchSignup.deleteMany({ where: { email: { endsWith: "@tulipglam-test.invalid" } } });
  await db.$disconnect();
  console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
  process.exit(fail ? 1 : 0);
}
