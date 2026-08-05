/**
 * Cross-feed integrity sweep over the live catalogue.
 *
 *     node --env-file=.env --import tsx scripts/catalog-sweep.mjs            # print
 *     node --env-file=.env --import tsx scripts/catalog-sweep.mjs --write    # also write ../.night/catalog-sweep.md
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 *  READ-ONLY. `--write` writes the REPORT FILE and nothing else — it does not modify a
 *  single database row, and there is no flag anywhere in here that does. Every duplicate
 *  is a RECOMMENDATION for a human to act on; nothing is merged, hidden or deleted.
 * ══════════════════════════════════════════════════════════════════════════════════════
 *
 * That promise is enforced rather than asserted: the Prisma client below is wrapped in an
 * extension that allows an explicit list of READ operations and throws on anything else.
 * A future edit that adds an `updateMany` fails loudly instead of quietly writing to a
 * database that is shared with production. Fails closed — a new Prisma operation is
 * refused until it is deliberately named, the same rule as PUBLIC_SETTINGS in `/api/site`.
 *
 * ── WHY A SWEEP EXISTS AT ALL ─────────────────────────────────────────────────────────
 *
 * `prisma/import-feel22.ts` skips a Feel22 product that duplicates one we already carry
 * direct — but only at import time, only against `dali`/`beesline`, and only inside the
 * same Brand row. Anything imported before that guard existed, anything scoring under the
 * threshold, and anything whose two feeds landed under two different Brand rows is still
 * sitting in the catalogue competing with itself. This reports it.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const { loadAllowlist } = await import("../prisma/brandAllowlist.ts");

const WRITE = process.argv.includes("--write");
const OUT = path.resolve(import.meta.dirname, "../../.night/catalog-sweep.md");

/** Prisma operations this script is allowed to perform. Anything else throws. */
const READ_ONLY_OPS = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow",
  "count", "aggregate", "groupBy",
]);

const db = new PrismaClient().$extends({
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (!READ_ONLY_OPS.has(operation)) {
          throw new Error(
            `catalog-sweep is read-only: refused ${model}.${operation}(). ` +
            `The database is shared with production; this script reports, it never merges.`,
          );
        }
        return query(args);
      },
    },
  },
});

// ─────────────────────────────────────────────────────────── the matcher, copied verbatim
//
// Lifted UNCHANGED from `prisma/import-feel22.ts` (the block above `main()`). It is a copy
// rather than an import because that file calls `main()` at module load and exports nothing,
// so importing it would run the destructive Feel22 import. If either copy is ever edited,
// extract the block to a shared module in the same change — a sweep that scores differently
// from the importer is worse than no sweep, because the two would disagree about the same
// pair and nobody would know which to believe.
//
// Keeping the original reasoning with the code it explains:
//
//  * Feel22 prefixes titles with the vendor name ("Beesline Keratin Conditioner 200ml"),
//    and sizes differ between listings, so the brand prefix, volumes and bare numbers are
//    stripped before comparing.
//  * SYMMETRIC Jaccard (intersection / union), NOT containment. Containment scores a short
//    title fully inside a longer one at 1.0, which made bundles match their own components —
//    "Everyone Barrier Cream + Super Hydrating Serum" matched plain "Everyone Barrier Cream".
//    That would have deleted 156 products instead of skipping 54.
//  * A bundle may only match another bundle.
const MATCH_THRESHOLD = 0.8;
const STOP = new Set(["the", "and", "for", "with", "new", "free", "pack", "offer", "special"]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normaliseTitle(s, brand) {
  let t = s;
  if (brand) t = t.replace(new RegExp("^\\s*" + escapeRe(brand) + "\\s*", "i"), "");
  return t
    .replace(/\(\s*\d+\s*\+\s*\d+[^)]*\)/g, " ")                                  // (1+1 Free)
    .replace(/\b\d+(\.\d+)?\s*(ml|l|g|gm|gr|mg|oz|pcs|caps|tabs)\b/gi, " ")        // 200ml, 50 g
    .replace(/\b\d+\b/g, " ");                                                     // bare numbers
}
const tokens = (s, brand) =>
  new Set(normaliseTitle(s, brand).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const jaccard = (a, b) => {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  const union = a.size + b.size - i;
  return union ? i / union : 0;
};
const isBundle = (s) => /[A-Za-z)]\s+\+\s+[A-Za-z]/.test(s.replace(/\(\s*\d+\s*\+\s*\d+[^)]*\)/g, " "));

/**
 * Pairs scoring between this and MATCH_THRESHOLD are printed as a calibration band — clearly
 * labelled NOT duplicates. They exist so the threshold can be judged against real rows rather
 * than trusted, and so a whole class the matcher cannot see (Feel22 lists each shade as its
 * own product; we list one product with shade variants) is visible instead of silently absent.
 */
const NEAR_FLOOR = 0.5;

// ──────────────────────────────────────────────────────────────────── row-check thresholds
/**
 * A price above this is not a price, it is a units bug.
 *
 * Justified against the catalogue rather than picked: the most expensive genuinely-priced row
 * is $735.00 (a Dyson dryer in the retired Electricals section) and the top honest beauty item
 * is a $449.00 Oral-B. The next price above that is $22,000.00 — there is nothing at all
 * between $735 and $22,000. Everything past the gap is the failure CLAUDE.md already records:
 * Lebanese pounds left in a column that means USD cents (the Mud Mask at 252,390). $1,000 sits
 * inside that gap with room to spare, so it flags only rows wrong by a factor of thirty or more
 * and can never catch a real luxury fragrance. The five dearest rows it does NOT flag are
 * printed under the table so the bound stays auditable.
 */
const ABSURD_ABOVE_CENTS = 100_000;

/** A documented Beesline placeholder tier, counted separately because it is a known signature. */
const PLACEHOLDER_PRICE_CENTS = 50_000;

const DIRECT_SOURCES = new Set(["dali", "beesline"]); // the rest is Feel22, a retailer
const PRINT_LIMIT = 20;   // rows per section on stdout
const FILE_LIMIT = 200;   // rows per section in the markdown

// ───────────────────────────────────────────────────────────────────────────── formatting
const usd = (c) => `$${(c / 100).toFixed(2)}`;
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function table(headers, rows) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (cells) => cells.map((c, i) => String(c ?? "").padEnd(w[i])).join("  ").trimEnd();
  return [line(headers), w.map((n) => "─".repeat(n)).join("  "), ...rows.map(line)].join("\n");
}

function mdTable(headers, rows) {
  const esc = (v) => String(v ?? "").replace(/\|/g, "\\|");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n");
}

/** Everything a section needs to be printed twice: once narrow, once in full. */
const sections = [];
function section(title, note, headers, rows, extra) {
  sections.push({ title, note, headers, rows, extra });
}

function renderStdout() {
  const out = [];
  for (const s of sections) {
    out.push("", `── ${s.title} — ${s.rows.length} ${s.rows.length === 1 ? "row" : "rows"} `.padEnd(100, "─"));
    if (s.note) out.push(s.note);
    if (s.rows.length) {
      out.push("", table(s.headers, s.rows.slice(0, PRINT_LIMIT)));
      if (s.rows.length > PRINT_LIMIT) out.push(`… and ${s.rows.length - PRINT_LIMIT} more (--write for the full list)`);
    } else {
      out.push("", "  none.");
    }
    if (s.extra) out.push("", s.extra);
  }
  return out.join("\n");
}

function renderMarkdown(header) {
  const out = [header];
  for (const s of sections) {
    out.push("", `## ${s.title} — ${s.rows.length}`, "");
    if (s.note) out.push(s.note, "");
    if (s.rows.length) {
      out.push(mdTable(s.headers, s.rows.slice(0, FILE_LIMIT)));
      if (s.rows.length > FILE_LIMIT) out.push("", `_… and ${s.rows.length - FILE_LIMIT} more rows not listed._`);
    } else {
      out.push("_None._");
    }
    if (s.extra) out.push("", "```", s.extra, "```");
  }
  return out.join("\n") + "\n";
}

// ───────────────────────────────────────────────────────────── prove the checks are alive
/**
 * Several sections below legitimately report zero, and a section that reports zero looks
 * exactly like a section whose predicate is broken. So each one is fired once against an
 * input it MUST catch, before any real row is read. A silent zero is the failure mode this
 * whole file exists to avoid; it would be absurd to ship it in the sweep itself.
 *
 * The read-only guard is probed with a real write call — deliberately, because a guard nobody
 * exercises is a guard nobody knows about. It is made safe by construction rather than by
 * trusting the guard it is testing: ids are positive autoincrement, so `id < 0` matches no row
 * even in the impossible case where the throw does not happen.
 */
async function selfCheck() {
  const fail = (m) => { throw new Error(`catalog-sweep self-check failed: ${m}`); };

  // The matcher still matches what the importer says it matches.
  if (jaccard(tokens("Beesline Keratin Conditioner 200ml", "Beesline"), tokens("Keratin Conditioner", "Beesline")) < MATCH_THRESHOLD) {
    fail("the known duplicate pair from CLAUDE.md no longer scores at or above the threshold");
  }
  // …and still refuses the containment regression: a bundle against its own component.
  const bundleTitle = "Everyone Barrier Cream + Super Hydrating Serum";
  if (!isBundle(bundleTitle) || isBundle("Everyone Barrier Cream")) fail("the bundle guard no longer distinguishes a bundle from a component");
  if (jaccard(tokens(bundleTitle), tokens("Everyone Barrier Cream")) >= MATCH_THRESHOLD) {
    fail("a bundle scores as a duplicate of its own component — this is the containment bug returning");
  }

  // The name predicates fire on names that are unarguably unusable.
  if ("   ".trim()) fail("whitespace-only names would not be detected");
  if (tokens("Beesline 200ml", "Beesline").size !== 0) fail("a brand-prefix-only name would not be detected");

  // The read-only guard throws before any SQL is issued.
  let refused = false;
  try {
    await db.product.updateMany({ where: { id: { lt: 0 } }, data: { name: "" } });
  } catch { refused = true; }
  if (!refused) fail("the read-only guard did not refuse a write — refusing to continue against a production database");
}

// ────────────────────────────────────────────────────────────────────────────────── sweep
async function main() {
  await selfCheck();

  const products = await db.product.findMany({
    select: {
      id: true, name: true, slug: true, source: true, status: true, priceCents: true,
      brand: { select: { id: true, slug: true, name: true } },
      category: { select: { slug: true, name: true, active: true } },
      _count: { select: { images: true, variants: true } },
    },
    orderBy: { id: "asc" },
  });
  const brands = await db.brand.findMany({ select: { id: true, name: true, slug: true } });

  const byStatus = {};
  const bySource = {};
  for (const p of products) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    bySource[p.source || "(manual)"] = (bySource[p.source || "(manual)"] || 0) + 1;
  }

  // ── 1. cross-feed duplicates ───────────────────────────────────────────────────────
  const scored = products.map((p) => ({
    ...p,
    toks: tokens(p.name, p.brand?.name),
    bundle: isBundle(p.name),
    images: p._count.images,
    variants: p._count.variants,
  }));
  const feeds = [...new Set(scored.map((p) => p.source))].sort();
  const byFeed = new Map(feeds.map((f) => [f, scored.filter((p) => p.source === f)]));

  /**
   * Two tiers, and the split is the most important judgement in this file.
   *
   * The importer only ever compares products inside ONE Brand row. Running the identical score
   * across brands as well finds more, but most of what it finds is a generic name colliding:
   * strip the vendor prefix and the volume off "Soskin Micellar Water 100ml" and off Beesline's
   * "Micellar Water" and both are {micellar, water} — a perfect 1.00 between two products from
   * two different makers that a customer would never call the same thing. Merging those would
   * delete a real Soskin listing.
   *
   * So same-brand matches are duplicates and carry a keep recommendation; different-brand
   * matches are reported as a separate, explicitly non-actionable list. Same score, same
   * matcher, different claim — the score says "these titles are the same", and only the shared
   * brand turns that into "this is the same product".
   */
  const matches = [];      // same Brand row — the importer's own rule
  const collisions = [];   // identical title, different maker — NOT duplicates
  const near = [];
  let compared = 0;
  for (let i = 0; i < feeds.length; i++) {
    for (let j = i + 1; j < feeds.length; j++) {
      for (const a of byFeed.get(feeds[i])) {
        for (const b of byFeed.get(feeds[j])) {
          if (a.bundle !== b.bundle) continue; // a bundle may only match a bundle
          compared++;
          const score = jaccard(a.toks, b.toks);
          if (score < NEAR_FLOOR) continue;
          if (score < MATCH_THRESHOLD) { near.push({ a, b, score }); continue; }
          if (a.brand && b.brand && a.brand.id === b.brand.id) matches.push({ a, b, score });
          else collisions.push({ a, b, score });
        }
      }
    }
  }

  // Clusters: one real product can surface as three listings, and reporting that as three
  // unrelated pairs asks a human to rediscover the connection. Union-find over the matches.
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (x, y) => { parent.set(find(x), find(y)); };
  for (const m of matches) {
    for (const p of [m.a.id, m.b.id]) if (!parent.has(p)) parent.set(p, p);
    union(m.a.id, m.b.id);
  }
  const clusters = new Map();
  for (const m of matches) {
    const root = find(m.a.id);
    if (!clusters.has(root)) clusters.set(root, { members: new Map(), best: 0, worst: 1 });
    const c = clusters.get(root);
    c.members.set(m.a.id, m.a);
    c.members.set(m.b.id, m.b);
    c.best = Math.max(c.best, m.score);
    c.worst = Math.min(c.worst, m.score);
  }

  /**
   * Which listing a human would probably keep — a RECOMMENDATION, never an action.
   *
   * The direct supplier outranks everything else and outranks it by enough that no
   * combination of the other signals can overturn it: Feel22 is a retailer reselling
   * Beesline and Dali, so the direct row is the one with our pricing, our title and
   * (for Dali) the shade variants. The rest are tiebreaks between two rows of the same
   * standing. The reasons are printed so the recommendation can be argued with.
   */
  function keepScore(p) {
    const why = [];
    let s = 0;
    if (DIRECT_SOURCES.has(p.source)) { s += 100; why.push("direct supplier"); }
    else why.push("retailer feed");
    if (p.variants > 0) { s += 20; why.push(`${p.variants} variants`); }
    if (p.images > 0) { s += 10; why.push(`${p.images} image${p.images === 1 ? "" : "s"}`); }
    // "Cleaner title": Feel22 prefixes the vendor name and appends the volume. A title that
    // does not simply restate its own brand is the one a customer should see.
    const prefixed = p.brand && new RegExp("^\\s*" + escapeRe(p.brand.name), "i").test(p.name);
    if (!prefixed) { s += 5; why.push("title not brand-prefixed"); }
    s += Math.max(0, 60 - p.name.length) / 100; // shorter title breaks a remaining tie
    return { s, why };
  }

  const dupRows = [];
  const clusterList = [...clusters.values()].sort((x, y) => y.best - x.best);
  clusterList.forEach((c, n) => {
    const members = [...c.members.values()].map((p) => ({ p, ...keepScore(p) })).sort((x, y) => y.s - x.s);
    const keep = members[0];
    const tied = members.filter((m) => m.s === keep.s).length > 1;
    for (const m of members) {
      const verdict = m === keep ? (tied ? "KEEP?" : "KEEP") : "would drop";
      dupRows.push([
        `#${n + 1}`,
        members.length > 2 ? `${c.worst.toFixed(2)}–${c.best.toFixed(2)}` : c.best.toFixed(2),
        verdict,
        m.p.id,
        m.p.source,
        cut(m.p.brand?.name ?? "(none)", 18),
        cut(m.p.name, 44),
        usd(m.p.priceCents),
        m.p.status,
        m.p.images,
        m.p.variants,
        m === keep ? m.why.join(", ") : "",
      ]);
    }
  });

  const competing = clusterList.filter((c) => [...c.members.values()].filter((p) => p.status === "active").length > 1);
  const keepNotVisible = clusterList.filter((c) => {
    const members = [...c.members.values()].map((p) => ({ p, ...keepScore(p) })).sort((x, y) => y.s - x.s);
    return members[0].p.status !== "active" && members.some((m) => m.p.status === "active");
  });

  section(
    "1. CROSS-FEED DUPLICATES, SAME BRAND (recommendation only — nothing is merged)",
    [
      `Symmetric Jaccard >= ${MATCH_THRESHOLD}, brand-prefix and volume stripped, bundle-only-matches-bundle,`,
      `compared only inside one Brand row. The exact rule prisma/import-feel22.ts skips on, applied to the`,
      `rows that exist NOW instead of at import time. ${compared.toLocaleString()} cross-feed pairs compared.`,
      `${matches.length} matching pairs -> ${clusterList.length} clusters.`,
      ...(clusterList.length
        ? [
          `${competing.length} of those clusters have TWO OR MORE ACTIVE rows — those are the listings competing today.`,
          keepNotVisible.length
            ? `CAUTION: in ${keepNotVisible.length} cluster(s) the recommended keep is not active while a duplicate is. Acting on it would remove the only visible listing.`
            : "In every cluster the recommended keep is active, or no member is.",
        ]
        : [
          "",
          `ZERO IS A RESULT, NOT AN EMPTY CHECK — the same score finds ${collisions.length} cross-brand pairs and`,
          `${near.length} near misses on this same run, so the matcher is demonstrably firing. Read it as: the`,
          "import-time skip did its job and left no same-brand cross-feed duplicate above the threshold behind.",
          "It does NOT mean the feeds stopped overlapping. Where the overlap actually sits is sections 3",
          "and 4: a maker filed under two Brand rows, and same-brand pairs scoring just under 0.8.",
        ]),
    ].join("\n"),
    ["CLUSTER", "SCORE", "VERDICT", "ID", "SOURCE", "BRAND", "NAME", "PRICE", "STATUS", "IMG", "VAR", "WHY KEEP"],
    dupRows,
  );

  // ── 2. same title, different maker ─────────────────────────────────────────────────
  collisions.sort((x, y) => y.score - x.score || x.a.id - y.a.id);
  section(
    "2. SAME TITLE, DIFFERENT BRAND — NOT duplicates, and deliberately no keep recommendation",
    [
      "The same score, run across Brand rows instead of inside one. It is listed and not acted on",
      "because most of it is a generic product name colliding: strip the vendor prefix and the volume",
      "and a dozen makers all sell {micellar, water}. Scoring 1.00 here means the TITLES are the same,",
      "which is not the same claim as the products being the same — only a shared brand makes that claim.",
      "",
      "No KEEP is offered on purpose. Picking one would recommend deleting another maker's real listing,",
      "which is the containment mistake wearing a different costume: a rule that looks decisive and is wrong.",
      "Read it as a shelf-quality signal — several near-identical names on one shelf — not as a merge queue.",
      `${collisions.filter((m) => m.a.status === "active" && m.b.status === "active").length} of these pairs are both active.`,
    ].join("\n"),
    ["SCORE", "BOTH ACTIVE", "A ID", "A BRAND", "A NAME", "A PRICE", "B ID", "B BRAND", "B NAME", "B PRICE"],
    collisions.map((m) => [
      m.score.toFixed(2),
      m.a.status === "active" && m.b.status === "active" ? "yes" : "",
      m.a.id, cut(m.a.brand?.name ?? "(none)", 16), cut(m.a.name, 38), usd(m.a.priceCents),
      m.b.id, cut(m.b.brand?.name ?? "(none)", 16), cut(m.b.name, 38), usd(m.b.priceCents),
    ]),
  );

  // ── 3. what the matcher can and cannot see ─────────────────────────────────────────
  const brandFeeds = new Map();
  for (const p of scored) {
    if (!p.brand) continue;
    if (!brandFeeds.has(p.brand.id)) brandFeeds.set(p.brand.id, { brand: p.brand, feeds: new Map(), n: 0 });
    const e = brandFeeds.get(p.brand.id);
    e.feeds.set(p.source, (e.feeds.get(p.source) || 0) + 1);
    e.n++;
  }
  const spanning = [...brandFeeds.values()].filter((e) => e.feeds.size > 1);

  /**
   * The importer only ever compares inside one Brand row, so a maker filed under two Brand
   * rows is invisible to it however obvious the duplication is. Detected by token subset on
   * the BRAND names — deliberately a check about brands, not a second product matcher.
   */
  const brandToks = brands.map((b) => ({ ...b, toks: tokens(b.name) }));
  const feedsOfBrand = (id) => brandFeeds.get(id)?.feeds ?? new Map();
  const feedList = (m) => [...m.keys()].sort().join(", ");
  const splitBrands = [];
  for (let i = 0; i < brandToks.length; i++) {
    for (let j = i + 1; j < brandToks.length; j++) {
      const [x, y] = [brandToks[i], brandToks[j]];
      if (!x.toks.size || !y.toks.size || x.toks.size === y.toks.size) continue;
      const [small, big] = x.toks.size < y.toks.size ? [x, y] : [y, x];
      if (![...small.toks].every((t) => big.toks.has(t))) continue;
      const fx = feedsOfBrand(x.id), fy = feedsOfBrand(y.id);
      if (!fx.size || !fy.size) continue;
      if (fx.size === fy.size && [...fx.keys()].every((f) => fy.has(f))) continue; // same feeds — nothing crosses
      splitBrands.push({
        row: [x.name, feedList(fx), brandFeeds.get(x.id).n,
              y.name, feedList(fy), brandFeeds.get(y.id).n],
        // The smaller side is the one worth reading: it is usually the retailer's handful of rows
        // against our full direct range, and it is short enough to check by eye.
        smaller: (brandFeeds.get(x.id).n <= brandFeeds.get(y.id).n ? x : y),
      });
    }
  }

  section(
    "3. COVERAGE — where a cross-feed duplicate can be found at all",
    [
      "Section 1 only compares inside one Brand row, so this is the entire search space it has.",
      "Listed because a small number in section 1 is explained here, and is not by itself evidence",
      "that the feeds do not overlap.",
      "",
      "Brand rows carrying products from more than one feed — the ONLY rows section 1 can compare:",
      spanning.length
        ? spanning.map((e) =>
          `  ${e.brand.name} (${e.brand.slug}) — ${e.n} products: ` +
          [...e.feeds].sort().map(([f, n]) => `${n} from ${f}`).join(", ")).join("\n")
        : "  none — section 1 had nothing it was allowed to compare, which is a coverage gap, not a clean bill.",
      "",
      "The table below is DIFFERENT Brand rows whose names look like the same maker, carrying different",
      "feeds — so section 1 is structurally blind to them and anything duplicated there was imported",
      "twice and is still sitting in the catalogue. Detected on the brand NAMES (one name's tokens are a",
      "subset of the other's), deliberately a check about brands rather than a second product matcher.",
      "The smaller side's product names are printed underneath, because these are the rows a human",
      "should actually open.",
    ].join("\n"),
    ["BRAND A", "FEEDS A", "N", "BRAND B", "FEEDS B", "N"],
    splitBrands.map((s) => s.row),
    splitBrands.length
      ? splitBrands.map((s) => {
        const rows = scored.filter((p) => p.brand?.id === s.smaller.id)
          .map((p) => [p.id, p.source, p.status, cut(p.name, 50), usd(p.priceCents), p.images, p.variants]);
        return `${s.smaller.name} (${s.smaller.slug}) — every product:\n` +
          table(["ID", "SOURCE", "STATUS", "NAME", "PRICE", "IMG", "VAR"], rows);
      }).join("\n\n")
      : undefined,
  );

  // ── 4. calibration band ────────────────────────────────────────────────────────────
  const sameBrand = (m) => Boolean(m.a.brand && m.b.brand && m.a.brand.id === m.b.brand.id);
  // Same-brand pairs sort first, not because they score higher but because they are the only ones
  // that could be a missed duplicate — the truncated stdout view has to show those, not the top
  // twenty coincidences.
  near.sort((x, y) => (sameBrand(y) - sameBrand(x)) || y.score - x.score || x.a.id - y.a.id);
  const nearSameBrand = near.filter(sameBrand);
  section(
    `4. BELOW THRESHOLD (${NEAR_FLOOR}–${MATCH_THRESHOLD}) — NOT duplicates, shown so the threshold is auditable`,
    [
      "These scored under the rule and are therefore NOT reported as duplicates anywhere above. They are",
      "here so 0.8 can be judged against real rows rather than trusted, and so the SAME-BRAND ones",
      `(${nearSameBrand.length} of ${near.length}) are visible — those are the pairs closest to being a missed duplicate.`,
      "",
      "Lowering the threshold is NOT the conclusion to draw. The band is dominated by generic names, and",
      "0.75 already includes pairs like a Dali nail polish against a Mavala nail polish remover. There is",
      "also a whole shape the score cannot reach at any threshold worth using: Feel22 lists each shade as",
      "its own product while we list one product with shade variants, so the shade words push a genuine",
      "pair below even this floor. Section 3 finds those by brand instead, which is the honest way to.",
    ].join("\n"),
    ["SCORE", "SAME BRAND", "A ID", "A SOURCE", "A NAME", "B ID", "B SOURCE", "B NAME"],
    near.map((m) => [
      m.score.toFixed(2),
      sameBrand(m) ? "yes" : "",
      m.a.id, m.a.source, cut(m.a.name, 44), m.b.id, m.b.source, cut(m.b.name, 44),
    ]),
  );

  // ── 5. active products with no image ───────────────────────────────────────────────
  const noImage = products.filter((p) => p.status === "active" && p._count.images === 0);
  section(
    "5. ACTIVE PRODUCTS WITH NO IMAGE",
    "Live on the storefront with nothing but a ProductGlyph silhouette where the product should be.",
    ["ID", "SOURCE", "BRAND", "NAME", "PRICE", "CATEGORY", "SLUG"],
    noImage.map((p) => [p.id, p.source, cut(p.brand?.name ?? "(none)", 20), cut(p.name, 46), usd(p.priceCents), p.category?.slug ?? "-", cut(p.slug, 40)]),
  );

  // ── 6. broken prices ───────────────────────────────────────────────────────────────
  const zeroOrNeg = products.filter((p) => p.priceCents <= 0);
  const absurd = products.filter((p) => p.priceCents > ABSURD_ABOVE_CENTS);
  const badPrice = [...zeroOrNeg, ...absurd].sort((a, b) => a.priceCents - b.priceCents);
  const placeholder = products.filter((p) => p.priceCents === PLACEHOLDER_PRICE_CENTS);
  const dearestKept = products
    .filter((p) => p.priceCents > 0 && p.priceCents <= ABSURD_ABOVE_CENTS)
    .sort((a, b) => b.priceCents - a.priceCents)
    .slice(0, 5);

  section(
    "6. ZERO, NEGATIVE OR ABSURD PRICES",
    [
      `Zero or negative: ${zeroOrNeg.length} (${zeroOrNeg.filter((p) => p.status === "active").length} active).`,
      `Negative specifically: ${products.filter((p) => p.priceCents < 0).length}.`,
      `Above ${usd(ABSURD_ABOVE_CENTS)}: ${absurd.length} (${absurd.filter((p) => p.status === "active").length} active).`,
      "",
      `The ${usd(ABSURD_ABOVE_CENTS)} bound is picked from the data, not from taste: nothing at all sits between`,
      "the dearest honest row and the first broken one, and the bound sits in that gap. The five dearest",
      "rows it does NOT flag are printed underneath so the choice can be checked rather than believed.",
      "",
      `Separately: ${placeholder.length} rows sit at exactly ${usd(PLACEHOLDER_PRICE_CENTS)} — the flat placeholder`,
      "Beesline's own store publishes. Not flagged above (it is inside any defensible bound), listed because",
      "it is a known signature rather than a price.",
    ].join("\n"),
    ["ID", "PRICE", "SOURCE", "BRAND", "NAME", "STATUS"],
    badPrice.map((p) => [p.id, usd(p.priceCents), p.source, cut(p.brand?.name ?? "(none)", 18), cut(p.name, 46), p.status]),
    "Dearest rows NOT flagged (the bound is above all of these):\n" +
      table(["PRICE", "STATUS", "SOURCE", "BRAND", "NAME"],
        dearestKept.map((p) => [usd(p.priceCents), p.status, p.source, cut(p.brand?.name ?? "(none)", 18), cut(p.name, 50)])),
  );

  // ── 7. empty, whitespace-only or brand-only names ──────────────────────────────────
  const brandNames = new Set(brands.map((b) => b.name.trim().toLowerCase()));
  const badNames = [];
  for (const p of products) {
    const trimmed = p.name.trim();
    let reason = "";
    if (!trimmed) reason = "empty or whitespace only";
    else if (brandNames.has(trimmed.toLowerCase())) reason = "the name is exactly a brand name";
    // Same normalisation the matcher uses: strip the product's own brand prefix, volumes and
    // numbers. Nothing left means the name says who made it and not what it is.
    else if (tokens(p.name, p.brand?.name).size === 0) reason = "nothing left after the brand prefix";
    if (reason) badNames.push([p.id, p.source, cut(p.brand?.name ?? "(none)", 20), JSON.stringify(p.name), p.status, reason]);
  }
  section(
    "7. EMPTY, WHITESPACE-ONLY OR BRAND-ONLY NAMES",
    [
      "Three ways a name fails to name a product: it is blank, it is exactly a brand name, or the",
      "importer's own normalisation reduces it to nothing (the title restated the maker and a volume).",
      "Names are printed JSON-quoted so trailing and doubled whitespace is visible.",
    ].join("\n"),
    ["ID", "SOURCE", "BRAND", "NAME", "STATUS", "WHY"],
    badNames,
  );

  // ── 8. active products in an inactive category ─────────────────────────────────────
  const orphaned = products.filter((p) => p.status === "active" && p.category && !p.category.active);
  section(
    "8. ACTIVE PRODUCTS IN AN INACTIVE CATEGORY",
    [
      "Unreachable — a retired department is not browsable — but they still count as active everywhere",
      "a status is counted, and search and direct links can still reach them. Either the section comes",
      "back or the products stop being active; the current state says neither.",
    ].join("\n"),
    ["ID", "SOURCE", "BRAND", "NAME", "CATEGORY", "PRICE"],
    orphaned.map((p) => [p.id, p.source, cut(p.brand?.name ?? "(none)", 20), cut(p.name, 44), p.category.slug, usd(p.priceCents)]),
  );

  // ── 9. active products whose brand is not on the allowlist ─────────────────────────
  // loadAllowlist() is imported rather than reimplemented: brands-we-sell.txt is the owner's
  // file and a second parser of it would eventually disagree with the one that hides products.
  const allow = loadAllowlist();
  const offList = products.filter((p) => p.status === "active" && (!p.brand || !allow.has(p.brand.name)));
  section(
    "9. ACTIVE PRODUCTS WHOSE BRAND IS NOT ON THE ALLOWLIST",
    [
      allow.size
        ? `prisma/brands-we-sell.txt lists ${allow.size} brands. applyBrandAllowlist() hides everything else,`
        : "prisma/brands-we-sell.txt is MISSING OR EMPTY — every product below is unfiltered, not approved.",
      "so anything here escaped that pass: added after it ran, or reactivated by hand since.",
      "Products with no brand at all are included — the shop cannot claim a curated range and also",
      "list something it cannot name the maker of.",
    ].join("\n"),
    ["ID", "SOURCE", "BRAND", "NAME", "CATEGORY", "PRICE"],
    offList.map((p) => [p.id, p.source, p.brand?.name ?? "(NO BRAND)", cut(p.name, 44), p.category?.slug ?? "-", usd(p.priceCents)]),
  );

  // ── output ─────────────────────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const summaryRows = [
    ["1. cross-feed duplicate clusters, same brand", clusterList.length],
    ["     …with 2+ active rows (competing today)", competing.length],
    ["2. same title, different brand (not duplicates)", collisions.length],
    ["3. brand rows split across feeds (matcher is blind here)", splitBrands.length],
    [`4. below threshold ${NEAR_FLOOR}–${MATCH_THRESHOLD} (${nearSameBrand.length} same-brand)`, near.length],
    ["5. active with no image", noImage.length],
    ["6. zero / negative / absurd price", badPrice.length],
    ["7. unusable names", badNames.length],
    ["8. active in an inactive category", orphaned.length],
    ["9. active, brand not on the allowlist", offList.length],
  ];

  const head = [
    "CATALOGUE SWEEP — READ ONLY. Nothing below has been changed; every line is a recommendation.",
    stamp,
    "",
    `${products.length.toLocaleString()} products — ` +
      Object.entries(bySource).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(", "),
    `status — ` + Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(", "),
    "",
    table(["FINDING", "COUNT"], summaryRows),
  ].join("\n");

  console.log(head);
  console.log(renderStdout());

  if (WRITE) {
    const mdHead = [
      "# Catalogue sweep",
      "",
      `_${stamp}_`,
      "",
      "**Read-only.** This file is the only thing `--write` writes. No product, category or brand row",
      "was read-modified-written by the sweep that produced it, and every duplicate below is a",
      "recommendation for a human — nothing has been merged, hidden or deleted.",
      "",
      `**${products.length.toLocaleString()} products** — ` +
        Object.entries(bySource).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(", ") + ".",
      "",
      "Status — " + Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(", ") + ".",
      "",
      mdTable(["Finding", "Count"], summaryRows),
    ].join("\n");
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, renderMarkdown(mdHead));
    console.log(`\nReport written to ${OUT} — the report file only. No database row was touched.`);
  } else {
    console.log("\n(dry run — pass --write to also save the markdown report. Neither mode writes to the database.)");
  }
}

main()
  .then(async () => { await db.$disconnect(); })
  .catch(async (e) => { console.error("\nSweep failed:", e); await db.$disconnect(); process.exit(1); });
