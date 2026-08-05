/**
 * Screenshot the admin bulk-action bar with a dropdown open.
 *
 *     node scripts/shot-bulkbar.mjs
 *
 * The bar is `fixed bottom-4`, so its comboboxes have ~16px of space beneath them. Whether the
 * menu flips upward is only visible by opening one and LOOKING at it — a typecheck cannot see a
 * menu rendered off the bottom of the screen, which is exactly how this shipped.
 *
 * Drives the real built app served by the API on :4230. Read-only: selects a row and opens a
 * menu, never picks an option, so nothing is saved.
 */
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 9223;
const BASE = process.env.BASE || "http://localhost:4230";
const ADMIN_KEY = process.env.ADMIN_KEY || "tulip-admin-2026";
// fileURLToPath, not `.pathname` — this repo's path contains a space, and `.pathname` leaves it
// percent-encoded, so writes land in a literal "projects%20website" directory beside the real one.
const OUT = fileURLToPath(new URL("../shots/bulkbar/", import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const CHROME = process.env.CHROME_PATH
  || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
if (!CHROME) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(1); }

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${process.env.TEMP || "/tmp"}/tg-bulkbar-${Date.now()}`,
  `--remote-debugging-port=${PORT}`, "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await r.json()).webSocketDebuggerUrl;
    } catch { await sleep(300); }
  }
  throw new Error("Chrome did not expose a debugging port");
}

const url = await wsUrl();
const ws = new WebSocket(url);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable");
await S("Runtime.enable");

// 1366x768 — the laptop height where a bottom-pinned bar has least room below it.
await S("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });

const evaluate = async (expression) => {
  const r = await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
  return r.result.value;
};

// Seed the admin key before the app boots, or it renders the key gate instead.
await S("Page.navigate", { url: `${BASE}/admin` });
await sleep(1500);
await evaluate(`localStorage.setItem("tg_admin_key", ${JSON.stringify(ADMIN_KEY)}); "ok"`);
await S("Page.navigate", { url: `${BASE}/admin/products` });
await sleep(4000);

const shot = async (name) => {
  const { data } = await S("Page.captureScreenshot", { format: "png" });
  const file = `${OUT}${name}.png`;
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`  wrote ${file}`);
};

// Poll rather than sleep: the list is a paginated query against a database in Ohio, and a
// fixed wait is how a screenshot harness reports "no rows" for a page that simply had not
// finished loading.
let rows = 0;
for (let i = 0; i < 40; i++) {
  rows = await evaluate(`document.querySelectorAll('input[type=checkbox][aria-label^="Select row"]').length`);
  if (rows > 0) break;
  await sleep(500);
}
console.log(`  rows loaded: ${rows}`);
if (!rows) console.log(`  page text: ${JSON.stringify(await evaluate(`document.body.innerText.slice(0, 300)`))}`);

// Select the first row, which reveals the bulk bar.
const picked = await evaluate(`
  (() => {
    const cb = document.querySelector('input[type=checkbox][aria-label^="Select row"]');
    if (!cb) return "no row checkbox";
    cb.click();
    return "selected";
  })()
`);
console.log(`  select: ${picked}`);
await sleep(800);

// Open the first combobox in the bulk bar ("Set status…").
const opened = await evaluate(`
  (() => {
    const bar = document.querySelector('[aria-label="Bulk actions"]');
    if (!bar) return "no bulk bar";
    const btn = bar.querySelector('[role=combobox]');
    if (!btn) return "no combobox";
    btn.click();
    return btn.getAttribute("aria-label") || "opened";
  })()
`);
console.log(`  opened: ${opened}`);
await sleep(600);

// The measurement that matters: is the menu inside the viewport?
const geom = await evaluate(`
  (() => {
    const bar = document.querySelector('[aria-label="Bulk actions"]');
    const btn = bar && bar.querySelector('[role=combobox]');
    const menu = btn && btn.parentElement.querySelector('ul');
    if (!menu) return { ok: false, why: "menu not rendered" };
    const m = menu.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    return {
      ok: true,
      viewportH: window.innerHeight,
      buttonBottom: Math.round(b.bottom),
      menuTop: Math.round(m.top), menuBottom: Math.round(m.bottom), menuH: Math.round(m.height),
      opensUpward: m.bottom <= b.top + 2,
      fullyVisible: m.top >= 0 && m.bottom <= window.innerHeight,
      optionCount: menu.querySelectorAll('[role=option]').length,
    };
  })()
`);
console.log("  geometry:", JSON.stringify(geom, null, 2).replace(/\n/g, "\n  "));

await shot("bulk-bar-status-open");

/**
 * The other half of the check: a combobox with room below must STILL open downward.
 *
 * "Flip when short of space" is one line away from "always flip", and a change that fixed the
 * bulk bar by inverting every menu on the page would pass the assertion above. So the filter
 * row at the top of the page is opened too, and asserted to open the normal way.
 */
await evaluate(`document.querySelector('[aria-label="Bulk actions"] [role=combobox]')?.click(); "closed"`);
await sleep(300);
// Click and measure in SEPARATE evaluates — React has not rendered the menu yet within the
// same tick, which reads as "menu not rendered" and looks like a real failure.
await evaluate(`
  (() => {
    const btn = [...document.querySelectorAll('[role=combobox]')].find((b) => !b.closest('[aria-label="Bulk actions"]'));
    if (!btn) return "none";
    window.__probe = btn; btn.click(); return btn.getAttribute("aria-label");
  })()
`);
await sleep(600);
const down = await evaluate(`
  (() => {
    const btn = window.__probe;
    if (!btn) return { ok: false, why: "no filter combobox" };
    const menu = btn.parentElement.querySelector('ul');
    if (!menu) return { ok: false, why: "menu not rendered" };
    const m = menu.getBoundingClientRect(), b = btn.getBoundingClientRect();
    return {
      ok: true, label: btn.getAttribute("aria-label"),
      opensDownward: m.top >= b.bottom - 2,
      fullyVisible: m.top >= 0 && m.bottom <= window.innerHeight,
    };
  })()
`);
console.log("  filter row:", JSON.stringify(down));
await sleep(400);
await shot("filter-row-status-open");
if (!down.ok || !down.opensDownward) { console.log("\n  FAIL — a menu with room below should open downward\n"); process.exitCode = 1; }

/**
 * The sibling: the per-row status chip on the LAST visible row.
 *
 * Different component (StatusBadge), identical shape — a menu pinned below its trigger near the
 * bottom of a long table. It shares the placement hook now, so this asserts the hook actually
 * reaches it rather than trusting that it does.
 */
await evaluate(`window.__probe?.click(); document.body.click(); "closed"`);
await sleep(300);
await evaluate(`
  (() => {
    const chips = [...document.querySelectorAll('button[aria-label^="Status of"]')];
    if (!chips.length) return "none";
    const last = chips[chips.length - 1];
    last.scrollIntoView({ block: "end" });
    window.__chip = last;
    return "found " + chips.length;
  })()
`);
await sleep(500);
await evaluate(`window.__chip.click(); "clicked"`);
await sleep(600);
/**
 * Inside the viewport is not the same as visible.
 *
 * The first pass asserted only that the menu's rectangle sat within the viewport, and it passed
 * — while the bulk action bar, also `z-40` and later in the DOM, covered the bottom of it. The
 * last option was unreadable in the screenshot the check had just called fine.
 *
 * So this hit-tests: at three points down the menu, whatever `elementFromPoint` returns must be
 * the menu or something inside it. That is the property "the operator can see and click it".
 */
const chip = await evaluate(`
  (() => {
    const btn = window.__chip;
    const menu = btn?.parentElement.querySelector('[role=menu]');
    if (!menu) return { ok: false, why: "menu not rendered" };
    const m = menu.getBoundingClientRect(), b = btn.getBoundingClientRect();
    const x = Math.round(m.left + m.width / 2);
    const probes = [m.top + 8, m.top + m.height / 2, m.bottom - 8].map((y) => {
      const el = document.elementFromPoint(x, Math.round(y));
      return { y: Math.round(y), covered: !(el && menu.contains(el)), by: el?.className?.toString?.().slice(0, 40) ?? String(el?.tagName) };
    });
    return {
      ok: true,
      buttonBottom: Math.round(b.bottom), menuTop: Math.round(m.top), menuBottom: Math.round(m.bottom),
      viewportH: window.innerHeight,
      opensUpward: m.bottom <= b.top + 2,
      fullyVisible: m.top >= 0 && m.bottom <= window.innerHeight,
      occludedAt: probes.filter((p) => p.covered),
    };
  })()
`);
console.log("  last-row status chip:", JSON.stringify(chip));
await shot("row-status-chip-open");
if (!chip.ok || !chip.fullyVisible || chip.occludedAt?.length) {
  console.log(`\n  FAIL — the row status menu is ${chip.occludedAt?.length ? "covered by something" : "not fully on screen"}\n`);
  process.exitCode = 1;
}

await S("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
ws.close();
chrome.kill();

if (!geom.ok || !geom.fullyVisible) { console.log("\n  FAIL — the menu is not fully on screen\n"); process.exitCode = 1; }
else console.log(`\n  ok — menu opens ${geom.opensUpward ? "UPWARD" : "downward"} and is fully visible\n`);
