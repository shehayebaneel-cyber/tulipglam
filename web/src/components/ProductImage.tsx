import { useState } from "react";
import type { Glyph } from "../lib/api";
import { productImage, productSrcSet, type ImageSlot } from "../lib/img";
import { ProductGlyph } from "./ProductGlyph";

/**
 * One product photo, in a box that never changes size.
 *
 * ── THE BOX IS FIXED BEFORE THE IMAGE ARRIVES ──────────────────────────────────────
 *
 * The frame carries its aspect ratio in CSS and the `<img>` carries explicit width and height,
 * so the space is reserved at first paint. On a Lebanese mobile connection the photos land
 * several seconds after the text, and without a reserved box a category page reflows under the
 * reader's thumb as each one arrives — which is both the worst thing a grid can do and the
 * thing most likely to make someone tap the wrong product.
 *
 * ── SQUARE, BECAUSE THE CATALOGUE IS SQUARE ────────────────────────────────────────
 *
 * Measured, not assumed: 9,931 of 10,110 source images are exactly square, and the pipeline
 * pads the remaining 179 into a square rather than cropping them. The bed used to be 4:5, so
 * every square photo — which is to say nearly all of them — sat letterboxed with a fifth of the
 * tile as dead space above and below. Matching the bed to the corpus makes each product bigger
 * inside the same column width, with nothing cropped and no space wasted.
 *
 * ── FAILURE IS A DESIGNED STATE ────────────────────────────────────────────────────
 *
 * Two sources in the catalogue are corrupt PNGs that no derivative could be built from, and one
 * of them belongs to an ACTIVE product whose only image it is. So a missing file is not
 * hypothetical, and the answer is the house line-art glyph on the usual tint — the same mark
 * used before any photography existed — rather than a browser's broken-image icon.
 */
export function ProductImage({
  url,
  alt,
  glyph,
  slot = "card",
  srcSet = false,
  sizes,
  eager = false,
  className = "",
  imgClassName = "",
  ratio = "square",
  pad = "p-3",
}: {
  url: string | null | undefined;
  alt: string;
  glyph: Glyph;
  slot?: ImageSlot;
  /** Emit a 1x/2x srcset. Grid cards only — see the note in lib/img.ts. */
  srcSet?: boolean;
  sizes?: string;
  /** Above the fold. Anything a customer has to scroll to should stay lazy. */
  eager?: boolean;
  className?: string;
  imgClassName?: string;
  ratio?: "square" | "portrait";
  pad?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = productImage(url, slot);
  const box = ratio === "square" ? "aspect-square" : "aspect-[4/5]";

  // Nominal pixel dimensions for the slot, used only so the browser knows the shape before the
  // bytes arrive. The real file may be smaller — sources are never upscaled — and `object-contain`
  // means a smaller file still sits correctly inside the same reserved box.
  const nominal = slot === "thumb" ? 200 : slot === "hero" ? 800 : slot === "card2x" ? 600 : 400;

  return (
    <div className={`relative overflow-hidden bg-soft ${box} ${className}`}>
      <div className={`h-full w-full ${pad}`}>
        {src && !failed ? (
          <img
            src={src}
            srcSet={srcSet ? productSrcSet(url) : undefined}
            sizes={sizes}
            alt={alt}
            width={nominal}
            height={nominal}
            loading={eager ? "eager" : "lazy"}
            // `high` on the one image that is the reason the page was opened; the rest wait.
            fetchPriority={eager ? "high" : undefined}
            decoding="async"
            onError={() => setFailed(true)}
            className={`h-full w-full object-contain ${imgClassName}`}
          />
        ) : (
          <ProductGlyph kind={glyph} className={`h-full w-full p-6 text-plum/40 ${imgClassName}`} />
        )}
      </div>
    </div>
  );
}
