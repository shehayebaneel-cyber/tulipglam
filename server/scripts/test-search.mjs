/**
 * Search — typo tolerance, cross-field matching, and the no-side-door rule.
 *
 *     node --import tsx scripts/test-search.mjs --write
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  --write creates one hidden product on a reserved slug to prove hidden stock
 *  cannot be found, then deletes it in a `finally` that is allowed to run.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Every assertion is written from the requirement's own words, quoted above it.
 */
const { PrismaClient } = await import("@prisma/client");
const { searchProductIds, normalise, buildSearchText } = await import("../src/search.ts");
const { refreshSearchText } = await import("../src/searchIndex.ts");
const { loadCards } = await import("../src/cards.ts");

// The ranking bug lived in the HTTP handler, not in the search module, so part of this suite
// has to go through the real server. Same requirement as test-seo / test-checkout-money.
const API = process.env.API_URL || "http://localhost:4230";

const WRITE = process.argv.includes("--write");
let pass = 0, fail = 0;
const ck = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${ok ? "" : "  " + x}`); };
const section = (t) => console.log(`\n${t}`);

const db = new PrismaClient();
const VISIBLE = ["active", "unavailable"];
const made = [];
const SLUG = "zzz-search-test-hidden-product";

/** Does any hit's name contain this? Used to assert we found the RIGHT thing, not merely a thing. */
async function topNames(q, n = 5) {
  const hits = await searchProductIds(db, q, VISIBLE, n);
  if (!hits.length) return [];
  const rows = await db.product.findMany({ where: { id: { in: hits.map((h) => h.id) } }, select: { id: true, name: true } });
  const order = new Map(hits.map((h, i) => [h.id, i]));
  return rows.sort((a, b) => order.get(a.id) - order.get(b.id)).map((r) => r.name);
}

try {

section('"a letter wrong, missing, doubled, or swapped still finds it":');
{
  const cases = [
    ["shampo", /shampoo/i, "letter missing"],
    ["mascarra", /mascara/i, "letter doubled"],
    ["conditoner", /conditioner/i, "letters swapped"],
    ["deoderant", /deodorant/i, "letter wrong"],
    ["maybeline", /maybelline/i, "letter missing, brand"],
    ["nivia", /nivea/i, "letter wrong, brand"],
  ];
  for (const [q, want, why] of cases) {
    const names = await topNames(q);
    ck(`"${q}" finds it (${why})`, names.some((n) => want.test(n)), names[0] ?? "(nothing)");
  }
}

section('"punctuation and accents are forgiven":');
{
  const loreal = await topNames("loreal");
  ck(`"loreal" finds L'Oréal`, loreal.some((n) => /oréal|oreal/i.test(n)), loreal[0] ?? "(nothing)");
  ck("normalise folds the accent and apostrophe", normalise("L'Oréal Paris") === "loreal paris", normalise("L'Oréal Paris"));
  ck("normalise folds dashes and dots", normalise("Anti-Wrinkle 3.5%") === "anti wrinkle 3 5", normalise("Anti-Wrinkle 3.5%"));

  // "lipliner" and "lip liner" are the same search.
  const a = await topNames("lipliner", 3);
  const b = await topNames("lip liner", 3);
  ck(`"lipliner" finds a lip liner`, a.some((n) => /lip ?liner/i.test(n)), a[0] ?? "(nothing)");
  ck(`"lip liner" finds one too`, b.some((n) => /lip ?liner/i.test(n)), b[0] ?? "(nothing)");
}

section('"brand and product cross" — neither field alone says both words:');
{
  const names = await topNames("nivea cream", 5);
  ck(`"nivea cream" finds a Nivea product named ...Cream`, names.some((n) => /nivea/i.test(n) && /cream/i.test(n)), names[0] ?? "(nothing)");
  const d = await topNames("dior sauvage", 3);
  ck(`"dior sauvage" finds Dior Sauvage`, d.some((n) => /dior/i.test(n) && /sauvage/i.test(n)), d[0] ?? "(nothing)");
}

section('"forgiving is not the same as returning everything":');
{
  // A query that means nothing must not drag in the catalogue.
  const junk = await searchProductIds(db, "qwertyuiopzxcv", VISIBLE, 50);
  ck("nonsense returns nothing at all", junk.length === 0, `${junk.length} hits`);

  // Every token must match — adding an impossible word must narrow, never widen.
  const nivea = await searchProductIds(db, "nivea", VISIBLE, 400);
  const both = await searchProductIds(db, "nivea qwertyuiop", VISIBLE, 400);
  ck("an unmatchable extra word narrows to nothing", both.length === 0, `${nivea.length} -> ${both.length}`);

  const active = await db.product.count({ where: { status: { in: VISIBLE } } });
  const broad = await searchProductIds(db, "cream", VISIBLE, 400);
  ck("a common word does not return the whole shop", broad.length < active * 0.5, `${broad.length} of ${active}`);
}

section('"exact and near matches first":');
{
  const names = await topNames("garnier", 5);
  ck("an exact brand query puts that brand on top", /garnier/i.test(names[0] ?? ""), names[0] ?? "(nothing)");
}

section('"only active products are searchable — no side door":');
if (WRITE) {
  const cat = await db.category.findFirst({ where: { active: true }, select: { id: true } });
  const p = await db.product.create({
    data: {
      slug: SLUG, name: "Zzz Searchtest Unobtainium Serum", status: "hidden",
      priceCents: 999, categoryId: cat.id, source: "test",
    },
    select: { id: true },
  });
  made.push(p.id);
  // Give it a searchText, so this proves the STATUS filter blocks it — not an empty column.
  await refreshSearchText(db, { write: true, source: "test" });
  const withText = await db.product.findUnique({ where: { id: p.id }, select: { searchText: true } });
  ck("the hidden product does have searchable text", withText.searchText.includes("unobtainium"), withText.searchText.slice(0, 40));

  const visible = await searchProductIds(db, "unobtainium", VISIBLE, 20);
  ck("...and searching for it as a customer finds NOTHING", visible.length === 0, `${visible.length} hits`);

  // The same query, told hidden is allowed, must find it — otherwise the test above passes
  // for the wrong reason and would keep passing if search silently broke.
  const asAdmin = await searchProductIds(db, "unobtainium", ["hidden"], 20);
  ck("...while an explicit hidden search does find it, so the check means something", asAdmin.length === 1, `${asAdmin.length} hits`);
} else {
  console.log("  skip  needs --write");
}

section('"exact and near matches first, fuzzier after" — on the page customers actually use:');
{
  /**
   * The bug this catches was invisible from the search layer.
   *
   * `searchProductIds` ranked correctly all along; `/api/products` then pushed the ids into a
   * `where` and re-sorted the whole set by status/best-seller/recency, discarding the ranking.
   * Searching "shampo" put a **Maybelline lipstick sixth**, above dozens of real shampoos,
   * because it happened to be a best-seller. Testing `searchProductIds` alone passed throughout.
   *
   * So this asserts against the ENDPOINT, over HTTP, which is where the defect lived.
   */
  const res = await fetch(`${API}/api/products?q=shampo&limit=10`).catch(() => null);
  if (!res || !res.ok) {
    ck("shop search reachable (is the API on :4230?)", false, res ? `HTTP ${res.status}` : "no response");
  } else {
    const body = await res.json();
    const names = body.products.map((p) => p.name);
    ck('every result on page 1 of "shampo" is a shampoo', names.every((n) => /shampoo/i.test(n)),
      names.find((n) => !/shampoo/i.test(n)) ?? "");

    // Relevance must be the DEFAULT for a search, not an option nobody selects.
    const explicit = await (await fetch(`${API}/api/products?q=shampo&limit=10&sort=relevance`)).json();
    ck("the default sort for a search already IS relevance",
      JSON.stringify(explicit.products.map((p) => p.id)) === JSON.stringify(body.products.map((p) => p.id)));

    // Choosing a sort must still override — a customer who picked one means it.
    const byName = await (await fetch(`${API}/api/products?q=shampo&limit=10&sort=name`)).json();
    ck("an explicitly chosen sort still overrides relevance",
      JSON.stringify(byName.products.map((p) => p.id)) !== JSON.stringify(body.products.map((p) => p.id)));

    // The fast path (ranked ids used directly) and the slow path (re-queried under filters)
    // must agree on how many products matched, or one of them is lying to the customer.
    const filtered = await (await fetch(`${API}/api/products?q=shampo&limit=10&sort=name`)).json();
    ck("fast and slow paths report the same total", filtered.total === body.total, `${body.total} vs ${filtered.total}`);
  }
}

section('"a floor below which junk doesn\'t flood in":');
{
  // The fallback bar (0.30) only fires when the strict bar (0.42) found nothing. It must not
  // turn keyboard mash into a catalogue dump.
  const mash = ["qwertyuiop", "zxcvbnmasdf", "asdfghjkl", "poiuytrewq", "lkjhgfdsa", "mnbvcxz", "aaaaaaaa"];
  let worst = 0, worstQ = "";
  for (const m of mash) {
    const n = (await searchProductIds(db, m, VISIBLE, 400)).length;
    if (n > worst) { worst = n; worstQ = m; }
  }
  ck("keyboard mash returns nothing at all", worst === 0, `"${worstQ}" returned ${worst}`);

  // A real transposition must survive — the requirement names "swapped" explicitly, and
  // "granier" scores 0.375, below the strict floor. This is what the fallback exists for.
  const g = await topNames("granier", 3);
  ck('"granier" still finds Garnier (transposition, via the fallback)', /garnier/i.test(g[0] ?? ""), g[0] ?? "(nothing)");

  // ...and the fallback must not have quietly become the floor for everything.
  const strictStillHolds = await searchProductIds(db, "nivea qwertyuiop", VISIBLE, 400);
  ck("an impossible extra word still narrows to nothing", strictStillHolds.length === 0, `${strictStillHolds.length} hits`);
}

section("loadCards returns exactly what Prisma's include returned:");
{
  /**
   * The card loader was replaced for speed. Speed that changes the data is not a win, so this
   * asserts the two produce identical cards rather than trusting that they do.
   */
  const hits = await searchProductIds(db, "shampoo", VISIBLE, 6);
  const ids = hits.map((h) => h.id);
  const viaPrisma = await db.product.findMany({
    where: { id: { in: ids } },
    include: { brand: true, category: true, images: { orderBy: { sortOrder: "asc" }, take: 1 } },
  });
  const viaJoin = await loadCards(db, ids);
  const key = (p) => JSON.stringify([p.id, p.slug, p.name, p.status, p.priceCents, p.saleCents, p.glyph,
    p.tint, p.isBestSeller, p.isNewMode, p.createdAt, p.images[0]?.url ?? "", p.brandId ?? null, p.brand?.slug ?? null, p.category.slug]);
  const byId = new Map(viaPrisma.map((p) => [p.id, key(p)]));
  ck("same number of cards", viaJoin.length === viaPrisma.length, `${viaJoin.length} vs ${viaPrisma.length}`);
  ck("every field identical", viaJoin.every((p) => byId.get(p.id) === key(p)),
    viaJoin.find((p) => byId.get(p.id) !== key(p))?.name ?? "");
  ck("relevance order preserved by loadCards", viaJoin.map((p) => p.id).join(",") === ids.join(","));
}

section("buildSearchText folds every field a customer might type:");
{
  const t = buildSearchText({ name: "Soft Cream", brandName: "Nivea", categoryName: "Moisturisers", parentCategoryName: "Skincare", concerns: "hydration", attributes: "" });
  ck("it contains the product name", t.includes("soft cream"));
  ck("it contains the brand", t.includes("nivea"));
  ck("it contains the category", t.includes("moisturisers"));
  ck("it contains a space-stripped copy", t.includes("softcreamnivea"), t.slice(0, 60));
}

} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 4).join("\n        ")}`);
} finally {
  // Runs to completion. No process.exit() above it — that is how test rows reached production.
  if (made.length) await db.product.deleteMany({ where: { id: { in: made } } });
  const left = await db.product.count({ where: { slug: SLUG } });
  console.log(`\n  cleanup: ${left} test product(s) left behind (want 0)`);
  if (left) fail++;
  await db.$disconnect();
}

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exitCode = fail ? 1 : 0;
