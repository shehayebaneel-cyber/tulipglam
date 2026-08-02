/**
 * Detach AI-generated photographs from products.
 *
 *     npx tsx scripts/strip-ai-product-images.ts            # dry run — prints, changes nothing
 *     npx tsx scripts/strip-ai-product-images.ts --write    # applies
 *
 * ── THE RULE THIS ENFORCES (owner's, 2 Aug 2026) ───────────────────────────────────
 *
 * An AI image must never stand in for a real product a customer will physically receive. This
 * is a cash-on-delivery business: the doorstep is where an invented photograph surfaces, in
 * front of the person paying, with the goods in their hand. Decorative art — the hero, category
 * headers — is fine and is not touched by this script.
 *
 * ── WHY DETACH RATHER THAN DELETE, HIDE, OR DO NOTHING ─────────────────────────────
 *
 * `Proactive Strength Duo` is already `hidden`, so nothing reaches a customer today. The problem
 * is that its only photograph is generated and NOTHING marks it as such: whoever activates that
 * product next — reviewing a hidden-products list months from now — publishes an AI image of a
 * cosmetic without ever being told. A note in a document does not survive that moment.
 *
 * So the image row is removed and the product becomes photoless, which the storefront already
 * handles properly: `ProductImage` renders the house tulip glyph. The product stays exactly as
 * active or hidden as the owner left it — this script does not touch `status`, because
 * availability is an editorial decision and this is a truthfulness one.
 *
 * **The FILE on disk is not touched.** `web/public/products/beesline/…png` stays where it is, so
 * this is reversible by re-inserting one row, and the owner can look at what was removed.
 *
 * ── WHY A SCRIPT AND NOT A HAND-RUN QUERY ──────────────────────────────────────────
 *
 * The database is shared with production; every write is instantly live. This repository's
 * standing rule is that data cleanup is a dry-run-by-default script that prints what it would
 * change, so the change can be read before it happens and read again afterwards.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const WRITE = process.argv.includes("--write");

/**
 * Filename conventions of the common generators.
 *
 * Deliberately narrow: it matches how these tools NAME their output, not anything about the
 * picture. A false positive here deletes a real product's only photograph, so the test has to be
 * something a supplier's own export would never accidentally produce.
 */
const GENERATED = /gemini_generated_image|midjourney_|dall-?e[-_]|stable-?diffusion|_sdxl_/i;

async function main() {
  const images = await db.productImage.findMany({
    include: { product: { select: { id: true, name: true, slug: true, status: true, source: true } } },
  });

  const hits = images.filter((i) => GENERATED.test(i.url));

  if (hits.length === 0) {
    console.log("No product images match a known AI-generator filename convention.");
    return;
  }

  console.log(`${WRITE ? "APPLYING" : "DRY RUN"} — ${hits.length} product image(s) look generated\n`);

  for (const img of hits) {
    const siblings = await db.productImage.count({ where: { productId: img.productId } });
    const p = img.product;
    console.log(`  ${p.name}`);
    console.log(`    slug        ${p.slug}   status ${p.status}   source ${p.source}`);
    console.log(`    file        ${img.url}`);
    console.log(`    images      ${siblings} total on this product`);
    console.log(`    after       ${siblings - 1} image(s) — ${siblings === 1 ? "PHOTOLESS, renders the house glyph" : "still has photography"}`);
    console.log(`    status      unchanged (${p.status}) — availability is the owner's call, not this script's`);
    console.log("");
  }

  if (!WRITE) {
    console.log("Nothing was changed. Re-run with --write to apply.");
    return;
  }

  // One row at a time by primary key. Not a bulk delete: every removal is named above, and a
  // `deleteMany` over a regex match is exactly the shape that removes more than it printed.
  for (const img of hits) {
    await db.productImage.delete({ where: { id: img.id } });
    console.log(`  removed image row ${img.id} (${img.url.split("/").pop()})`);
  }
  console.log(`\n${hits.length} image row(s) removed. The FILES are untouched on disk — re-insert a row to undo.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  // `finally`, and no process.exit() anywhere above it — a script in this repo once called
  // process.exit() inside its try and left test rows in the production database, because
  // process.exit() does not wait for pending work.
  .finally(async () => { await db.$disconnect(); });
