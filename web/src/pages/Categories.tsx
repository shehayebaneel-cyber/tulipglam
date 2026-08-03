import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
import { EmptyState } from "../components/EmptyState";
import { ChevronRight } from "../components/ui";

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
 * ── IT RENDERS FROM DATA ALREADY LOADED ────────────────────────────────────────────
 *
 * `/api/site` already carries the two-level tree with rolled-up counts, fetched once at boot for
 * the nav. So this page costs one route and no request — no endpoint, no spinner, no loading
 * state to design. It is also why the counts here always agree with the header and the homepage:
 * one source, three renderings.
 *
 * ── WHAT IT DOES NOT SHOW ──────────────────────────────────────────────────────────
 *
 * Admin lists 41 categories; this shows 38. The difference is Electricals, Oral Care and
 * Sets & Routines, which the owner retired — the server never sends them, so there is nothing to
 * filter here and no way for this page to resurrect them by accident.
 *
 * A department whose count is zero is still shown if the server sent it, because a department
 * with no products is a catalogue problem to see rather than a page to hide. A SUBCATEGORY at
 * zero is dropped: a shopper tapping "Toners" into an empty shelf learns nothing except that the
 * shop wasted their tap.
 */
export function Categories() {
  const { site } = useStore();
  const departments = site?.categories ?? [];

  if (departments.length === 0) {
    return (
      <EmptyState
        title="Categories are still loading"
        body="If this stays empty, the catalogue could not be reached. Try again in a moment."
        action={{ label: "Go to the shop", to: "/shop" }}
      />
    );
  }

  const totalShown = departments.length + departments.reduce((n, d) => n + d.children.filter((c) => (c._count?.products ?? 0) > 0).length, 0);

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
        <p className="t-small text-muted">{totalShown} categories across {departments.length} departments.</p>
      </div>

      <div className="mt-8 space-y-9">
        {departments.map((d) => {
          // Empty shelves are not offered. See the note above on why a zero department stays.
          const children = d.children.filter((c) => (c._count?.products ?? 0) > 0);
          return (
            <section key={d.slug}>
              {/*
                The department heading is the link to the department itself, so a shopper who
                wants "all of Skincare" does not have to guess which child means everything.
              */}
              <Link
                to={`/category/${d.slug}`}
                className="group flex items-baseline justify-between gap-3 border-b border-line pb-2"
              >
                <span className="t-section text-ink transition-colors group-hover:text-plum">{d.name}</span>
                <span className="t-micro shrink-0 tabular text-muted">
                  {(d._count?.products ?? 0).toLocaleString()}
                </span>
              </Link>

              {children.length > 0 ? (
                <ul className="mt-3 grid grid-cols-2 gap-x-5 sm:grid-cols-3 lg:grid-cols-4">
                  {children.map((c) => (
                    <li key={c.slug} className="border-b border-line/70 last:border-b-0 sm:last:border-b">
                      <Link
                        to={`/category/${c.slug}`}
                        className="flex items-center justify-between gap-2 py-2.5 text-[14px] text-ink transition-colors hover:text-plum"
                      >
                        <span className="min-w-0 truncate">{c.name}</span>
                        <span className="t-micro shrink-0 tabular text-muted">
                          {(c._count?.products ?? 0).toLocaleString()}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                // A department that holds its products directly — Deodorant, Wellness — has no
                // children to list, and saying so is better than an unexplained gap.
                <p className="mt-3 text-[13px] text-muted">
                  <Link to={`/category/${d.slug}`} className="hover:text-plum">
                    Browse all {(d._count?.products ?? 0).toLocaleString()} products →
                  </Link>
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
