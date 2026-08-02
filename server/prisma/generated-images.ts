/**
 * Keep AI-generated photographs out of the product catalogue.
 *
 * ── THE RULE (owner's, 2 Aug 2026) ─────────────────────────────────────────────────
 *
 * An AI image must never stand in for a real product a customer will physically receive. This
 * is a cash-on-delivery business, so the doorstep is where an invented photograph surfaces —
 * in front of the person paying, with the goods in their hand. Decorative art (the hero,
 * category headers) is a different thing and is not covered by this.
 *
 * ── WHY IT LIVES IN THE IMPORTERS ──────────────────────────────────────────────────
 *
 * The instance that prompted this was Beesline's `Proactive Strength Duo`, whose only photograph
 * is named `Gemini_Generated_Image_…` — and whose `src` is a Shopify CDN URL on **Beesline's own
 * store**. The supplier generated it; we merely copied it. So this is not a one-off to be cleaned
 * out of our database, it is an ongoing property of a feed we re-import.
 *
 * Deleting the row would have been undone by the very next `npm run import:beesline`, which is
 * the lesson this repository already learned about importer-owned rows. Editing the catalogue
 * JSON would have worked and would have made that file lie about what the supplier published.
 * Filtering at import keeps the catalogue an honest record, survives every re-import, and
 * catches the next one automatically.
 *
 * ── DELIBERATELY NARROW ────────────────────────────────────────────────────────────
 *
 * It matches how these tools NAME their output, not anything about the picture itself. There is
 * no reliable way to detect a generated image from its pixels, and a false positive here strips
 * a real product's only photograph — so the test has to be something a supplier's own export
 * would never produce by accident.
 */

/** Filename conventions of the common generators. Extend when a new one shows up in a feed. */
export const GENERATED_IMAGE = /gemini_generated_image|midjourney_|dall-?e[-_]|stable-?diffusion|_sdxl_/i;

/**
 * Strip generated images from a parsed catalogue, in place, and report what went.
 *
 * A product left with no images is fine and intended: the storefront renders the house tulip
 * glyph for a photoless product, which is an honest "we have no picture of this" rather than a
 * picture of something that does not exist. The product's own status is NOT touched — whether
 * to sell something unphotographed is an editorial decision, not this function's.
 */
export function stripGeneratedImages<T extends { images?: { file: string }[]; name?: string; title?: string }>(
  products: T[],
): { removed: number; productsAffected: string[] } {
  let removed = 0;
  const productsAffected: string[] = [];

  for (const p of products) {
    if (!p.images?.length) continue;
    const keep = p.images.filter((im) => !GENERATED_IMAGE.test(im.file));
    if (keep.length === p.images.length) continue;

    removed += p.images.length - keep.length;
    productsAffected.push(`${p.name ?? p.title ?? "(unnamed)"}${keep.length === 0 ? " — now photoless" : ""}`);
    p.images = keep;
  }

  if (removed) {
    console.log(`\n  Skipped ${removed} AI-generated image(s) — an invented photo must not stand in`);
    console.log(`  for a product someone pays for at their door:`);
    for (const n of productsAffected) console.log(`    · ${n}`);
    console.log("");
  }

  return { removed, productsAffected };
}
