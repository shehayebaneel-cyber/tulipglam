import { Link } from "react-router-dom";

/**
 * The departments, as a list.
 *
 * ── WHY A LIST AND NOT CARDS ───────────────────────────────────────────────────────
 *
 * The card grid rendered eleven 4:3 tiles, and `CATEGORY_IMG` was an empty object, so every
 * one of them fell back to a line silhouette — of which there are only six. Eight of the eleven
 * cards were visually indistinguishable from another card: `bottle` stood in for Nails, Hair,
 * Deodorant *and* Kids & Baby. At 390px each tile was 172px wide with 36px of padding on every
 * side, leaving a 100×57px drawing floating in an empty tinted field, and the whole section ran
 * to six rows and roughly 1,300px — two full phone screens of near-identical placeholder art
 * before the visitor reached a single product.
 *
 * A list has no artwork to be wrong. It reads in one glance, it is honest about what it is
 * (navigation), and it puts Best Sellers within reach instead of two screens down.
 *
 * ── AND THE OBVIOUS FIX WAS NOT AVAILABLE ──────────────────────────────────────────
 *
 * Worth knowing before anyone reaches for it: there ARE six artwork files in
 * `web/public/category/`, and they cannot be used. Each has the category name and a tagline
 * burned into the image, over beige/gold/baby-blue/pink grounds that are not in the palette.
 * With the label rendered as DOM text they would show every title twice — and baked-in text is
 * unsearchable, unselectable, invisible to a screen reader and blurry on retina regardless.
 * That is why `CATEGORY_IMG` sat empty rather than being filled in. Tracked in AUDIT.md.
 *
 * Real department photography would still beat this list. Until it exists, this beats eleven
 * tiles sharing six drawings.
 *
 * ── THE ORDER IS THE MERCHANDISING ─────────────────────────────────────────────────
 *
 * With no imagery to draw the eye, position is the only emphasis left, so the caller sorts by
 * catalogue depth — Makeup and Skincare first — rather than by the old card order. If that ever
 * needs to be editorial instead, sort in `Home.tsx`, not here.
 */
export type CategoryListItem = {
  slug: string;
  name: string;
  tint?: string;
  count?: number;
};

export function CategoryList({ categories }: { categories: CategoryListItem[] }) {
  return (
    <ul className="grid grid-cols-2 gap-x-5 sm:grid-cols-3 lg:grid-cols-4">
      {categories.map((c) => (
        <li
          key={c.slug}
          /**
           * A hairline between rows, and none above the first row of the grid — which is the
           * first two items at this breakpoint, the first three at sm, the first four at lg.
           * The nth-child bounds have to track the column count or a stray rule appears under
           * the heading; if you change `grid-cols-*` above, change these to match.
           */
          className="border-t border-line [&:nth-child(-n+2)]:border-t-0 sm:[&:nth-child(-n+3)]:border-t-0 lg:[&:nth-child(-n+4)]:border-t-0"
        >
          <Link
            to={`/category/${c.slug}`}
            className="group flex items-center gap-3 py-[15px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
          >
            {/* The department's own tint, straight from the database — so the colour carries
                meaning rather than being applied for effect. Decorative to a screen reader:
                the name beside it says everything the dot does. */}
            <span
              aria-hidden="true"
              className="h-[13px] w-[13px] shrink-0 rounded-full border border-ink/10"
              style={{ background: c.tint || "var(--color-plum-soft)" }}
            />
            <span className="serif min-w-0 flex-1 truncate text-[15px] text-ink transition-colors group-hover:text-plum">
              {c.name}
            </span>
            {typeof c.count === "number" && c.count > 0 && (
              <span className="tabular shrink-0 text-[11px] text-muted">{c.count.toLocaleString()}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
