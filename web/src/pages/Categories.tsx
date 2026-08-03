import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { EmptyState } from "../components/EmptyState";
import { ChevronRight, ArrowRight } from "../components/ui";

/**
 * Every department and everything inside it, on one page.
 *
 * ── WHY THIS PAGE EXISTS ───────────────────────────────────────────────────────────
 *
 * The homepage lists the eleven departments and stops there. Twenty-seven subcategories — where
 * a shopper's actual intent lives, "Serums", "Lips", "For Him" — were reachable only through the
 * desktop nav dropdowns or by already knowing the URL. On a phone, where the nav is a drawer and
 * the drawer is an accordion, that is several taps into a menu to discover a shelf exists.
 *
 * ── WHY CARDS, AFTER A FIRST ATTEMPT AT ROWS ───────────────────────────────────────
 *
 * The first version laid this out as full-width rows and it read as a spreadsheet. Three faults,
 * all of them worse the wider the screen got:
 *
 *   · the department's count sat at the far right edge, a hand's width from the name it belonged
 *     to, so the eye had to travel across empty space to pair them;
 *   · every subcategory carried its own bottom rule, and because the rows are a grid those rules
 *     stopped wherever a row ran short — leaving broken stubs of line hanging in the gaps;
 *   · nothing bounded a department, so eleven of them ran together as one wall of text.
 *
 * Cards fix all three by construction. A count sits beside its name because the card is narrow.
 * One rule per card instead of one per item. And the boundary does the grouping that spacing
 * alone could not.
 *
 * ── CSS COLUMNS, NOT A GRID ────────────────────────────────────────────────────────
 *
 * Departments hold between zero and six children, so a grid would stretch every card in a row to
 * match the tallest and leave dead air under the short ones. Multi-column flow packs them by
 * height instead, which is what makes the page look composed rather than gappy. `break-inside`
 * keeps a card whole.
 *
 * ── IT RENDERS FROM DATA ALREADY LOADED ────────────────────────────────────────────
 *
 * `/api/site` already carries the two-level tree with rolled-up counts, fetched once at boot for
 * the nav. One route, no request, no spinner — and it is why the counts here always agree with
 * the header and the homepage: one source, three renderings.
 *
 * ── WHAT IT DOES NOT SHOW ──────────────────────────────────────────────────────────
 *
 * Admin lists 41 categories; this shows 38. The difference is Electricals, Oral Care and
 * Sets & Routines, which the owner retired — the server never sends them, so there is nothing to
 * filter here and no way for this page to resurrect them by accident.
 *
 * A department whose count is zero is still shown: a department with no products is a catalogue
 * problem to see rather than a page to hide. A SUBCATEGORY at zero is dropped, because a shopper
 * tapping "Toners" into an empty shelf learns only that the shop wasted their tap.
 */
export function Categories() {
  const { site } = useStore();

  /**
   * Deepest department first, matching the homepage.
   *
   * The server's own order is `sortOrder`, which drives the nav and is roughly editorial. Here it
   * read as arbitrary: Nails opened the page with 399 products while Skincare sat third with
   * 2,223. On a page that is nothing but a list, position is the only emphasis available, so it
   * should go to the shelves most likely to hold what someone came for.
   *
   * Sorted here rather than in the store, for the same reason Home.tsx sorts its own copy: this
   * is a merchandising decision belonging to the page that makes it, and the nav's order is a
   * different job with a different answer.
   */
  const departments = [...(site?.categories ?? [])]
    .sort((a, b) => (b._count?.products ?? 0) - (a._count?.products ?? 0));

  if (departments.length === 0) {
    return (
      <EmptyState
        title="Categories are still loading"
        body="If this stays empty, the catalogue could not be reached. Try again in a moment."
        action={{ label: "Go to the shop", to: "/shop" }}
      />
    );
  }

  const shown = departments.length
    + departments.reduce((n, d) => n + d.children.filter((c) => (c._count?.products ?? 0) > 0).length, 0);

  return (
    <div className="wrap py-6 sm:py-8">
      <nav className="mb-4 flex flex-wrap items-center gap-1 text-[12px] text-muted">
        <Link to="/" className="hover:text-plum">Home</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-ink/70">All categories</span>
      </nav>

      <div className="section-head">
        <p className="eyebrow">Shop by category</p>
        <h1 className="t-title text-ink">Everything we carry</h1>
        <p className="t-small measure text-muted">
          {shown} categories across {departments.length} departments. Tap a department for all of
          it, or go straight to a shelf.
        </p>
      </div>

      <div className="mt-7 gap-5 sm:columns-2 lg:columns-3">
        {departments.map((d) => {
          const children = d.children.filter((c) => (c._count?.products ?? 0) > 0);
          const total = d._count?.products ?? 0;

          return (
            // `break-inside-avoid` so a card is never split across two columns; the bottom margin
            // is what separates them, since column-gap only handles the horizontal axis.
            <section key={d.slug} className="panel mb-5 break-inside-avoid p-5">
              <Link to={`/category/${d.slug}`} className="group flex items-baseline justify-between gap-3">
                <span className="t-section text-ink transition-colors group-hover:text-plum">{d.name}</span>
                {/* Beside the name, not at the page edge — the whole reason for the card. */}
                <span className="t-micro shrink-0 tabular text-muted">{total.toLocaleString()}</span>
              </Link>

              {children.length > 0 ? (
                <>
                  <ul className="mt-3 border-t border-line pt-1">
                    {children.map((c) => (
                      <li key={c.slug}>
                        <Link
                          to={`/category/${c.slug}`}
                          className="flex items-baseline justify-between gap-3 py-1.5 text-[14px] text-ink/85 transition-colors hover:text-plum"
                        >
                          <span className="min-w-0 truncate">{c.name}</span>
                          <span className="t-micro shrink-0 tabular text-muted">
                            {(c._count?.products ?? 0).toLocaleString()}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to={`/category/${d.slug}`}
                    className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-plum hover:gap-1.5"
                  >
                    All {d.name} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </>
              ) : (
                // A department that holds its products directly — Deodorant, Wellness — has no
                // children, and saying so plainly beats an unexplained empty card.
                <Link
                  to={`/category/${d.slug}`}
                  className="mt-3 inline-flex items-center gap-1 border-t border-line pt-3 text-[13px] font-semibold text-plum hover:gap-1.5"
                >
                  Browse all {total.toLocaleString()} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
