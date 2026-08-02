/**
 * Screenshot every surface at phone width, into one folder.
 *
 *     node scripts/shots.mjs before            # -> shots/before/*.png
 *     node scripts/shots.mjs after
 *     node scripts/shots.mjs after --only checkout
 *
 * Phone width is the design target, so 390x844 at DPR 2 is the default and desktop is a
 * deliberate extra rather than the reference.
 *
 * Drives a real Chrome over CDP using Node's built-in WebSocket — no Playwright in this repo,
 * and no reason to add one for this. Requires the dev servers on 4230/5331 and a seeded cart,
 * which is why several surfaces below do setup work before they can be photographed at all: an
 * empty cart screenshot proves nothing about the cart.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.argv[2];
if (!LABEL || LABEL.startsWith("--")) { console.error("usage: shots.mjs <before|after> [--only name] [--desktop]"); process.exit(1); }
const onlyAt = process.argv.indexOf("--only");
const ONLY = onlyAt > -1 ? process.argv[onlyAt + 1] : null;
const DESKTOP = process.argv.includes("--desktop");

const OUT = path.resolve(HERE, "..", "..", "shots", LABEL);
fs.mkdirSync(OUT, { recursive: true });

const WEB = process.env.WEB_ORIGIN || "http://localhost:5331";
const ADMIN_KEY = process.env.ADMIN_KEY || "tulip-admin-2026";
const CHROME = process.env.CHROME_PATH
  || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9700 + Math.floor(Math.random() * 80);
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  `--user-data-dir=${path.join(os.tmpdir(), `tg-shots-${PORT}`)}`,
  `--remote-debugging-port=${PORT}`, "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });

let id = 0;
const rpc = (ws, method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const mine = ++id;
  const t = setTimeout(() => reject(new Error(`${method} timed out`)), 30000);
  const onMsg = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== mine) return;
    clearTimeout(t); ws.removeEventListener("message", onMsg);
    m.error ? reject(new Error(method + ": " + m.error.message)) : resolve(m.result);
  };
  ws.addEventListener("message", onMsg);
  ws.send(JSON.stringify({ id: mine, method, params, ...(sessionId ? { sessionId } : {}) }));
});

/**
 * The surfaces. `prep` runs in the page before the shot.
 *
 * Several of these cannot be photographed by navigation alone — a cart page with nothing in it
 * is the empty state, not the cart — so the seeding is part of the definition of the surface.
 */
const SURFACES = [
  { name: "home", url: "/" },
  { name: "shop-all", url: "/shop" },
  { name: "category", url: "/shop?category=makeup" },
  { name: "search-empty", url: "/shop?q=zzzzznothingmatchesthis" },
  { name: "product", url: "__FIRST_PRODUCT__" },
  { name: "cart-empty", url: "/cart", prep: `localStorage.removeItem("tg_cart")` },
  { name: "cart", url: "/cart", seedCart: true },
  { name: "checkout", url: "/checkout", seedCart: true },
  { name: "account-signedout", url: "/account" },
  { name: "rewards", url: "/rewards" },
  { name: "brands", url: "/brands" },
  { name: "track", url: "/track" },
  { name: "info-shipping", url: "/info/shipping" },
  { name: "notfound", url: "/this-page-does-not-exist" },
];

try {
  let wsUrl;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl; }
    catch { await sleep(250); }
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  const { targetId } = await rpc(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await rpc(ws, "Target.attachToTarget", { targetId, flatten: true });
  const call = (m, p) => rpc(ws, m, p, sessionId);

  await call("Page.enable");
  await call("Runtime.enable");
  const metrics = DESKTOP
    ? { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }
    : { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
  await call("Emulation.setDeviceMetricsOverride", metrics);

  const evaluate = (expression) => call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });

  // Preview access + admin key, planted once before anything is photographed.
  await call("Page.navigate", { url: WEB });
  await sleep(1500);
  await evaluate(`localStorage.setItem("tg_admin_key", ${JSON.stringify(ADMIN_KEY)})`);

  /**
   * The first real product, fetched from NODE rather than from inside the page.
   *
   * Doing it in-page with `awaitPromise` hung the whole run against a cold Neon connection and
   * took the screenshots with it. Node can reach the same API directly, the value is needed
   * before any navigation anyway, and a fetch that fails here fails loudly instead of as a
   * thirty-second timeout attributed to the wrong surface.
   */
  const api = process.env.API_ORIGIN || WEB; // through Vite, which attaches the preview cookie the gate requires
  const firstProduct = await fetch(`${api}/api/products?limit=1`).then((r) => r.json()).catch(() => null);
  const product = firstProduct?.products?.[0] ?? null;
  const productSlug = product?.slug ?? "";
  if (!product) console.log("  warn  no product from the API — product/cart/checkout shots will be skipped");

  const done = [];
  for (const s of SURFACES) {
    if (ONLY && s.name !== ONLY) continue;
    const url = s.url === "__FIRST_PRODUCT__" ? (productSlug ? `/product/${productSlug}` : null) : s.url;
    if (!url) { console.log(`  skip  ${s.name} (no product found)`); continue; }

    if (s.seedCart) {
      if (!product) { console.log(`  skip  ${s.name} (needs a product)`); continue; }
      // A real line from a real product at the server's own price — not a fabricated cart.
      const line = [{
        productId: product.id, slug: product.slug, name: product.name,
        image: product.images?.[0]?.url ?? "",
        priceCents: product.salePriceCents || product.priceCents,
        qty: 2, variantId: null, variantLabel: "",
      }];
      await evaluate(`localStorage.setItem("tg_cart", ${JSON.stringify(JSON.stringify(line))})`);
    } else if (s.prep) {
      await evaluate(s.prep);
    }

    await call("Page.navigate", { url: WEB + url });

    /**
     * Wait for the page to SETTLE, not for a fixed number of seconds.
     *
     * A flat 2.5s photographed the shop grid mid-spinner — the products query goes to Neon in
     * Ohio and routinely loses that race. Every grid shot was a loading state, which is the
     * worst possible failure here because the screenshots are the evidence for the whole day's
     * design work, and a spinner looks like a page rather than like a mistake.
     *
     * Settled means: no spinner on the page, and the document has stopped changing size or
     * content across two consecutive polls. Capped, so a genuinely broken page still yields a
     * shot — a photograph of the breakage is worth more than an aborted run.
     */
    let last = "", stable = 0;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await sleep(400);
      const probe = await evaluate(`(() => {
        const spinning = !!document.querySelector('.animate-spin, [role="status"]');
        return JSON.stringify({ spinning, h: document.documentElement.scrollHeight, n: document.body.innerHTML.length });
      })()`);
      const v = probe.result?.value ?? "";
      const spinning = /"spinning":true/.test(v);
      if (!spinning && v === last) { if (++stable >= 2) break; } else { stable = 0; }
      last = v;
    }
    // Let lazily-loaded imagery in view finish painting.
    await sleep(900);

    /**
     * `scrollHeight`, not `getLayoutMetrics().contentSize`.
     *
     * contentSize reported 844 for every page — the layout viewport, not the document — so the
     * first run captured one screenful of each surface and called it a full-page shot. Every
     * height came back identical, which is the tell: real pages are not all the same length.
     */
    const measured = await evaluate(`Math.max(
      document.documentElement.scrollHeight, document.body.scrollHeight,
      document.documentElement.offsetHeight, document.body.offsetHeight)`);
    const height = Math.min(Math.ceil(measured.result?.value || 844), 8000);
    await call("Emulation.setDeviceMetricsOverride", { ...metrics, height });
    await sleep(600);

    const { data } = await call("Page.captureScreenshot", { format: "png" });
    const file = path.join(OUT, `${s.name}.png`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));

    // Sideways scroll at phone width is a layout failure, so it is recorded with the shot.
    const overflow = await evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`);
    done.push({ name: s.name, height, overflows: !!overflow.result?.value });
    console.log(`  ok    ${s.name.padEnd(20)} ${metrics.width}x${height}${overflow.result?.value ? "   ⚠ SCROLLS SIDEWAYS" : ""}`);

    await call("Emulation.setDeviceMetricsOverride", metrics);
  }

  fs.writeFileSync(path.join(OUT, "_index.json"), JSON.stringify(done, null, 1));
  console.log(`\n${done.length} shots -> shots/${LABEL}/`);
  const bad = done.filter((d) => d.overflows);
  if (bad.length) console.log(`⚠ ${bad.length} surfaces scroll sideways at 390px: ${bad.map((b) => b.name).join(", ")}`);
} finally {
  chrome.kill();
}
