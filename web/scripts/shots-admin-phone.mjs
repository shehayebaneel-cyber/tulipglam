/**
 * Every daily admin task, at 390px, photographed.
 *
 *     node scripts/shots-admin-phone.mjs
 *
 * The owner runs this business from a phone in a van. A typecheck cannot see a table that needs
 * 728px of a 358px screen, a control under a fixed bar, or a button that only appears on hover —
 * every one of which was real here. So the check is: open it, and look.
 *
 * Drives the built app against a server on a LOCAL database with real restored data.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, findChrome, sleep } from "../../server/scripts/e2e/driver.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "shots", "admin-phone");
const BASE = process.env.BASE || "http://localhost:4360";
const KEY = process.env.ADMIN_KEY || "e2e-admin-key-not-the-default";

if (!findChrome()) { console.log("SKIPPED — no Chrome"); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true });

const b = await new Browser(9350).launch({ width: 390, height: 844, mobile: true });

const shot = async (name, url, waitFor) => {
  await b.goto(`${BASE}${url}`);
  if (waitFor) {
    try { await b.waitFor(waitFor, { timeout: 20000, label: name }); }
    catch { console.log(`  ${name.padEnd(22)} TIMED OUT waiting for content`); }
  }
  await sleep(900);
  // Full page, so nothing below the fold hides.
  const { contentSize } = await b.send("Page.getLayoutMetrics");
  const h = Math.min(Math.round(contentSize.height), 4000);
  await b.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: h, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: h,
  });
  await sleep(400);
  const { data } = await b.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, "base64"));

  // The measurement that matters more than the picture: does anything overflow sideways?
  const overflow = await b.eval(`
    (() => {
      const de = document.documentElement;
      const wide = [...document.querySelectorAll('body *')]
        .filter((e) => e.getBoundingClientRect().width > 400 && getComputedStyle(e).position !== 'fixed')
        .map((e) => e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0,2).join('.'))
        .slice(0, 3);
      const tiny = [...document.querySelectorAll('button, a[href], input[type=checkbox], [role=button]')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40; }).length;
      return { scrollW: de.scrollWidth, clientW: de.clientWidth, wide, tiny };
    })()
  `);
  await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  const sideways = overflow.scrollW > overflow.clientW + 2;
  console.log(`  ${name.padEnd(22)} ${sideways ? `SIDEWAYS SCROLL ${overflow.scrollW}>${overflow.clientW}` : "fits"}  ${overflow.tiny} targets under 40px  ${overflow.wide.length ? "wide: " + overflow.wide.join(", ") : ""}`);
  return { name, ...overflow, sideways };
};

/**
 * Sign in through the form, not by seeding localStorage.
 *
 * Seeding the key looked like it worked and produced nine screenshots of the sign-in card —
 * every one reported "fits, 0 targets under 40px", because an empty page fits everything. Using
 * the real form also means the gate itself is exercised at 390px, which is where the owner meets
 * it.
 */
await b.goto(`${BASE}/admin`);
await sleep(1500);
await b.eval(`localStorage.setItem("tg_admin_key", ${JSON.stringify(KEY)}); "ok"`);
await b.goto(`${BASE}/admin`);
await sleep(1200);
const gated = await b.eval(`/enter your admin key/i.test(document.body.innerText)`);
if (gated) {
  await b.eval(`
    (() => {
      const el = document.querySelector('input[type=password], input[placeholder*="Admin key" i], input');
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(KEY)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()
  `);
  await sleep(300);
  await b.click("text=Sign in");
  await sleep(2000);
}
const stillGated = await b.eval(`/enter your admin key/i.test(document.body.innerText)`);
if (stillGated) { console.log("\n  ABORT — could not get past the admin key gate; screenshots would be of the login card\n"); await b.close(); process.exit(1); }
console.log("  signed in\n");

console.log("\n  admin at 390x844 — the daily loop:\n");
const results = [];
results.push(await shot("01-dashboard", "/admin", "document.body.innerText.length > 200"));
results.push(await shot("02-orders-list", "/admin/orders", "document.body.innerText.length > 300"));
results.push(await shot("03-products", "/admin/products", `document.querySelectorAll('input[type=checkbox]').length > 0 || document.body.innerText.includes('No products')`));
results.push(await shot("04-customers", "/admin/customers", "document.body.innerText.length > 200"));
results.push(await shot("05-loyalty", "/admin/loyalty", "document.body.innerText.length > 200"));
results.push(await shot("06-pulse", "/admin/pulse", "document.body.innerText.length > 150"));
results.push(await shot("07-coupons", "/admin/coupons", "document.body.innerText.length > 150"));
results.push(await shot("08-gift-cards", "/admin/gift-cards", "document.body.innerText.length > 150"));
results.push(await shot("09-dispatch", "/admin/dispatch", "document.body.innerText.length > 150"));

// Order detail — the screen where the status control used to be below everything.
const firstOrder = await b.eval(`
  (async () => {
    const r = await fetch('/api/admin/orders?limit=1', { headers: { 'x-admin-key': ${JSON.stringify(KEY)} } });
    const j = await r.json();
    return j.orders?.[0]?.id ?? null;
  })()
`);
// `?id=N`, NOT `/admin/orders/N` — that path is not a route, and the first version of this
// script screenshotted the STOREFRONT 404 page ten times over while reporting "23 targets under
// 40px", which is a measurement of a page that has nothing to do with admin. A screenshot
// harness that does not check it landed on the right screen measures whatever it hit.
if (firstOrder) {
  results.push(await shot("10-order-detail", `/admin/orders?id=${firstOrder}`,
    `/status|order/i.test(document.body.innerText) && !/page not found/i.test(document.body.innerText)`));
  const landed = await b.eval(`!/page not found/i.test(document.body.innerText)`);
  if (!landed) console.log("  10-order-detail        WRONG SCREEN — got the 404 page");
}

await b.close();

const bad = results.filter((r) => r.sideways);
console.log(`\n  ${results.length} screens, ${bad.length} with sideways scroll${bad.length ? ": " + bad.map((r) => r.name).join(", ") : ""}`);
fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(results, null, 2));
console.log(`  wrote ${OUT}\n`);
process.exitCode = bad.length ? 1 : 0;
