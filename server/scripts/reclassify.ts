/**
 * Give every active product its filters.
 *
 *     npx tsx scripts/reclassify.ts            # dry run — prints, changes nothing
 *     npx tsx scripts/reclassify.ts --write    # applies, logging every change
 *     npx tsx scripts/reclassify.ts --undo <pass>   # puts a whole pass back
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  Shared production database. Every write records the previous value in
 *  ProductAssignmentLog, so any single product or the entire pass can be reverted.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Touches ONLY categoryId, concerns and attributes on ACTIVE products. Names, photographs,
 * prices, descriptions and every hidden product are out of scope and never written.
 */
import { PrismaClient } from "@prisma/client";
import { tagsFor, categoryFor, CONCERN_TAGS, ATTRIBUTE_TAGS } from "../src/classify.js";

const db = new PrismaClient();
const WRITE = process.argv.includes("--write");
const undoAt = process.argv.indexOf("--undo");
const UNDO = undoAt > -1 ? process.argv[undoAt + 1] : null;

/** One pass id per run, so `--undo <pass>` can put exactly this run back. */
const PASS = `reclassify-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}`;

async function undo(pass: string) {
  const rows = await db.productAssignmentLog.findMany({ where: { pass, revertedAt: null } });
  if (rows.length === 0) {
    console.log(`No un-reverted changes found for pass "${pass}".`);
    return;
  }
  console.log(`Reverting ${rows.length} change(s) from ${pass}…`);
  for (const r of rows) {
    const data =
      r.field === "categoryId" ? { categoryId: Number(r.oldValue) }
        : r.field === "concerns" ? { concerns: r.oldValue }
          : r.field === "attributes" ? { attributes: r.oldValue }
            : null;
    if (!data) continue;
    await db.product.update({ where: { id: r.productId }, data });
    await db.productAssignmentLog.update({ where: { id: r.id }, data: { revertedAt: new Date() } });
  }
  console.log(`Done — ${rows.length} reverted. The log rows are kept, marked reverted.`);
}

async function main() {
  if (UNDO) return undo(UNDO);

  const cats = await db.category.findMany({ select: { id: true, slug: true, name: true, parent: { select: { name: true } } } });
  const bySlug = new Map(cats.map((c) => [c.slug, c]));
  const byId = new Map(cats.map((c) => [c.id, c]));

  const products = await db.product.findMany({
    where: { status: "active" },
    select: { id: true, name: true, categoryId: true, concerns: true, attributes: true },
    orderBy: { id: "asc" },
  });

  type Change = { id: number; name: string; field: string; oldValue: string; newValue: string; reason: string };
  const changes: Change[] = [];
  /** Genuine judgement calls — the short list an owner actually reads. */
  const flags: { id: number; name: string; note: string }[] = [];
  /**
   * Products no filter will find. Informational, not a defect.
   *
   * A first version put all of these on the flag list — 777 of 1,178 — which is not a list
   * anyone reads. Most are fragrances, and a perfume genuinely has no "good for" answer. The
   * flag list is for decisions that could reasonably have gone the other way.
   */
  const untagged: { id: number; name: string; shelf: string }[] = [];

  for (const p of products) {
    const current = byId.get(p.categoryId);
    const currentSlug = current?.slug ?? "";

    // ── category ────────────────────────────────────────────────────────────────
    const verdict = categoryFor(p.name, currentSlug);
    if (verdict) {
      const target = bySlug.get(verdict.slug);
      if (!target) {
        // A rule naming a slug that does not exist is a bug in the rules, not a product
        // problem — and silently skipping it would hide the bug.
        flags.push({ id: p.id, name: p.name, note: `rule wanted category "${verdict.slug}" which does not exist` });
      } else if (target.id !== p.categoryId) {
        // Worth a second opinion: the name carries two product types and I picked one.
        if (/\b(lip|eye|cheek|hair|inner)\b/i.test(p.name) && /blush|highlighter|serum|concealer/i.test(p.name)) {
          flags.push({ id: p.id, name: p.name, note: `name mentions two product types; placed in ${target.name}, was ${current?.name ?? "?"}` });
        }
        changes.push({
          id: p.id, name: p.name, field: "categoryId",
          oldValue: String(p.categoryId), newValue: String(target.id),
          reason: `${verdict.why} — moved from ${current?.name ?? "?"} to ${target.name}`,
        });
      }
    }

    // ── tags ────────────────────────────────────────────────────────────────────
    const { concerns, attributes } = tagsFor(p.name);
    const nextConcerns = concerns.join(",");
    const nextAttributes = attributes.join(",");

    // Only ever ADD tags where there were none. Overwriting a value someone set by hand is the
    // kind of quiet loss this pass must not cause, and every one of these is empty today.
    if (nextConcerns && p.concerns.trim() === "") {
      changes.push({ id: p.id, name: p.name, field: "concerns", oldValue: p.concerns, newValue: nextConcerns, reason: "from the product name" });
    }
    if (nextAttributes && p.attributes.trim() === "") {
      changes.push({ id: p.id, name: p.name, field: "attributes", oldValue: p.attributes, newValue: nextAttributes, reason: "from the product name" });
    }

    // A product no filter will ever find. Not an error — some names genuinely say nothing
    // beyond the brand — but it is what an owner would want listed.
    if (!nextConcerns && !nextAttributes && !p.concerns.trim() && !p.attributes.trim()) {
      untagged.push({ id: p.id, name: p.name, shelf: current?.name ?? "?" });
    }
  }

  const moves = changes.filter((c) => c.field === "categoryId");
  console.log(`${WRITE ? "APPLYING" : "DRY RUN"} — pass ${PASS}\n`);
  console.log(`  active products            ${products.length}`);
  console.log(`  category moves             ${moves.length}`);
  console.log(`  concerns to set            ${changes.filter((c) => c.field === "concerns").length}`);
  console.log(`  attributes to set          ${changes.filter((c) => c.field === "attributes").length}`);
  console.log(`  flagged for your eyes      ${flags.length}`);
  console.log(`\n  vocabularies — concerns: ${CONCERN_TAGS.join(", ")}`);
  console.log(`                 attributes: ${ATTRIBUTE_TAGS.join(", ")}`);

  if (moves.length) {
    console.log(`\n  ── category moves ──`);
    for (const m of moves.slice(0, 40)) console.log(`    ${m.name.slice(0, 52).padEnd(54)}${m.reason}`);
    if (moves.length > 40) console.log(`    …and ${moves.length - 40} more`);
  }

  if (!WRITE) {
    console.log(`\n  Nothing was changed. Re-run with --write to apply.`);
    return { changes, flags, untagged };
  }

  for (const c of changes) {
    const data =
      c.field === "categoryId" ? { categoryId: Number(c.newValue) }
        : c.field === "concerns" ? { concerns: c.newValue }
          : { attributes: c.newValue };
    await db.product.update({ where: { id: c.id }, data });
    await db.productAssignmentLog.create({
      data: { productId: c.id, field: c.field, oldValue: c.oldValue, newValue: c.newValue, pass: PASS, reason: c.reason },
    });
  }

  console.log(`\n  applied — ${changes.length} change(s) logged under pass "${PASS}".`);
  console.log(`  undo everything:  npx tsx scripts/reclassify.ts --undo ${PASS}`);
  return { changes, flags, untagged };
}

main()
  .then(async (r) => {
    if (!r) return;
    const fs = await import("node:fs");
    fs.writeFileSync("../reclassify-flags.json", JSON.stringify(r.flags, null, 1));
    fs.writeFileSync("../reclassify-untagged.json", JSON.stringify(r.untagged, null, 1));
    console.log(`\n  flag list -> reclassify-flags.json    (${r.flags.length}) — judgement calls, read these`);
    console.log(`  untagged  -> reclassify-untagged.json (${r.untagged.length}) — no filter finds them; mostly fragrance, mostly fine`);
  })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  // finally, no process.exit() above it — that pattern once left test rows in production.
  .finally(async () => { await db.$disconnect(); });
