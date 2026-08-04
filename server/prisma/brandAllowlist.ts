import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

/**
 * The brands the shop actually sells. Everything else is hidden from the storefront.
 *
 * ── WHY THIS RUNS AFTER EVERY IMPORT, NOT ONCE ─────────────────────────────────────
 *
 * All three importers do `deleteMany({ where: { source } })` and recreate every product from
 * the feed. So a one-time pass that hid 7,787 products would survive exactly until the next
 * `npm run import:feel22`, and then 336 brands would silently reappear on the storefront —
 * with nobody watching, because an import that says "Imported 9,327 products" looks like a
 * success.
 *
 * This is the same lesson as the AI-generated product photo: a rule about importer-owned rows
 * has to live in code that runs on every import, or it is not a rule, it is a mood.
 *
 * ── WHY HIDDEN AND NOT DELETED ─────────────────────────────────────────────────────
 *
 * `hidden` keeps the row, the images and the history. Adding a brand back is one line in
 * `brands-we-sell.txt` and one command — not a re-import, not a data recovery. The owner is
 * choosing a range for launch, and a range is a decision people revise.
 *
 * ── WHY A TEXT FILE ────────────────────────────────────────────────────────────────
 *
 * The list is the owner's, not the code's. A plain file with one brand per line can be edited
 * by the person who decides it, without touching TypeScript and without asking anyone.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIST = path.join(HERE, "brands-we-sell.txt");

/** Brands to keep visible. Empty set means the file is missing — see `loadAllowlist`. */
export function loadAllowlist(): Set<string> {
  if (!fs.existsSync(LIST)) return new Set();
  return new Set(
    fs.readFileSync(LIST, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );
}

export type AllowlistResult = {
  /** Names in the file that match no brand in the catalogue — a typo, or a brand not carried. */
  unmatched: string[];
  keptBrands: number;
  hiddenBrands: number;
  /** Products that would be, or were, hidden. */
  toHide: number;
  /** Products already hidden for another reason (a retired section) — not counted as changed. */
  alreadyHidden: number;
  hidden: number;
};

/**
 * Hide every product whose brand is not on the list.
 *
 * `dryRun` is the default everywhere it is called from a script. Called from an importer it
 * writes, because at that point the products were created microseconds ago by the same run and
 * there is nothing to preview.
 */
export async function applyBrandAllowlist(
  db: PrismaClient,
  opts: { write?: boolean; source?: string } = {},
): Promise<AllowlistResult> {
  const allow = loadAllowlist();

  // An empty or missing list must never mean "hide everything". Failing loudly beats emptying
  // a shop because a file did not deploy.
  if (allow.size === 0) {
    throw new Error(
      "brands-we-sell.txt is missing or empty. Refusing to run: an empty allowlist would hide the entire catalogue.",
    );
  }

  const brands = await db.brand.findMany({ select: { id: true, name: true } });
  const known = new Set(brands.map((b) => b.name));
  const unmatched = [...allow].filter((n) => !known.has(n));

  const keepIds = brands.filter((b) => allow.has(b.name)).map((b) => b.id);

  const where = {
    ...(opts.source ? { source: opts.source } : {}),
    // Products with NO brand are hidden too: the shop cannot claim to sell a curated range and
    // also list 49 products it cannot name the maker of.
    OR: [{ brandId: null }, { brandId: { notIn: keepIds } }],
  };

  const [candidates, alreadyHidden] = await Promise.all([
    db.product.count({ where: { ...where, status: { not: "hidden" } } }),
    db.product.count({ where: { ...where, status: "hidden" } }),
  ]);

  let hidden = 0;
  if (opts.write) {
    const r = await db.product.updateMany({
      where: { ...where, status: { not: "hidden" } },
      data: { status: "hidden" },
    });
    hidden = r.count;
  }

  return {
    unmatched,
    keptBrands: keepIds.length,
    hiddenBrands: brands.length - keepIds.length,
    toHide: candidates,
    alreadyHidden,
    hidden,
  };
}
