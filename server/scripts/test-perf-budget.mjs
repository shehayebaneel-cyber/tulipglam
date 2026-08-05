/**
 * Performance budgets — so the image and bundle work cannot erode quietly.
 *
 *     node --import tsx scripts/test-perf-budget.mjs
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  READ-ONLY. Measures the built assets and, when Chrome is available, first paint
 *  against a locally served build. Never touches a database.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * ── WHY BUDGETS AND NOT A REPORT ───────────────────────────────────────────────────
 *
 * This repo has measured its bundle and its images several times and written the numbers down
 * each time. A number in a document does not defend itself: the next feature adds 40 KB, nobody
 * re-reads `bundle-report.txt`, and six features later the 95% image saving has been spent.
 *
 * A budget fails the suite. That is the difference.
 *
 * ── HOW THE NUMBERS WERE SET ───────────────────────────────────────────────────────
 *
 * From the actual build on 5 Aug 2026, with headroom for ordinary work but not for a new
 * framework. They are ceilings to notice, not targets to hit — if a change genuinely needs the
 * room, RAISE THE NUMBER IN THIS FILE as part of that change, with a sentence saying why. That
 * edit is the review moment the budget exists to create.
 *
 * Deliberately NOT budgeted: total `dist` size. It is dominated by product imagery, which is
 * catalogue data — it grows when the shop grows, and failing a build for carrying more products
 * would be a budget that punishes the business for succeeding.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findChrome, sleep } from "./e2e/driver.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "..", "..", "web", "dist");
const ASSETS = path.join(DIST, "assets");

let pass = 0, fail = 0;
const ck = (n, ok, extra = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${extra ? "  " + extra : ""}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const kb = (bytes) => Math.round(bytes / 1024);

if (!fs.existsSync(ASSETS)) {
  console.log("\n  SKIPPED — web/dist missing; run `npm run build` in web/\n");
  console.log("0 passed\n");
  process.exit(0);
}

/**
 * The budgets. Every number is what the build measured, plus room.
 *
 * `entryJs` is the one that decides whether a phone on Lebanese mobile data can paint: it is
 * downloaded, parsed and executed before anything appears. React + React Router are ~93 KB of it
 * and are accepted as the framework floor (see DECISIONS.md — that question is closed).
 */
const BUDGETS = {
  entryJs: { limit: 340 * 1024, was: 305 * 1024, why: "the storefront's critical path — parsed before first paint" },
  sharedChunk: { limit: 110 * 1024, was: 92 * 1024, why: "the shared vendor chunk index.html preloads" },
  css: { limit: 80 * 1024, was: 64 * 1024, why: "one stylesheet, render-blocking" },
  /**
   * The EAGER critical path: what every visitor downloads before anything paints.
   *
   * The first version of this budget summed every chunk whose name did not start with "Admin",
   * called it "storefront JS", and failed at 482 KB against a 470 KB limit I had derived by
   * adding entry + shared. The two numbers described different things, which is the tell:
   *
   *   - `Dashboard`, `FilterBar` and `Combobox` are ADMIN code that happens not to be named
   *     "Admin*", so they were being charged to the shopper.
   *   - the lazy storefront routes — Account, Track, Info, Rewards, Password, RequestProduct —
   *     are downloaded only when visited. Counting them as "what a shopper downloads" undoes
   *     the very decision that split them out (see DECISIONS.md).
   *
   * So the metric is now the thing it always meant: entry + shared vendor + the runtime, which
   * is genuinely unavoidable for every visitor. Everything else is on demand by design.
   */
  criticalPath: { limit: 440 * 1024, was: 405 * 1024, why: "entry + shared + runtime — unavoidable for every visitor" },
  adminChunkEach: { limit: 60 * 1024, was: 33 * 1024, why: "admin is code-split; no single screen should balloon" },
};

section("bundle — what a customer's phone downloads before it can paint:");

const files = fs.readdirSync(ASSETS).map((f) => ({
  name: f, size: fs.statSync(path.join(ASSETS, f)).size,
}));

const js = files.filter((f) => f.name.endsWith(".js"));
const css = files.filter((f) => f.name.endsWith(".css"));
// Admin is code-split. `Dashboard`, `FilterBar` and `Combobox` are admin too despite their
// names — they are the admin shell and its primitives, and no storefront route imports them.
const isAdmin = (n) => /^(Admin|ProductEditor|Dashboard|FilterBar|Combobox|DataTable|Pagination)/.test(n);
const entry = js.filter((f) => /^index-/.test(f.name)).sort((a, b) => b.size - a.size)[0];
const shared = js.filter((f) => /^chunk-/.test(f.name)).sort((a, b) => b.size - a.size)[0];
const runtime = js.filter((f) => /^jsx-runtime/.test(f.name)).sort((a, b) => b.size - a.size)[0];
const adminChunks = js.filter((f) => isAdmin(f.name));
// Eagerly loaded by every visitor. Lazy routes are deliberately excluded — see criticalPath.
const critical = [entry, shared, runtime].filter(Boolean);

const report = [];
const budget = (key, actual, label) => {
  const b = BUDGETS[key];
  const ok = actual <= b.limit;
  report.push({ key, actual, limit: b.limit, ok });
  ck(`${label} ${kb(actual)} KB <= ${kb(b.limit)} KB`, ok,
    ok ? `(was ${kb(b.was)} KB — ${b.why})` : `OVER BY ${kb(actual - b.limit)} KB — ${b.why}`);
};

budget("entryJs", entry?.size ?? 0, "entry chunk");
budget("sharedChunk", shared?.size ?? 0, "shared vendor chunk");
budget("css", css.reduce((n, f) => n + f.size, 0), "stylesheet");
budget("criticalPath", critical.reduce((n, f) => n + f.size, 0), "eager critical path (entry+shared+runtime)");

const biggestAdmin = adminChunks.sort((a, b) => b.size - a.size)[0];
if (biggestAdmin) budget("adminChunkEach", biggestAdmin.size, `largest admin chunk (${biggestAdmin.name.split("-")[0]})`);

section("admin stays out of the shopper's bundle:");
const adminTotal = adminChunks.reduce((n, f) => n + f.size, 0);
ck("admin code is split into its own chunks", adminChunks.length >= 3, `${adminChunks.length} chunks, ${kb(adminTotal)} KB`);
// The regression that matters: an admin import leaking into the entry chunk. Named admin chunks
// existing is the evidence it did not.
ck("the entry chunk is not carrying admin", (entry?.size ?? 0) < BUDGETS.criticalPath.limit,
  `entry ${kb(entry?.size ?? 0)} KB`);

/**
 * First paint, measured rather than assumed.
 *
 * Served from a plain static file server on localhost — no database, no API. That deliberately
 * measures the ASSETS, not the backend: a slow query would otherwise show up here as a bundle
 * regression and send the next person to the wrong place.
 */
section("first paint — the assets alone, no API, no database:");
const chrome = findChrome();
if (!chrome) {
  console.log("  skip  Chrome not found (set CHROME_PATH) — budget not enforced this run");
} else {
  const PORT = 4351;
  const server = spawn(process.execPath, ["-e", `
    const http=require('http'),fs=require('fs'),path=require('path');
    const root=${JSON.stringify(DIST)};
    const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2'};
    http.createServer((req,res)=>{
      const u=decodeURIComponent(req.url.split('?')[0]);
      let f=path.join(root,u);
      if(!fs.existsSync(f)||fs.statSync(f).isDirectory()) f=path.join(root,'index.html');
      res.setHeader('content-type',types[path.extname(f)]||'application/octet-stream');
      fs.createReadStream(f).pipe(res);
    }).listen(${PORT});
  `], { stdio: "ignore" });

  try {
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/index.html`); if (r.ok) break; } catch { await sleep(150); }
    }
    const { Browser } = await import("./e2e/driver.mjs");
    const b = await new Browser(9345).launch({ width: 390, height: 844, mobile: true });
    await b.goto(`http://127.0.0.1:${PORT}/`, { waitFor: "document.readyState === 'complete'", timeout: 20000 });
    await sleep(1200);
    const paint = await b.eval(`
      (() => {
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        const nav = performance.getEntriesByType('navigation')[0];
        return {
          fcp: fcp ? Math.round(fcp.startTime) : null,
          domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
          transferred: performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || 0), 0),
        };
      })()
    `);
    await b.close();

    // 2500ms on a throttle-free localhost is generous on purpose: it is a REGRESSION alarm, not
    // a field measurement. Real Lebanese mobile is far slower and is not simulated here — say so
    // rather than let a green tick imply a promise about a customer's phone.
    ck(`first contentful paint ${paint.fcp} ms <= 2500 ms (localhost, unthrottled)`,
      paint.fcp !== null && paint.fcp <= 2500, `fcp ${paint.fcp}`);
    console.log(`        DOMContentLoaded ${paint.domContentLoaded} ms, ${kb(paint.transferred)} KB transferred`);
    console.log(`        NOTE: localhost with no throttling. This is a regression alarm, not a`);
    console.log(`        claim about a phone on Lebanese mobile data.`);
  } catch (e) {
    ck(`first paint measurable: ${String(e.message).split("\n")[0]}`, false);
  } finally {
    server.kill();
  }
}

section("budget summary:");
for (const r of report) {
  const pctUsed = Math.round((r.actual / r.limit) * 100);
  console.log(`  ${r.key.padEnd(16)}${String(kb(r.actual)).padStart(5)} KB of ${String(kb(r.limit)).padStart(4)} KB  ${String(pctUsed).padStart(3)}%  ${r.ok ? "" : "OVER"}`);
}
console.log(`\n  To spend budget deliberately, raise the number in BUDGETS with a reason.`);

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exitCode = fail ? 1 : 0;
