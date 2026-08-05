/**
 * The money journeys, in a real browser.
 *
 *     node --import tsx scripts/e2e/test-e2e.mjs
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  Runs ONLY against a local Postgres and its own throwaway database, on its own
 *  port. It places real orders, so there is deliberately no way to point it at
 *  production — see driver.mjs for why that is not a configuration option.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Skips loudly when Chrome, web/dist or the local cluster are missing. It never reports a pass
 * for a browser that did not open.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import {
  Browser, preflight, startServer, stopServer, recorder, pgUrl, sleep, HERE, SERVER_DIR,
} from "./driver.mjs";
import { seed } from "./seed.mjs";

const DB = "tulip_e2e";
const PORT = 4310;
const SHOTS = path.join(SERVER_DIR, "..", "web", "shots", "e2e");

const missing = await preflight();
if (missing.length) {
  console.log(`\n  SKIPPED — ${missing.join("; ")}\n`);
  console.log("0 passed\n"); // a skip is zero checks, never a pass
  process.exit(0);
}

// A throwaway database, recreated every run so a previous failure cannot leak into this one.
const PSQL = process.env.E2E_PSQL || "C:/pgportable/pgsql/bin/psql.exe";
const adminUrl = pgUrl("postgres");
try {
  execSync(`"${PSQL}" "${adminUrl}" -q -c "DROP DATABASE IF EXISTS ${DB} WITH (FORCE);" -c "CREATE DATABASE ${DB};"`, { stdio: "pipe" });
} catch (e) {
  console.log(`\n  SKIPPED — could not create ${DB}: ${String(e.message).split("\n")[0]}\n`);
  console.log("0 passed\n");
  process.exit(0);
}
execSync(`npx prisma db push --skip-generate --accept-data-loss`, {
  cwd: SERVER_DIR,
  env: { ...process.env, DATABASE_URL: pgUrl(DB), DIRECT_URL: pgUrl(DB) },
  stdio: "pipe",
});
const counts = await seed(DB);

const r = recorder();
let server = null;
let b = null;

try {
  server = await startServer({ dbName: DB, port: PORT });
  b = await new Browser(9333).launch({ width: 1280, height: 900 });
  const BASE = server.base;

  r.section(`Fixture shop: ${counts.active} active of ${counts.products} products, ${counts.categories} categories`);

  // ─────────────────────────────────────────────────────────────────────────────
  r.section("browse → the storefront renders products, not an error state:");
  await b.goto(`${BASE}/`, { waitFor: "document.querySelectorAll('a[href^=\"/product/\"]').length > 0" });
  const homeCards = await b.count('a[href^="/product/"]');
  r.ck("home shows product cards", homeCards > 0, `${homeCards} cards`);
  const homeText = await b.text();
  r.ck("home is not an error state", !/something went wrong|nothing here yet/i.test(homeText),
    homeText.slice(0, 80));
  r.ck("no uncaught page errors on home", b.pageErrors.length === 0, b.pageErrors[0] ?? "");

  await b.goto(`${BASE}/shop`, { waitFor: "document.querySelectorAll('a[href^=\"/product/\"]').length > 0" });
  const shopCards = await b.count('a[href^="/product/"]');
  r.ck("shop lists the active catalogue", shopCards >= 10, `${shopCards} cards for ${counts.active} active`);
  const shopText = await b.text();
  r.ck("hidden products never appear on the shelf", !/Hidden Test Serum/i.test(shopText));

  // ─────────────────────────────────────────────────────────────────────────────
  r.section("search → a misspelling still finds the product:");
  await b.goto(`${BASE}/search?q=shampo`, { waitFor: "document.body.innerText.includes('Shampoo') || document.body.innerText.includes('No items')" });
  const searchText = await b.text();
  r.ck('"shampo" finds a shampoo', /shampoo/i.test(searchText), searchText.slice(0, 120));
  const firstResult = await b.eval(`document.querySelector('a[href^="/product/"]')?.innerText ?? ""`);
  r.ck("the first result is a shampoo, not a lipstick", /shampoo/i.test(firstResult), firstResult);

  // ─────────────────────────────────────────────────────────────────────────────
  r.section("product → the page a customer decides on:");
  await b.goto(`${BASE}/product/keratin-shampoo`, { waitFor: "document.body.innerText.includes('Keratin Shampoo')" });
  const prodText = await b.text();
  r.ck("product name is on the page", /Keratin Shampoo/.test(prodText));
  // `usd()` drops decimals on whole amounts, so 1200c renders as "$12", not "$12.00". The
  // negative lookahead stops "$120" from satisfying a check for "$12".
  r.ck("price is shown", /\$12(?!\d)/.test(prodText), prodText.match(/\$[\d.]+/g)?.join(" ") ?? "no price");
  // The supplier reorder code must never reach a customer — same rule the SEO suite asserts.
  r.ck("no SKU anywhere on the product page", !/\bsku\b/i.test(prodText));

  // ─────────────────────────────────────────────────────────────────────────────
  r.section("cart → adding, and the total the customer sees:");
  await b.click("text=Add to bag");
  await sleep(900);
  await b.goto(`${BASE}/cart`, { waitFor: "document.body.innerText.includes('Keratin Shampoo') || document.body.innerText.includes('empty')" });
  const cartText = await b.text();
  r.ck("the product is in the bag", /Keratin Shampoo/.test(cartText), cartText.slice(0, 120));
  r.ck("the bag shows a subtotal", /\$12(?!\d)/.test(cartText), cartText.match(/\$[\d.]+/g)?.join(" ") ?? "none");
  await b.shot(SHOTS, "cart");

  // ─────────────────────────────────────────────────────────────────────────────
  r.section("checkout → an order exists afterwards, priced by the server:");
  await b.goto(`${BASE}/checkout`, { waitFor: `[...document.querySelectorAll('label')].some((l) => /full name/i.test(l.textContent))` });
  await b.fillByLabel("Full name", "E2E Customer");
  await b.fillByLabel("Phone number", "70123456");
  await b.fillByLabel("Delivery area", "Beirut");
  await b.fillByLabel("City or town", "Beirut");
  await b.fillByLabel("Full address", "12 Test Street, 3rd floor, near the pharmacy");
  await sleep(300);
  const beforeText = await b.text();
  // Beirut is 200c delivery; the bag is 1200c. Server-side money is the thing under test.
  r.ck("checkout shows the delivery fee for the chosen area", /\$2(?!\d)/.test(beforeText),
    beforeText.match(/\$[\d.]+/g)?.join(" ") ?? "none");
  await b.shot(SHOTS, "checkout-filled");

  await b.click("text=Place order");
  await b.waitFor(`location.pathname.startsWith('/order/') || document.body.innerText.toLowerCase().includes('thank')`,
    { timeout: 30000, label: "order confirmation" });
  const afterUrl = await b.url();
  const afterText = await b.text();
  r.ck("checkout lands on a confirmation", /\/order\//.test(afterUrl) || /thank|received/i.test(afterText), afterUrl);
  await b.shot(SHOTS, "order-placed");

  // The real assertion: a row exists, with server-computed money.
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: pgUrl(DB) } } });
  const order = await db.order.findFirst({ orderBy: { id: "desc" }, include: { items: true } });
  r.ck("an order row exists", !!order, "none found");
  if (order) {
    r.ck("it holds the item that was in the bag", order.items.some((i) => /Keratin Shampoo/.test(i.name)),
      order.items.map((i) => i.name).join(", "));
    r.ck("subtotal is the server's number, not the client's", order.subtotalCents === 1200, `${order.subtotalCents}`);
    r.ck("delivery is the chosen area's fee", order.deliveryCents === 200, `${order.deliveryCents}`);
    r.ck("total reconciles: subtotal + delivery - discounts",
      order.totalCents === order.subtotalCents + order.deliveryCents - order.discountCents - order.giftCardCents,
      `${order.totalCents} vs ${order.subtotalCents}+${order.deliveryCents}-${order.discountCents}-${order.giftCardCents}`);
    r.ck("it starts in the received state", order.status === "received", order.status);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  r.section("free delivery threshold → the claim the storefront makes is honoured:");
  /**
   * Threshold is 6000c. Night cream 2600 + quad 2100 + day cream 1800 = 6500.
   *
   * The cart is built by ADDING FROM DIFFERENT PRODUCT PAGES rather than clicking one button
   * twice: after the first add the button's state changes, so a second click on the same page
   * is not reliably a second unit. The first version of this test did exactly that, the cart
   * came to less than the threshold, and the failure read as "free delivery is broken" when the
   * real answer was "the test never filled the basket".
   *
   * So the precondition is asserted on its own line. A failure now says which half went wrong.
   */
  for (const slug of ["night-repair-cream", "eye-shadow-quad", "soft-day-cream"]) {
    await b.goto(`${BASE}/product/${slug}`, { waitFor: `document.body.innerText.length > 200` });
    await b.click("text=Add to bag");
    await sleep(600);
  }
  await b.goto(`${BASE}/cart`, { waitFor: "document.body.innerText.includes('Night Repair Cream')" });
  const bagSubtotal = await b.eval(`
    (() => JSON.parse(localStorage.getItem('tg_cart') || '[]').reduce((n, i) => n + (i.priceCents ?? 0) * (i.qty ?? 1), 0))()
  `).catch(() => -1);
  r.ck("the bag clears the free-delivery threshold before we check the claim",
    bagSubtotal >= 6000 || /\$6[5-9]|\$7\d/.test(await b.text()), `cart subtotal ${bagSubtotal}c, threshold 6000c`);

  await b.goto(`${BASE}/checkout`, { waitFor: `[...document.querySelectorAll('label')].some((l) => /full name/i.test(l.textContent))` });
  await b.fillByLabel("Delivery area", "Mount Lebanon");
  await sleep(600);
  const bigText = await b.text();
  // The summary row reads "Delivery … Free" — assert on that row, not on the marketing copy
  // elsewhere on the page that also contains the word "delivery".
  const deliveryRow = await b.eval(`
    (() => {
      const dt = [...document.querySelectorAll('dt')].find((e) => /deliver/i.test(e.textContent));
      return dt ? (dt.textContent + " = " + (dt.nextElementSibling?.textContent ?? "")) : "";
    })()
  `);
  r.ck("delivery reads as Free once the threshold is cleared", /free/i.test(deliveryRow),
    deliveryRow || bigText.slice(0, 100));

  // ─────────────────────────────────────────────────────────────────────────────
  r.section("brand directory → no card leads to an empty shelf:");
  /**
   * The directory counts a brand's products as active OR unavailable; the shop defaults to
   * active-only. Five real brands sat in the gap — listed here, empty when clicked. This walks
   * the actual link rather than checking the API, because the defect lived in the href.
   */
  await b.goto(`${BASE}/brands`, { waitFor: "document.body.innerText.includes('Solene')" });
  const listed = await b.eval(`document.body.innerText.includes('Solene')`);
  r.ck("a brand whose only product is out of stock is still listed", listed);

  const href = await b.eval(`
    (() => {
      const a = [...document.querySelectorAll('a[href*="brand="]')].find((x) => /solene/i.test(x.innerText));
      return a ? a.getAttribute('href') : "";
    })()
  `);
  r.ck("its link carries availability, so the shelf can show it", /available=0/.test(href), href || "no link found");

  await b.click("text=Solene");
  await b.waitFor(`location.search.includes('brand=solene')`, { label: "brand shelf" });
  // Poll for the shelf to SETTLE — a product card, or an explicit empty state. A fixed sleep
  // here read the page mid-fetch and reported an empty shelf that was merely still loading,
  // which is the same trap that made an earlier harness report "no rows" for a slow table.
  await b.waitFor(
    `document.querySelectorAll('a[href^="/product/"]').length > 0 || /no items|nothing here/i.test(document.body.innerText)`,
    { timeout: 20000, label: "brand shelf to settle" },
  );
  /**
   * Asserted on the product LINK, not on the fixture's name string.
   *
   * The card renders the brand as an eyebrow and strips the redundant prefix from the title, so
   * "Solene Hand Cream" appears on screen as "SOLENE" above "Hand Cream" and a text match for
   * the seeded name fails on a shelf that is displaying the product perfectly. The link is what
   * "the shelf has this product" actually means, and it survives any change to how a card is
   * laid out.
   */
  const onShelf = await b.eval(`!!document.querySelector('a[href="/product/solene-hand-cream"]')`);
  const shelfText = await b.text();
  r.ck("the shelf is NOT empty on arrival", onShelf,
    shelfText.match(/No items|Nothing here[^\n]*/i)?.[0] ?? "no product link found");
  r.ck("and the product is badged as unavailable rather than passed off as sellable",
    /unavailable/i.test(shelfText));
  // The checkbox must agree with what is on screen, or the page contradicts itself the other way.
  const boxTicked = await b.eval(`
    (() => {
      const lab = [...document.querySelectorAll('label')].find((l) => /include temporarily unavailable/i.test(l.textContent));
      return lab ? !!lab.querySelector('input[type=checkbox]')?.checked : null;
    })()
  `);
  r.ck('"Include temporarily unavailable" shows ticked, matching the shelf', boxTicked === true, String(boxTicked));

  // ─────────────────────────────────────────────────────────────────────────────
  r.section("admin → the operator can see the order that was just placed:");
  await b.goto(`${BASE}/admin`);
  await sleep(1200);
  await b.eval(`localStorage.setItem("tg_admin_key", ${JSON.stringify(server.adminKey)}); "ok"`);
  await b.goto(`${BASE}/admin/orders`, { waitFor: `document.body.innerText.includes('E2E Customer') || document.body.innerText.includes('No orders')` });
  const ordersText = await b.text();
  r.ck("the order appears in admin", /E2E Customer/.test(ordersText), ordersText.slice(0, 150));
  await b.shot(SHOTS, "admin-orders");

  r.ck("no uncaught page errors across the whole journey", b.pageErrors.length === 0,
    b.pageErrors.slice(0, 2).join(" | "));

  await db.$disconnect();
} catch (e) {
  r.ck(`unexpected: ${String(e.message).split("\n")[0]}`, false);
  try { if (b) await b.shot(SHOTS, "failure"); } catch { /* screenshot is best-effort */ }
} finally {
  if (b) await b.close();
  stopServer(server);
}

console.log(`\n${r.fail ? `${r.fail} FAILED, ` : ""}${r.pass} passed\n`);
process.exitCode = r.fail ? 1 : 0;
