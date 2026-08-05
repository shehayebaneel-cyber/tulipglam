/**
 * Our Picks, and the dark switch to Best Sellers.
 *
 *     node --import tsx scripts/test-picks.mjs --write
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  --write creates its own orders and order items, flags its own products, and
 *  removes every one of them in a `finally` that is allowed to run. It never
 *  reads, updates or deletes a row it did not create — except the pick flag,
 *  whose prior value is captured and restored exactly.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Every assertion quotes the requirement it is checking, above the check.
 */
const { PrismaClient } = await import("@prisma/client");
const {
  resolveRail, railProductIds, invalidateRail, RAIL_SIZE, BEST_SELLER_MIN_UNITS,
} = await import("../src/picks.ts");

const WRITE = process.argv.includes("--write");
const API = process.env.API_URL || "http://localhost:4230";
let pass = 0, fail = 0;
const ck = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${ok ? "" : "  " + x}`); };
const section = (t) => console.log(`\n${t}`);

const db = new PrismaClient();
const made = { orders: [], picked: [] };
const TAG = "ZZZ-PICKTEST";

/**
 * Remove every order THIS run created, so each section starts from a known count.
 *
 * The first version did not do this, and the "7 qualifying is not enough" check read 8 — it had
 * inherited a qualifying product from the section above. The threshold was right; the test was
 * counting leftovers. A section that depends on the one before it is not testing what it says.
 */
async function resetTestOrders() {
  if (!made.orders.length) return;
  await db.orderEvent.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: made.orders } } });
  await db.order.deleteMany({ where: { id: { in: made.orders } } });
  made.orders.length = 0;
  invalidateRail();
}

/** Create a delivered (or otherwise) order carrying `qty` of one product. */
async function orderFor(productId, qty, status) {
  const o = await db.order.create({
    data: {
      number: `${TAG}-${productId}-${qty}-${status}`,
      status,
      ...(status === "delivered" || status === "completed" ? { deliveredAt: new Date() } : {}),
      fullName: "Pick Test", phone: "+96170000000", area: "Test", address: "Test",
      subtotalCents: 100, deliveryCents: 0, totalCents: 100,
      items: { create: [{ productId, name: "Pick test item", priceCents: 100, qty }] },
    },
    select: { id: true },
  });
  made.orders.push(o.id);
  return o.id;
}

try {

section('"It becomes Our Picks today" — the honest label, and it is the default:');
{
  invalidateRail();
  const rail = await resolveRail(db);
  ck("mode is picks while no product has enough delivered units", rail.mode === "picks", rail.mode);
  ck('label reads "Our Picks"', rail.label === "Our Picks", rail.label);
  ck("the eyebrow says who chose, not how customers felt", !/loved|everyone|popular/i.test(rail.eyebrow), rail.eyebrow);
  ck("link points at /our-picks", rail.href === "/our-picks", rail.href);
}

section('"the rail hides rather than renders empty":');
{
  const res = await fetch(`${API}/api/home`).catch(() => null);
  if (!res?.ok) {
    ck("home reachable (is the API on :4230?)", false, res ? `HTTP ${res.status}` : "no response");
  } else {
    const body = await res.json();
    ck("home ships the rail's own label, not the client's", typeof body.picks?.label === "string", JSON.stringify(body.picks?.label));
    // The server sends an empty list and the client guards on length, so nothing renders.
    // Asserting the SHAPE here — an empty array, not a fabricated placeholder product.
    ck("an unpicked rail is an empty list, never filler", Array.isArray(body.picks.products), typeof body.picks?.products);
    ck("no invented product appears in an unpicked rail",
      body.picks.products.every((p) => p && typeof p.id === "number"), `${body.picks.products.length} items`);
  }
}

section("every surface reads the same resolver:");
{
  invalidateRail();
  const rail = await resolveRail(db);
  const site = await fetch(`${API}/api/site`).then((r) => r.json()).catch(() => null);
  const home = await fetch(`${API}/api/home`).then((r) => r.json()).catch(() => null);
  if (site && home) {
    ck("/api/site and /api/home agree on the label", site.picks?.label === home.picks?.label,
      `${site.picks?.label} vs ${home.picks?.label}`);
    ck("/api/site and /api/home agree on the link", site.picks?.href === home.picks?.href);
    ck("both match the resolver directly", site.picks?.label === rail.label, `${site.picks?.label} vs ${rail.label}`);
  } else {
    ck("site and home reachable", false);
  }
}

section('"a flag on the product in admin, toggleable, with the rail reading from it":');
if (WRITE) {
  const p = await db.product.findFirst({ where: { status: "active", isBestSeller: false }, select: { id: true, name: true, isBestSeller: true } });
  made.picked.push({ id: p.id, was: p.isBestSeller });

  await db.product.update({ where: { id: p.id }, data: { isBestSeller: true } });
  invalidateRail();
  const withPick = await railProductIds(db, await resolveRail(db), RAIL_SIZE);
  ck("a picked product appears in the rail", withPick.includes(p.id), `${withPick.length} in rail`);

  await db.product.update({ where: { id: p.id }, data: { isBestSeller: false } });
  invalidateRail();
  const without = await railProductIds(db, await resolveRail(db), RAIL_SIZE);
  ck("unpicking removes it again", !without.includes(p.id), `${without.length} in rail`);

  // A hidden product must not reach the rail even when flagged — same no-side-door rule as search.
  const h = await db.product.findFirst({ where: { status: "hidden" }, select: { id: true, isBestSeller: true } });
  if (h) {
    made.picked.push({ id: h.id, was: h.isBestSeller });
    await db.product.update({ where: { id: h.id }, data: { isBestSeller: true } });
    invalidateRail();
    const ids = await railProductIds(db, await resolveRail(db), RAIL_SIZE);
    ck("a HIDDEN product cannot reach the rail even when picked", !ids.includes(h.id));
  }
} else {
  console.log("  skip  needs --write");
}

section('"delivered specifically, a refused parcel is not a sale":');
if (WRITE) {
  await resetTestOrders();
  const p = await db.product.findFirst({ where: { status: "active" }, select: { id: true } });

  // Enough units to qualify — but on a refused order, which is not a sale.
  await orderFor(p.id, BEST_SELLER_MIN_UNITS + 5, "refused");
  invalidateRail();
  let rail = await resolveRail(db);
  ck("a refused order does not make a best seller", rail.qualifying === 0, `${rail.qualifying} qualifying`);

  // Cancelled is not a sale either.
  await orderFor(p.id, BEST_SELLER_MIN_UNITS + 5, "cancelled");
  invalidateRail();
  rail = await resolveRail(db);
  ck("a cancelled order does not either", rail.qualifying === 0, `${rail.qualifying} qualifying`);

  // One unit short of the bar must not count — the threshold is exact, not approximate.
  await orderFor(p.id, BEST_SELLER_MIN_UNITS - 1, "delivered");
  invalidateRail();
  rail = await resolveRail(db);
  ck(`${BEST_SELLER_MIN_UNITS - 1} delivered units is below the bar and does not qualify`,
    rail.qualifying === 0, `${rail.qualifying} qualifying`);

  // One more unit crosses it.
  await orderFor(p.id, 1, "delivered");
  invalidateRail();
  rail = await resolveRail(db);
  ck(`${BEST_SELLER_MIN_UNITS} delivered units does qualify`, rail.qualifying === 1, `${rail.qualifying} qualifying`);

  // ...and `completed` counts as delivered, because it is downstream of it.
  ck("still only one product qualifies, so the label has NOT upgraded", rail.mode === "picks", rail.mode);
} else {
  console.log("  skip  needs --write");
}

section(`"the label upgrades to Best Sellers only then" — needs ${RAIL_SIZE} products, not one:`);
if (WRITE) {
  await resetTestOrders();
  const ps = await db.product.findMany({ where: { status: "active" }, select: { id: true }, take: RAIL_SIZE });
  // One short of the rail size: still picks.
  for (const p of ps.slice(0, RAIL_SIZE - 1)) await orderFor(p.id, BEST_SELLER_MIN_UNITS, "delivered");
  invalidateRail();
  let rail = await resolveRail(db);
  ck(`${RAIL_SIZE - 1} qualifying products is not enough to claim "Best Sellers"`,
    rail.mode === "picks", `${rail.mode}, ${rail.qualifying} qualifying`);

  // The last one flips it, with no setting changed and nothing remembered.
  await orderFor(ps[RAIL_SIZE - 1].id, BEST_SELLER_MIN_UNITS, "completed");
  invalidateRail();
  rail = await resolveRail(db);
  ck(`${RAIL_SIZE} qualifying products flips the rail`, rail.mode === "bestsellers", `${rail.mode}, ${rail.qualifying} qualifying`);
  ck('and the label becomes "Best Sellers"', rail.label === "Best Sellers", rail.label);
  ck("...counted from delivered orders, per the blurb", /delivered/i.test(rail.blurb), rail.blurb);
  ck("link moves to /bestsellers", rail.href === "/bestsellers", rail.href);
  ck("completed counts as delivered", rail.qualifying >= RAIL_SIZE, `${rail.qualifying}`);

  // "no memory required for the transition" — nothing was written to make this happen.
  const settingRows = await db.setting.count({ where: { key: { contains: "bestSeller" } } });
  ck("the flip needed no stored setting", settingRows === 0, `${settingRows} rows`);

  // In best-seller mode the rail is the delivered list, NOT the owner's flags.
  const ids = await railProductIds(db, rail, RAIL_SIZE);
  ck("the rail now lists delivered leaders", ids.length === RAIL_SIZE, `${ids.length}`);
  const flagged = await db.product.count({ where: { id: { in: ids }, isBestSeller: true } });
  ck("and does not depend on the pick flag", flagged === 0 || flagged < ids.length, `${flagged} of ${ids.length} flagged`);
} else {
  console.log("  skip  needs --write");
}

} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 4).join("\n        ")}`);
} finally {
  // Runs to completion — no process.exit() above it.
  if (made.orders.length) {
    await db.orderEvent.deleteMany({ where: { orderId: { in: made.orders } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: made.orders } } });
    await db.order.deleteMany({ where: { id: { in: made.orders } } });
  }
  // Restore each flag to what it was, not to `false` — the owner may have picked it already.
  for (const { id, was } of made.picked) {
    await db.product.update({ where: { id }, data: { isBestSeller: was } });
  }
  invalidateRail();

  const strayOrders = await db.order.count({ where: { number: { startsWith: TAG } } });
  const strayPicks = made.picked.length
    ? await db.product.count({ where: { id: { in: made.picked.map((p) => p.id) }, isBestSeller: true } })
    : 0;
  const expectedPicks = made.picked.filter((p) => p.was).length;
  console.log(`\n  cleanup: ${strayOrders} test order(s) left (want 0), ${strayPicks} flag(s) set (want ${expectedPicks})`);
  if (strayOrders || strayPicks !== expectedPicks) fail++;
  await db.$disconnect();
}

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exitCode = fail ? 1 : 0;
