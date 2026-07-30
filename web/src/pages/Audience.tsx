import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type Card } from "../lib/api";
import { useStore } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { ProductCard } from "../components/ProductCard";
import { ChevronRight, Spinner } from "../components/ui";
import { ErrorState } from "../components/ErrorState";

export type AudienceKey = "men" | "women";

/**
 * `/men` and `/women`, and their department views.
 *
 * One component for both. They differ only in a slug and a heading, and two near-identical
 * pages drift — a fix applied to one silently skips the other.
 *
 * Who a product is for cuts across the whole taxonomy: a men's fragrance, a men's shaving
 * cream and a men's shampoo live in three different departments, so this is a field on the
 * product, not a category. Unisex products count as both, which is why the listing below asks
 * for `audience=men` (men + unisex) while the department strip is built from
 * `/api/audience/men` (men only). A unisex moisturiser belongs on the shelf; it should not
 * make "Skincare" look like a men's department.
 */
export function Audience({ audience }: { audience: AudienceKey }) {
  const { department } = useParams();
  const { site } = useStore();
  const [params, setParams] = useSearchParams();

  const sort = params.get("sort") ?? "featured";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const { data: nav } = useFetch(() => api.audience(audience), [audience]);

  const query = useMemo(() => ({
    audience,
    category: department || undefined,
    sort,
    page: page > 1 ? String(page) : undefined,
  }), [audience, department, sort, page]);
  const { data, loading, error, reload } = useFetch(() => api.products(query), [JSON.stringify(query)]);

  const products = data?.products ?? [];
  const pages = data?.pages ?? 1;

  const title = audience === "men" ? "Men" : "Women";
  const dept = nav?.departments.find((d) => d.slug === department);
  const heading = dept ? `${title} · ${dept.name}` : title;

  const setP = (key: string, val: string) => {
    const next = new URLSearchParams(params);
    if (val) next.set(key, val); else next.delete(key);
    next.delete("page");
    setParams(next, { replace: true });
  };
  const goPage = (n: number) => {
    const next = new URLSearchParams(params);
    if (n <= 1) next.delete("page"); else next.set("page", String(n));
    setParams(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Nothing is classified yet. Say why, and say what makes it appear — an empty shelf with no
  // explanation reads as a broken page, and this one is waiting on data, not on code.
  const unclassified = nav != null && nav.total === 0;

  return (
    <div className="wrap py-6 sm:py-8">
      <nav className="mb-1 flex items-center gap-1 text-[12px] text-muted">
        <Link to="/" className="hover:text-plum">Home</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        {dept ? (
          <>
            <Link to={`/${audience}`} className="hover:text-plum">{title}</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-ink/70">{dept.name}</span>
          </>
        ) : (
          <span className="text-ink/70">{title}</span>
        )}
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="serif text-3xl font-medium text-ink sm:text-4xl">{heading}</h1>
          <p className="mt-1 text-sm text-muted">
            {audience === "men" ? "Grooming, fragrance and skincare for him." : "Beauty, skincare and fragrance for her."}
            {" "}Unisex products are included.
          </p>
        </div>
        {!unclassified && (
          <div className="flex items-center gap-2">
            <span className="hidden text-[13px] text-muted sm:inline">
              {loading ? "…" : `${data?.total ?? 0} item${(data?.total ?? 0) === 1 ? "" : "s"}${pages > 1 ? ` · page ${page} of ${pages}` : ""}`}
            </span>
            <select value={sort} onChange={(e) => setP("sort", e.target.value)} aria-label="Sort products"
              className="focus-ring rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink outline-none">
              <option value="featured">Featured</option>
              <option value="newest">Newest</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>
        )}
      </div>

      {/* Department strip. Only departments that hold product for this audience, so it can
          never offer a link that lands on an empty page. */}
      {!!nav?.departments.length && (
        <div className="scroll-x mt-5 flex gap-2 pb-1">
          <Link to={`/${audience}`}
            className={`chip ${!department ? "chip-on" : ""}`}>All {title.toLowerCase()}</Link>
          {nav.departments.map((d) => (
            <Link key={d.slug} to={`/${audience}/${d.slug}`}
              className={`chip ${department === d.slug ? "chip-on" : ""}`}>
              {d.name} <span className="num-tabular opacity-60">{d.count}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6">
        {unclassified ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong py-20 text-center">
            <div className="max-w-sm">
              <p className="serif text-2xl text-ink">{title}’s isn’t set up yet</p>
              <p className="mt-2 text-sm text-muted">
                Products aren’t marked as men’s or women’s yet, so there’s nothing to show here.
                Everything in the catalogue is still browsable by department.
              </p>
              <Link to="/shop" className="btn btn-ink mt-6 px-6 py-3">Browse all products</Link>
            </div>
          </div>
        ) : loading ? (
          <div className="grid place-items-center py-24 text-plum"><Spinner /></div>
        ) : error ? (
          <ErrorState title="We couldn’t load these products" detail={error} onRetry={reload} />
        ) : products.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong py-20 text-center">
            <div>
              <p className="serif text-2xl text-ink">Nothing here yet</p>
              <p className="mx-auto mt-2 max-w-xs text-sm text-muted">This department has nothing for {title.toLowerCase()} right now.</p>
              <Link to={`/${audience}`} className="btn btn-ghost mt-5 px-6 py-2.5">All {title.toLowerCase()}</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-3.5 gap-y-8 sm:grid-cols-3 sm:gap-5 xl:grid-cols-4">
              {products.map((p: Card) => <ProductCard key={p.id} p={p} />)}
            </div>
            {pages > 1 && (
              <nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-3">
                <button onClick={() => goPage(page - 1)} disabled={page <= 1}
                  className="focus-ring rounded-full border border-line px-4 py-2 text-[13px] font-medium text-ink disabled:opacity-35">Prev</button>
                <span className="num-tabular text-[13px] text-muted">Page {page} of {pages}</span>
                <button onClick={() => goPage(page + 1)} disabled={page >= pages}
                  className="focus-ring rounded-full border border-line px-4 py-2 text-[13px] font-medium text-ink disabled:opacity-35">Next</button>
              </nav>
            )}
          </>
        )}
      </div>

      {/* There is no sibling shelf to link to any more — /men was retired — so this points
          at the full catalogue instead of a route that would 404. */}
      {!!site && (
        <p className="mt-10 text-center text-[13px] text-muted">
          Looking for something else?{" "}
          <Link to="/shop" className="font-semibold text-plum hover:underline">Browse everything</Link>
        </p>
      )}
    </div>
  );
}
