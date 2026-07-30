import { Link } from "react-router-dom";
import { ProductGlyph } from "./ProductGlyph";
import type { Glyph } from "../lib/api";

/**
 * One card for every category.
 *
 * The grid previously mixed two incompatible cards: some were images with the category name
 * and tagline **burned into the file** (no caption underneath), the rest were pale glyph
 * placeholders **with** a caption. So some cards showed a title and some didn't, heights
 * differed between rows, and the artwork carried beige, gold, baby-blue and pink backgrounds
 * that are nowhere in Blanc Tulipe.
 *
 * Rules here:
 *  - Text is always live DOM. Baked-in text is unsearchable, unselectable, invisible to screen
 *    readers, untranslatable and blurs on retina.
 *  - One aspect ratio for every card, so rows line up.
 *  - No image? The glyph placeholder uses the same frame and a plum-family tint, so it reads
 *    as deliberate rather than as a missing asset.
 */
export function CategoryCard({
  slug,
  name,
  blurb,
  glyph,
  tint,
  image,
  count,
}: {
  slug: string;
  name: string;
  blurb?: string;
  glyph: Glyph;
  tint?: string;
  image?: string;
  count?: number;
}) {
  return (
    <Link
      to={`/category/${slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-plum/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
    >
      <div className="aspect-[4/3] w-full overflow-hidden" style={{ background: tint || "var(--color-plum-soft)" }}>
        {image ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <ProductGlyph kind={glyph} className="h-full w-full p-9 text-plum/40 transition-transform duration-300 group-hover:scale-[1.03]" />
        )}
      </div>
      <div className="flex flex-1 flex-col px-3.5 py-3">
        <p className="text-[14px] font-semibold leading-snug text-ink group-hover:text-plum">{name}</p>
        {blurb && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted">{blurb}</p>}
        {typeof count === "number" && count > 0 && (
          <p className="mt-auto pt-1.5 text-[11px] text-muted">{count.toLocaleString()} products</p>
        )}
      </div>
    </Link>
  );
}
