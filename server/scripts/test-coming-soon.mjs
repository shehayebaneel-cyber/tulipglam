/**
 * The coming-soon gate.
 *
 *     node scripts/test-coming-soon.mjs
 *
 * Unlike the other test scripts this one starts its own servers, because the thing under test
 * is decided at boot: the gate is only mounted when COMING_SOON=true, and two of the checks are
 * that the process refuses to start at all. Nothing needs to be running first.
 *
 * READ-ONLY. It places no orders and writes no rows. Gate-off checks read a product to prove
 * the catalogue still answers; that is the only database access.
 *
 * Runs against a self-contained fixture, and then repeats the important checks against the real
 * web/public/coming-soon.html when that exists — so the shipped page is exercised too, without
 * the suite depending on its contents.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.TEST_PORT ?? 4231);
const BASE = `http://localhost:${PORT}`;
const KEY = "test-preview-key-at-least-24-characters-long";
const SERVER_DIR = path.resolve(import.meta.dirname, "..");
/** Resolved exactly as the gate resolves it: built copy wins, source is the fallback. */
const REAL_PAGE = [
  path.resolve(SERVER_DIR, "..", "web", "dist", "coming-soon.html"),
  path.resolve(SERVER_DIR, "..", "web", "public", "coming-soon.html"),
].find((p) => fs.existsSync(p));

let pass = 0, fail = 0;
const ck = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};
const section = (t) => console.log(`\n${t}`);

// A browser asking for a page; a browser asking for a script.
const AS_DOCUMENT = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "sec-fetch-dest": "document" };
const AS_SCRIPT = { accept: "*/*", "sec-fetch-dest": "script" };

const get = async (p, headers = {}) => {
  const r = await fetch(BASE + p, { headers, redirect: "manual" });
  return { status: r.status, headers: r.headers, body: await r.text() };
};

// ---------------------------------------------------------------- process control

/** Start the server with an env overlay. Resolves once it answers, or rejects on early exit. */
function start(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--env-file-if-exists=.env", "--import", "tsx", "src/index.ts"],
      { cwd: SERVER_DIR, env: { ...process.env, PORT: String(PORT), ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    const collect = (b) => { out += b.toString(); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("exit", (code) => reject(new Error(`server exited early (code ${code}):\n${out}`)));

    // Poll rather than watch for a log line, so this doesn't depend on the boot message.
    const deadline = Date.now() + 45_000;
    const poll = async () => {
      if (Date.now() > deadline) { child.kill(); return reject(new Error(`server did not answer in 45s:\n${out}`)); }
      try {
        await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
        child.removeAllListeners("exit");
        return resolve({ child, log: () => out });
      } catch { setTimeout(poll, 300); }
    };
    setTimeout(poll, 400);
  });
}

const stop = (s) => new Promise((r) => { if (!s?.child) return r(); s.child.once("exit", r); s.child.kill(); setTimeout(r, 3000); });

/** Run to completion and report how it exited — for the boot guards, which must refuse to run. */
function bootOutcome(env) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--env-file-if-exists=.env", "--import", "tsx", "src/index.ts"],
      { cwd: SERVER_DIR, env: { ...process.env, PORT: String(PORT + 1), ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { out += b; });
    const timer = setTimeout(() => { child.kill(); resolve({ code: "still-running", out }); }, 25_000);
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

// A page shaped like the real one: self-contained, no same-origin references at all.
const fixture = path.join(os.tmpdir(), `tg-coming-soon-fixture-${process.pid}.html`);
fs.writeFileSync(fixture, [
  "<!doctype html><html><head><meta charset=utf-8><title>TEST FIXTURE</title>",
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  "<style>body{background:url(data:image/gif;base64,R0lGODlhAQABAAAAACw=)}</style>",
  "</head><body><h1>Opening soon</h1><script>/* inline */</script></body></html>",
].join("\n"));

let server;
try {
  // ================================================================ boot guards
  section("Refuses to start when the gate could not hold:");
  for (const [name, env, expect] of [
    ["PREVIEW_KEY missing", { COMING_SOON: "true", PREVIEW_KEY: "", COMING_SOON_PAGE: fixture }, /PREVIEW_KEY is not set/],
    ["PREVIEW_KEY too short", { COMING_SOON: "true", PREVIEW_KEY: "a".repeat(23), COMING_SOON_PAGE: fixture }, /minimum is 24/],
    ["coming-soon.html missing", { COMING_SOON: "true", PREVIEW_KEY: KEY, COMING_SOON_PAGE: path.join(os.tmpdir(), "tg-nope.html") }, /was not found/],
  ]) {
    const r = await bootOutcome(env);
    ck(`${name} -> exit 1`, r.code === 1, `exit=${r.code}`);
    ck(`  ...and says why`, expect.test(r.out), r.out.split("\n").slice(0, 3).join(" ").slice(0, 90));
  }

  // The same missing key must NOT stop the server when the gate is off — that would be an
  // outage during the state the site is in almost all of the time.
  section("The key is only required while the gate is on:");
  server = await start({ COMING_SOON: "false", PREVIEW_KEY: "" });
  ck("gate off + no PREVIEW_KEY -> starts normally", true);
  ck("  ...and does not announce a gate", !server.log().includes("COMING_SOON is ON"));

  // ================================================================ gate off
  section("Gate off — every route behaves as it did before the gate existed:");
  for (const [p, headers, expect] of [
    ["/", AS_DOCUMENT, 200],
    ["/shop", AS_DOCUMENT, 200],
    ["/cart", AS_DOCUMENT, 200],
    ["/api/health", {}, 200],
    ["/api/products?limit=1", {}, 200],
    ["/robots.txt", {}, 200],
    ["/sitemap.xml", {}, 200],
    ["/product/definitely-not-real-xyz", AS_DOCUMENT, 404],
  ]) {
    const r = await get(p, headers);
    ck(`${p} -> ${expect}`, r.status === expect, String(r.status));
  }
  {
    const r = await get("/api/products?limit=1");
    ck("  the catalogue really answers", r.body.includes("priceCents"), r.body.slice(0, 60));
    const home = await get("/", AS_DOCUMENT);
    ck("  no gate headers leak onto normal responses", !home.headers.get("vary")?.includes("Sec-Fetch-Dest"), home.headers.get("vary") ?? "");
    const sm = await get("/sitemap.xml");
    ck("  the real sitemap is served", (sm.body.match(/<loc>/g) ?? []).length > 100, `${(sm.body.match(/<loc>/g) ?? []).length} urls`);
  }
  await stop(server);
  server = null;

  // ================================================================ gate on
  section("Gate on — starting with a self-contained page:");
  server = await start({ COMING_SOON: "true", PREVIEW_KEY: KEY, COMING_SOON_PAGE: fixture });
  ck("starts", true);
  // The shipped page has no same-origin assets; an empty parse must not be treated as an error.
  ck("a page with no same-origin assets boots fine", server.log().includes("self-contained"), server.log().split("\n")[1] ?? "");

  const isPage = (b) => b.includes("TEST FIXTURE");

  section("Documents get the placeholder in place, 200, no redirect:");
  for (const p of ["/", "/products/anything", "/product/anything", "/cart", "/checkout", "/shop", "/brands", "/admin", "/nonsense/deep/path"]) {
    const r = await get(p, AS_DOCUMENT);
    ck(`${p}`, r.status === 200 && isPage(r.body), `${r.status}${isPage(r.body) ? "" : " not the placeholder"}`);
  }

  section("The API is gated too — nothing leaks by skipping the HTML layer:");
  for (const p of ["/api/products", "/api/site", "/api/home", "/api/brands", "/api/search?q=lipstick"]) {
    const doc = await get(p, AS_DOCUMENT);
    const xhr = await get(p, AS_SCRIPT);
    ck(`${p}`, doc.status === 200 && isPage(doc.body) && xhr.status === 404, `doc=${doc.status} xhr=${xhr.status}`);
    ck(`  ...no catalogue in either response`, !doc.body.includes("priceCents") && !xhr.body.includes("priceCents"));
  }

  section("Non-documents get a bare, uncacheable 404 — never HTML at an asset URL:");
  for (const p of ["/assets/index-abc123.js", "/assets/index-abc123.css", "/products/feel22/photo.png", "/hero/hero.webp"]) {
    const r = await get(p, AS_SCRIPT);
    ck(`${p} -> 404, no-store, empty`, r.status === 404 && r.headers.get("cache-control") === "no-store" && r.body === "",
      `${r.status} cc=${r.headers.get("cache-control")} len=${r.body.length}`);
  }

  section("Cache headers on the gated page:");
  {
    const r = await get("/", AS_DOCUMENT);
    ck("Cache-Control: public, max-age=0, must-revalidate", r.headers.get("cache-control") === "public, max-age=0, must-revalidate", r.headers.get("cache-control") ?? "");
    const vary = r.headers.get("vary") ?? "";
    // Each of these changes the response, so a shared cache must key on all three.
    ck("Vary includes Cookie", /cookie/i.test(vary), vary);
    ck("Vary includes Accept", /accept/i.test(vary), vary);
    ck("Vary includes Sec-Fetch-Dest", /sec-fetch-dest/i.test(vary), vary);
    ck("no shared cache may hold it beyond 60s", /max-age=0/.test(r.headers.get("cache-control") ?? ""));
    ck("status 200, not 503 and not a redirect", r.status === 200);
    ck("no Location header", !r.headers.get("location"));
  }

  section("Allowlist stays reachable:");
  {
    const h = await get("/api/health");
    ck("/api/health answers for real (Render's health check)", h.status === 200 && h.body.includes('"ok":true'), `${h.status} ${h.body.slice(0, 30)}`);
    ck("/api/admin/* reaches its own key check", (await get("/api/admin/summary")).status === 401);
    ck("/api/auth/* reaches its own auth", (await get("/api/auth/me")).status === 401);
    ck("/.well-known/* is not gated", !isPage((await get("/.well-known/acme-challenge/x", AS_DOCUMENT)).body));
    ck("/favicon.svg is not gated", !isPage((await get("/favicon.svg", AS_SCRIPT)).body));
  }

  section("robots.txt and sitemap.xml change while gated:");
  {
    const robots = await get("/robots.txt");
    ck("robots allows / only", /Allow: \/\$/.test(robots.body) && /Disallow: \//.test(robots.body), JSON.stringify(robots.body.slice(0, 50)));
    ck("  ...still names the sitemap", /Sitemap: https?:\/\/\S+/.test(robots.body));
    const sm = await get("/sitemap.xml");
    const locs = (sm.body.match(/<loc>/g) ?? []).length;
    // The whole point: not 8,488 URLs of identical HTML for a crawler to index.
    ck("sitemap lists exactly one URL", locs === 1, `${locs}`);
  }

  section("HEAD — because `curl -sI` is the launch-day verification command:");
  {
    const head = await fetch(BASE + "/", { method: "HEAD", headers: AS_DOCUMENT, redirect: "manual" });
    const body = await head.text();
    ck("HEAD / -> 200", head.status === 200, String(head.status));
    ck("  ...empty body, as HEAD requires", body === "", `len=${body.length}`);
    ck("  ...same Content-Type a GET would send", (head.headers.get("content-type") ?? "").includes("text/html"), head.headers.get("content-type") ?? "");
    ck("  ...same Cache-Control", head.headers.get("cache-control") === "public, max-age=0, must-revalidate", head.headers.get("cache-control") ?? "");
    ck("  ...same Vary", /cookie/i.test(head.headers.get("vary") ?? "") && /accept/i.test(head.headers.get("vary") ?? ""), head.headers.get("vary") ?? "");
    // A HEAD that under-reports the size would make `curl -sI` misleading on launch day.
    const get = await fetch(BASE + "/", { headers: AS_DOCUMENT });
    const getBody = await get.text();
    ck("  ...Content-Length matches what GET returns", head.headers.get("content-length") === String(Buffer.byteLength(getBody)),
      `head=${head.headers.get("content-length")} get=${Buffer.byteLength(getBody)}`);

    const headAsset = await fetch(BASE + "/assets/index-abc123.js", { method: "HEAD", headers: AS_SCRIPT, redirect: "manual" });
    ck("HEAD on a gated asset -> 404", headAsset.status === 404, String(headAsset.status));
    ck("  ...still no-store", headAsset.headers.get("cache-control") === "no-store", headAsset.headers.get("cache-control") ?? "");

    const headAllowed = await fetch(BASE + "/api/health", { method: "HEAD", redirect: "manual" });
    ck("HEAD on an allowlisted path passes through", headAllowed.status === 200, String(headAllowed.status));
  }

  section("A wrong preview key is indistinguishable from no key:");
  {
    const none = await get("/", AS_DOCUMENT);
    const wrong = await get("/?preview=not-the-key-but-the-right-sort-of-length", AS_DOCUMENT);
    ck("same status", wrong.status === none.status, `${wrong.status} vs ${none.status}`);
    ck("same body", wrong.body === none.body);
    ck("no cookie set", !wrong.headers.get("set-cookie"), wrong.headers.get("set-cookie") ?? "");
    ck("no Location header", !wrong.headers.get("location"));
    ck("nothing hints a key exists", !/preview|unauthor|forbidden|invalid/i.test(wrong.body.replace(/TEST FIXTURE/g, "")));
  }

  section("A correct key lets that browser through:");
  let jar = "";
  {
    const r = await get(`/?preview=${encodeURIComponent(KEY)}`, AS_DOCUMENT);
    const cookie = r.headers.get("set-cookie") ?? "";
    jar = cookie.split(";")[0];
    ck("sets a cookie", !!cookie, "(none)");
    ck("  httpOnly", /HttpOnly/i.test(cookie), cookie);
    ck("  secure", /Secure/i.test(cookie), cookie);
    ck("  sameSite=lax", /SameSite=Lax/i.test(cookie), cookie);
    ck("  lasts 7 days", /Max-Age=604800/.test(cookie), cookie);
    ck("  never contains the raw key", !cookie.includes(KEY));
    ck("redirects once to strip the key from the URL", r.status === 302 && r.headers.get("location") === "/", `${r.status} -> ${r.headers.get("location")}`);
    // A cached-and-replayed 302 would hand the bypass to whoever got it from the cache.
    ck("  that redirect is Cache-Control: no-store", r.headers.get("cache-control") === "no-store", r.headers.get("cache-control") ?? "");
  }

  section("With the cookie, the real site is fully reachable:");
  {
    const home = await get("/", { ...AS_DOCUMENT, cookie: jar });
    ck("/ renders the real app", home.status === 200 && !isPage(home.body) && home.body.includes('id="root"'), String(home.status));
    const api = await get("/api/products?limit=1", { cookie: jar });
    ck("/api/products returns the catalogue", api.status === 200 && api.body.includes("priceCents"), String(api.status));
    const sm = await get("/sitemap.xml", { cookie: jar });
    // The crawler-facing files stay gated regardless of who is looking — they are not
    // per-visitor, and a previewer must not be able to publish the real sitemap by visiting it.
    ck("sitemap stays minimal even for a previewer", (sm.body.match(/<loc>/g) ?? []).length === 1, `${(sm.body.match(/<loc>/g) ?? []).length}`);
  }

  section("Exit clears the cookie:");
  {
    const r = await get("/?preview=exit", { ...AS_DOCUMENT, cookie: jar });
    ck("clears it", /Max-Age=0/.test(r.headers.get("set-cookie") ?? ""), r.headers.get("set-cookie") ?? "(none)");
    ck("  and is uncacheable", r.headers.get("cache-control") === "no-store", r.headers.get("cache-control") ?? "");
    const after = await get("/", { ...AS_DOCUMENT, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] });
    ck("  the placeholder is back", isPage(after.body));
  }
  await stop(server);
  server = null;

  // ================================================================ no database
  //
  // The Render free tier spins the service down, and Neon spins the database down separately.
  // A visitor arriving cold must still get the page, whatever Postgres is doing. If this fails,
  // something in the boot path or the gate is reaching Prisma before the gate answers.
  section("The gate holds with the database unreachable:");
  {
    const dead = "postgresql://nobody:nothing@127.0.0.1:1/nowhere?sslmode=disable&connect_timeout=1";
    server = await start({ COMING_SOON: "true", PREVIEW_KEY: KEY, COMING_SOON_PAGE: fixture, DATABASE_URL: dead, DIRECT_URL: dead });
    ck("the server still starts", true);

    const r = await get("/", AS_DOCUMENT);
    ck("/ still returns the placeholder, 200", r.status === 200 && r.body.includes("TEST FIXTURE"), String(r.status));
    ck("  ...with the right cache headers", r.headers.get("cache-control") === "public, max-age=0, must-revalidate", r.headers.get("cache-control") ?? "");

    const deep = await get("/product/anything", AS_DOCUMENT);
    ck("a product URL does too", deep.status === 200 && deep.body.includes("TEST FIXTURE"), String(deep.status));

    const asset = await get("/assets/x.js", AS_SCRIPT);
    ck("gated assets still 404 rather than hanging on the database", asset.status === 404, String(asset.status));

    // The proof that the gate is genuinely ahead of Prisma: an allowlisted route that DOES use
    // the database fails, while everything the gate answers keeps working.
    const health = await get("/api/health");
    ck("/api/health is fine — it never touches the database", health.status === 200, String(health.status));
    await stop(server);
    server = null;
  }

  // ================================================================ the real page
  section("The shipped web/public/coming-soon.html:");
  if (!fs.existsSync(REAL_PAGE)) {
    console.log("  SKIPPED — web/public/coming-soon.html does not exist yet.");
    console.log("  Everything above ran against a fixture of the same shape. Add the real page");
    console.log("  and re-run to exercise it.");
  } else {
    server = await start({ COMING_SOON: "true", PREVIEW_KEY: KEY });
    const marker = fs.readFileSync(REAL_PAGE, "utf8");
    const title = marker.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
    const r = await get("/", AS_DOCUMENT);
    ck("is what gets served", r.status === 200 && (!title || r.body.includes(title)), `${r.status} title=${JSON.stringify(title)}`);
    ck("  served byte-for-byte, unmodified", r.body === marker, `${r.body.length} vs ${marker.length} bytes`);
    ck("  every asset it references is allowlisted", await (async () => {
      const refs = new Set();
      for (const m of marker.matchAll(/(?:src|href)\s*=\s*["'](\/[^"'#?\s]*)/gi)) refs.add(m[1]);
      for (const m of marker.matchAll(/url\(\s*["']?(\/[^"')#?\s]*)/gi)) refs.add(m[1]);
      refs.delete("/");
      for (const ref of refs) if (isPage((await get(ref, AS_SCRIPT)).body)) return false;
      return true;
    })(), "one of its assets was gated — the page would render broken");
    await stop(server);
    server = null;
  }
} catch (e) {
  fail++;
  console.log(`\n  FAIL  ${e.message}`);
} finally {
  await stop(server);
  try { fs.unlinkSync(fixture); } catch { /* already gone */ }
}

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exit(fail ? 1 : 0);
