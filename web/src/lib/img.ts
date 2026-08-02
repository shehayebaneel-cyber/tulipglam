/**
 * Product imagery — mapping a stored image URL to the derivative that fits the slot.
 *
 * ── WHY THIS IS A MAPPING AND NOT A DATABASE COLUMN ────────────────────────────────
 *
 * The catalogue stores one URL per image, written by the importers: `/products/feel22/x.png`.
 * Rewriting nine thousand of those rows to point at WebP derivatives would be a bulk UPDATE
 * across the live table — exactly the kind of migration this project does not do. So the
 * stored URL stays the source of truth and the display variant is derived from it here, at
 * render time, for free.
 *
 * It also means the derivatives are disposable: delete `public/i`, run
 * `node scripts/image-build.mjs --write`, and everything reappears with no data touched.
 *
 *     stored      /products/feel22/foo.png
 *     derivative  /i/card/feel22/foo.webp
 *
 * `web/scripts/image-build.mjs` writes exactly that shape. The two must agree; if you change
 * one, change the other.
 *
 * ── WHY WEBP WITH NO FALLBACK ──────────────────────────────────────────────────────
 *
 * Every browser that can run this React 19 app supports WebP — Safari has since 14, and the
 * app's own baseline is far newer. Emitting a `<picture>` with a PNG fallback would double the
 * markup to serve a browser that could not render the site anyway. `onError` in ProductImage
 * covers the real failure: a derivative that does not exist because its source was corrupt.
 */

/** The slots built by the pipeline. Sizes are the nominal maximum; sources are never upscaled. */
export type ImageSlot = "thumb" | "card" | "card2x" | "hero";

const DERIVABLE = /^\/products\/([^/]+)\/(.+)\.[a-z0-9]+$/i;

/**
 * The derivative URL for a slot, or the original when it cannot be derived.
 *
 * Anything not matching the importer's own path shape — an admin upload under `/uploads/`, an
 * absolute URL, a settings-driven hero — is passed through untouched. Those have no derivatives
 * and inventing a path for them would produce a guaranteed 404.
 */
export function productImage(url: string | null | undefined, slot: ImageSlot = "card"): string {
  if (!url) return "";
  const m = DERIVABLE.exec(url);
  if (!m) return url;
  return `/i/${slot}/${m[1]}/${m[2]}.webp`;
}

/** True when a derivative actually exists for this URL — i.e. the mapping above did something. */
export function hasDerivative(url: string | null | undefined): boolean {
  return !!url && DERIVABLE.test(url);
}

/**
 * A `srcset` for the product grid, so a dense phone screen gets the sharper file and a cheap
 * one does not pay for pixels it cannot show.
 *
 * Only the grid gets two densities. It is the single most-downloaded surface on the site — a
 * category page IS a grid — and it is the only place where the extra build cost pays for
 * itself. Everywhere else takes one well-chosen size.
 */
export function productSrcSet(url: string | null | undefined): string | undefined {
  if (!hasDerivative(url)) return undefined;
  return `${productImage(url, "card")} 1x, ${productImage(url, "card2x")} 2x`;
}
