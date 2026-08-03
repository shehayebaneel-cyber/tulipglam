import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { api, usd, type Brand, type Card, type Facets, type SiteData } from "../lib/api";
import { useStore } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { ProductCard } from "../components/ProductCard";
import { ProductGridSkeleton } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { FilterIcon, CloseIcon, ChevronDown, ChevronRight, SearchIcon } from "../components/ui";

type Mode = "all" | "category" | "new" | "bestsellers" | "sale" | "search";

const SORTS = [
  ["featured", "Featured"], ["newest", "Newest"], ["price-asc", "Price: low to high"],
  ["price-desc", "Price: high to low"], ["name", "Name A–Z"],
] as const;

const titleFor: Record<Mode, string> = {
  all: "All products", category: "", new: "New arrivals", bestsellers: "Best sellers", sale: "On sale", search: "Search",
};

const label = (t: string) => t.replace(/-/g, " ");

/** "Showing 49–96 of 9,533" — collapses to a plain count when everything fits on one page. */
function rangeLabel(d: { total: number; page: number; pages: number; limit: number } | null | undefined): string {
  const total = d?.total ?? 0;
  if (!total) return "No items";
  if ((d?.pages ?? 1) <= 1) return `${total.toLocaleString()} item${total === 1 ? "" : "s"}`;
  const first = (d!.page - 1) * d!.limit + 1;
  const last = Math.min(d!.page * d!.limit, total);
  return `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`;
}

/** Everything the sidebar and the mobile sheet need, resolved once in `Shop`. */
type FilterState = {
  site: SiteData | null;
  facets: Facets | undefined;
  mode: Mode;
  catParam: string;
  brands: string[];
  concerns: string[];
  attrs: string[];
  priceMin: string;
  priceMax: string;
  includeUnavailable: boolean;
  audience: string;
  setP: (key: string, val: string) => void;
  toggleMulti: (key: string, arr: string[], val: string) => void;
};

/**
 * The full brand list, fetched only when a page that filters by brand needs it.
 *
 * It used to arrive on /api/site — all 405 of them, 73 KB, on the first load of EVERY page
 * including a homepage that shows two. Now it is fetched here, once per session, by the one
 * page that has ever needed it.
 *
 * Cached at module scope rather than in state: several components on this page want it, a
 * customer may come back to Shop repeatedly, and the list changes only when the catalogue is
 * re-imported.
 */
let brandCache: Brand[] | null = null;
let brandPromise: Promise<Brand[]> | null = null;

function useAllBrands(): Brand[] {
  const [brands, setBrands] = useState<Brand[]>(brandCache ?? []);
  useEffect(() => {
    if (brandCache) return;
    let live = true;
    brandPromise ??= api.brands().then((r) => { brandCache = r.brands; return r.brands; }).catch(() => []);
    // A failure here is not worth surfacing: the chips fall back to showing the slug, which is
    // ugly but correct, and the facet list comes from the server's own facets anyway.
    brandPromise.then((b) => { if (live) setBrands(b); });
    return () => { live = false; };
  }, []);
  return brands;
}

export function Shop({ mode }: { mode: Mode }) {
  const { slug } = useParams();
  const { site } = useStore();
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState(false);

  // Brand is multi-select — stored comma-joined in one param so the URL stays short and
  // a filtered view can be pasted to someone else exactly as seen.
  const brands = (params.get("brand") ?? "").split(",").filter(Boolean);
  const sort = params.get("sort") ?? "featured";
  const q = params.get("q") ?? "";
  const attrs = (params.get("attributes") ?? "").split(",").filter(Boolean);
  const concerns = (params.get("concerns") ?? "").split(",").filter(Boolean);
  const priceMin = params.get("priceMin") ?? "";
  const priceMax = params.get("priceMax") ?? "";
  // Off by default: a shopper browsing wants things they can order today. Turning it on is
  // an availability answer ("show me the rest too"), never a quantity.
  const includeUnavailable = params.get("available") === "0";
  // "men-only" / "women-only" rather than "men" / "women". The server's plain "men" also
  // includes unisex, which made sense for the /men shelf that used to exist; as a filter
  // inside a department "For him" has to mean the ones actually marked men's, or picking it
  // barely changes the results.
  const audience = params.get("audience") ?? "";
  const catParam = mode === "category" ? slug ?? "" : params.get("category") ?? "";

  // The catalogue is ~9.5k products, so the API is paginated — `page` lives in the URL
  // so a given page of results stays shareable and the back button works.
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const query = useMemo(() => ({
    category: catParam || undefined,
    brand: brands.join(",") || undefined,
    sort,
    q: mode === "search" ? q : undefined,
    new: mode === "new" ? "1" : undefined,
    best: mode === "bestsellers" ? "1" : undefined,
    sale: mode === "sale" ? "1" : undefined,
    attributes: attrs.join(",") || undefined,
    concerns: concerns.join(",") || undefined,
    priceMin: priceMin || undefined,
    priceMax: priceMax || undefined,
    available: includeUnavailable ? "0" : undefined,
    audience: audience || undefined,
    page: page > 1 ? String(page) : undefined,
    facets: "1",
  }), [catParam, brands.join(","), sort, q, mode, attrs.join(","), concerns.join(","), priceMin, priceMax, includeUnavailable, audience, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, loading, error, reload } = useFetch(() => api.products(query), [JSON.stringify(query)]);
  const products = data?.products ?? [];
  const pages = data?.pages ?? 1;
  const facets = data?.facets;

  const goPage = (n: number) => {
    const next = new URLSearchParams(params);
    if (n <= 1) next.delete("page"); else next.set("page", String(n));
    setParams(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Flat lookup over both levels — a category filter can be a department or a child.
  const catBySlug = useMemo(() => {
    const m = new Map<string, { name: string; blurb: string }>();
    for (const d of site?.categories ?? []) {
      m.set(d.slug, d);
      for (const c of d.children) m.set(c.slug, c);
    }
    return m;
  }, [site]);
  const cat = catBySlug.get(catParam);
  const heading = mode === "category" ? cat?.name ?? "Category" : mode === "search" ? (q ? `Results for “${q}”` : "Search") : titleFor[mode];
  const sub = mode === "category" ? cat?.blurb : undefined;

  const setP = (key: string, val: string) => {
    const next = new URLSearchParams(params);
    if (val) next.set(key, val); else next.delete(key);
    next.delete("page"); // any filter or sort change starts again at page 1
    setParams(next, { replace: true });
  };
  const toggleMulti = (key: string, arr: string[], val: string) => {
    const set = new Set(arr);
    if (set.has(val)) set.delete(val); else set.add(val);
    setP(key, [...set].join(","));
  };

  const allBrands = useAllBrands();

  // One chip per applied filter, each removable on its own. Before this the only way back
  // was "Clear", which threw away every choice to undo one of them.
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (mode !== "category" && catParam) chips.push({ key: `c-${catParam}`, label: catBySlug.get(catParam)?.name ?? catParam, clear: () => setP("category", "") });
  for (const b of brands) {
    const name = allBrands.find((x) => x.slug === b)?.name ?? b;
    chips.push({ key: `b-${b}`, label: name, clear: () => toggleMulti("brand", brands, b) });
  }
  for (const c of concerns) chips.push({ key: `k-${c}`, label: label(c), clear: () => toggleMulti("concerns", concerns, c) });
  for (const a of attrs) chips.push({ key: `a-${a}`, label: label(a), clear: () => toggleMulti("attributes", attrs, a) });
  if (priceMin || priceMax) {
    const text = priceMin && priceMax ? `$${priceMin}–$${priceMax}` : priceMin ? `Over $${priceMin}` : `Under $${priceMax}`;
    chips.push({ key: "price", label: text, clear: () => { const n = new URLSearchParams(params); n.delete("priceMin"); n.delete("priceMax"); n.delete("page"); setParams(n, { replace: true }); } });
  }
  if (audience) chips.push({ key: "aud", label: audience.startsWith("men") ? "For him" : "For her", clear: () => setP("audience", "") });
  if (includeUnavailable) chips.push({ key: "avail", label: "Including unavailable", clear: () => setP("available", "") });

  const activeCount = chips.length;
  const clearAll = () => {
    const n = new URLSearchParams();
    if (sort !== "featured") n.set("sort", sort);
    if (mode === "search" && q) n.set("q", q);
    setParams(n, { replace: true });
  };

  const fs: FilterState = { site, facets, mode, catParam, brands, concerns, attrs, priceMin, priceMax, includeUnavailable, audience, setP, toggleMulti };

  return (
    <div className="wrap py-6 sm:py-8">
      {/* breadcrumb + heading */}
      <nav className="mb-1 flex items-center gap-1 text-[12px] text-muted">
        <Link to="/" className="hover:text-plum">Home</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-ink/70">{heading}</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="serif text-3xl font-medium text-ink sm:text-4xl">{heading}</h1>
          {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
        </div>
        <div className="flex items-center gap-2">
          {/* Position in the whole result set, not just this page's 48. At 194 pages "48 items"
              on its own is meaningless — you need to know where you are. */}
          <span className="hidden text-[13px] text-muted sm:inline">{loading ? "…" : rangeLabel(data)}</span>
          <div className="relative">
            <select value={sort} onChange={(e) => setP("sort", e.target.value)} aria-label="Sort products"
              className="focus-ring appearance-none rounded-full border border-line bg-surface py-2 pl-4 pr-9 text-[13px] font-medium text-ink outline-none">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          </div>
          <button onClick={() => setSheet(true)} className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-medium lg:hidden">
            <FilterIcon className="h-4 w-4" /> Filters{activeCount ? ` · ${activeCount}` : ""}
          </button>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={c.key} onClick={c.clear}
              className="focus-ring group inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-1.5 pl-3 pr-2 text-[12px] font-medium text-ink hover:border-ink">
              {c.label}
              <CloseIcon className="h-3.5 w-3.5 text-muted group-hover:text-ink" />
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          <button onClick={clearAll} className="focus-ring rounded-full px-2 py-1.5 text-[12px] font-semibold text-plum hover:underline">Clear all</button>
        </div>
      )}

      <div className="mt-6 flex gap-8">
        {/* desktop sidebar */}
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Filters</h2>
            {activeCount > 0 && <button onClick={clearAll} className="focus-ring rounded text-[12px] font-semibold text-plum hover:underline">Clear</button>}
          </div>
          <div className="mt-4"><Filters fs={fs} /></div>
        </aside>

        {/* grid */}
        <div className="min-w-0 flex-1">
          {loading ? (
            /* The card shape at the card size, not a spinner in the middle of nothing. The
               grid's final layout exists before the products do, so landing them moves
               nothing — which on a Lebanese mobile connection is several seconds of a page
               that would otherwise be reflowing under the reader's thumb. */
            <ProductGridSkeleton count={products.length || 8} />
          ) : error ? (
            /* Without this, a failed request rendered "Nothing here yet" — telling a shopper
               the catalogue is empty when nothing was ever loaded. */
            <ErrorState title="We couldn’t load these products" detail={error} onRetry={reload} />
          ) : products.length === 0 ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong py-20 text-center">
              <div>
                <p className="t-section text-ink">{activeCount > 0 ? "No matches" : "Nothing here yet"}</p>
                <p className="t-small measure mx-auto mt-2 text-muted">
                  {activeCount > 0 ? "No products match these filters. Try removing one." : "There's nothing in this section right now."}
                </p>
                {activeCount > 0 && <button onClick={clearAll} className="btn btn-ghost mt-5 px-6 py-2.5">Clear filters</button>}

                {/*
                  The highest-intent moment on the whole site.

                  Someone has just told us what they want, in their own words, and we do not have
                  it. This shop sources every order after it is placed, so "we don't carry that"
                  is not the end of the conversation — it is the only moment where offering to go
                  and look is both useful and honest. The term is carried through so nobody
                  retypes what they just searched for.

                  Only on a SEARCH. An empty category is a catalogue gap for the owner to fix,
                  not a request to make.
                */}
                {mode === "search" && q && (
                  <div className="mt-6 border-t border-line pt-5">
                    <p className="t-small text-ink">We don’t list it — but we might be able to get it.</p>
                    <Link
                      to={`/request?q=${encodeURIComponent(q)}&from=search`}
                      className="btn btn-primary btn-cta mt-3 px-6 py-3"
                    >
                      Ask us to source it
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-3.5 gap-y-8 sm:grid-cols-3 sm:gap-5 xl:grid-cols-4">
                {products.map((p: Card) => <ProductCard key={p.id} p={p} />)}
              </div>
              {pages > 1 && <Pagination page={page} pages={pages} onGo={goPage} />}
            </>
          )}
        </div>
      </div>

      {/* mobile filter sheet */}
      {sheet && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-3xl bg-paper shadow-pop">
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <h2 className="serif text-xl text-ink">Filters</h2>
              <button onClick={() => setSheet(false)} aria-label="Close" className="focus-ring grid h-9 w-9 place-items-center rounded-full hover:bg-soft"><CloseIcon /></button>
            </div>
            {/* The list scrolls, the actions stay put — at 390px the sheet is tall enough that
                "Show N items" was below the fold and looked missing. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              <Filters fs={fs} />
            </div>
            <div className="flex gap-3 border-t border-line px-5 pb-8 pt-4">
              {activeCount > 0 && <button onClick={clearAll} className="btn btn-ghost flex-1 py-3">Clear</button>}
              <Button onClick={() => setSheet(false)} variant="primary" className="flex-1">
                {loading ? "Show results" : `Show ${data?.total ?? 0} item${(data?.total ?? 0) === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The filter panel, shared by the desktop sidebar and the mobile sheet.
 *
 * Declared at module scope, not inside `Shop`. As a nested function it was a new component
 * type on every render, so React unmounted and remounted the whole panel on each keystroke —
 * which would have made the brand search box impossible to type in.
 */
function Filters({ fs }: { fs: FilterState }) {
  const { site, facets, mode, concerns, attrs, includeUnavailable, setP, toggleMulti } = fs;
  return (
    <div className="space-y-5 pb-2">
      {/* Ordered by how often each is used, because at 390px the sheet scrolls: category and
          brand first, the availability toggle last. */}
      <AudienceFilter fs={fs} />

      {mode !== "category" && !!site?.categories.length && <CategoryFilter fs={fs} />}

      <BrandFilter fs={fs} />

      <PriceFilter fs={fs} />

      {/* Tag groups are driven by what the catalogue actually carries. They were a hardcoded
          list of 9 concerns and 5 attributes, none of which any product had, so every one of
          the 14 options led to an empty page. Tag products in admin and the groups return. */}
      {!!facets?.concerns.length && (
        <FilterGroup title="Good for">
          {facets.concerns.map((c) => (
            <label key={c.value} className="filter-row capitalize">
              <input type="checkbox" checked={concerns.includes(c.value)} onChange={() => toggleMulti("concerns", concerns, c.value)} className="accent-plum" />
              <span className="flex-1">{label(c.value)}</span>
              <span className="num-tabular text-[11px] text-muted">{c.count}</span>
            </label>
          ))}
        </FilterGroup>
      )}
      {!!facets?.attributes.length && (
        <FilterGroup title="Attributes">
          {facets.attributes.map((a) => (
            <label key={a.value} className="filter-row capitalize">
              <input type="checkbox" checked={attrs.includes(a.value)} onChange={() => toggleMulti("attributes", attrs, a.value)} className="accent-plum" />
              <span className="flex-1">{label(a.value)}</span>
              <span className="num-tabular text-[11px] text-muted">{a.count}</span>
            </label>
          ))}
        </FilterGroup>
      )}

      <FilterGroup title="Availability">
        <label className="filter-row">
          <input type="checkbox" checked={includeUnavailable} onChange={() => setP("available", includeUnavailable ? "" : "0")} className="accent-plum" />
          Include temporarily unavailable
        </label>
        <p className="pt-1 text-[11px] leading-snug text-muted">Everything is sourced to order — we confirm each item with you before dispatch.</p>
      </FilterGroup>
    </div>
  );
}

/**
 * Who it's for.
 *
 * Hidden entirely while nothing in the current selection is marked men's or women's — the same
 * rule as the concerns and attributes groups. A "For him" option that returns the whole
 * department is worse than no option, and until the audience classifier has been run over the
 * catalogue that is exactly what it would be.
 */
function AudienceFilter({ fs }: { fs: FilterState }) {
  const { facets, audience, setP } = fs;
  const men = facets?.audience?.men ?? 0;
  const women = facets?.audience?.women ?? 0;
  if (!men && !women) return null;

  const opts: [string, string, number][] = [
    ["", "Everyone", (facets?.audience?.unisex ?? 0) + men + women],
    ...(women ? [["women-only", "For her", women] as [string, string, number]] : []),
    ...(men ? [["men-only", "For him", men] as [string, string, number]] : []),
  ];
  return (
    <FilterGroup title="Shop for">
      {opts.map(([value, label_, count]) => (
        <label key={value || "all"} className="filter-row">
          <input type="radio" name="tg-audience" checked={audience === value} onChange={() => setP("audience", value)} className="accent-plum" />
          <span className="flex-1">{label_}</span>
          <span className="num-tabular text-[11px] text-muted">{count}</span>
        </label>
      ))}
    </FilterGroup>
  );
}

/** Departments with their subcategories, one level deep, expanded when in scope. */
function CategoryFilter({ fs }: { fs: FilterState }) {
  const { site, catParam, setP } = fs;
  return (
    <FilterGroup title="Category">
      <label className="filter-row">
        <input type="radio" name="tg-cat" checked={!catParam} onChange={() => setP("category", "")} className="accent-plum" /> All categories
      </label>
      {(site?.categories ?? []).map((d) => {
        const inScope = catParam === d.slug || d.children.some((c) => c.slug === catParam);
        return (
          <div key={d.slug}>
            <label className="filter-row">
              <input type="radio" name="tg-cat" checked={catParam === d.slug} onChange={() => setP("category", d.slug)} className="accent-plum" />
              <span className="flex-1">{d.name}</span>
              <span className="num-tabular text-[11px] text-muted">{d._count.products}</span>
            </label>
            {inScope && d.children.map((c) => (
              <label key={c.slug} className="filter-row pl-6">
                <input type="radio" name="tg-cat" checked={catParam === c.slug} onChange={() => setP("category", c.slug)} className="accent-plum" />
                <span className="flex-1">{c.name}</span>
                <span className="num-tabular text-[11px] text-muted">{c._count.products}</span>
              </label>
            ))}
          </div>
        );
      })}
    </FilterGroup>
  );
}

/**
 * Brand multi-select.
 *
 * The catalogue carries 405 brands. This was a 405-row radio list where picking one replaced
 * the last, and it offered every brand on every page — including brands with nothing in the
 * category being viewed. Now it is checkboxes over the server's facet counts (brands with
 * results here, and how many), with a search box and a collapsed default so the sidebar
 * doesn't run to several screens. Selected brands stay pinned at the top so a choice made
 * before searching never scrolls out of reach.
 */
function BrandFilter({ fs }: { fs: FilterState }) {
  const { facets, brands, toggleMulti } = fs;
  const allBrands = useAllBrands();
  const [term, setTerm] = useState("");
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 8;

  // Fall back to the site list before facets land, so the group doesn't pop in.
  const all = useMemo(
    () => facets?.brands ?? allBrands.map((b) => ({ slug: b.slug, name: b.name, count: b._count?.products ?? 0 })),
    [facets, allBrands],
  );
  const t = term.trim().toLowerCase();
  const matches = t ? all.filter((b) => b.name.toLowerCase().includes(t)) : all;
  const selected = matches.filter((b) => brands.includes(b.slug));
  const rest = matches.filter((b) => !brands.includes(b.slug));
  const shown = showAll || t ? rest : rest.slice(0, Math.max(0, LIMIT - selected.length));
  const hidden = rest.length - shown.length;

  if (!all.length) return null;
  return (
    <FilterGroup title="Brand">
      {all.length > LIMIT && (
        <div className="relative pb-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={term} onChange={(e) => setTerm(e.target.value)} type="search" placeholder={`Search ${all.length} brands`}
            aria-label="Search brands"
            className="focus-ring w-full rounded-full border border-line bg-surface py-2 pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-muted"
          />
        </div>
      )}
      {[...selected, ...shown].map((b) => (
        <label key={b.slug} className="filter-row">
          <input type="checkbox" checked={brands.includes(b.slug)} onChange={() => toggleMulti("brand", brands, b.slug)} className="accent-plum" />
          <span className="flex-1 truncate" title={b.name}>{b.name}</span>
          <span className="num-tabular text-[11px] text-muted">{b.count}</span>
        </label>
      ))}
      {t && !matches.length && <p className="py-1 text-[12px] text-muted">No brand matches “{term}”.</p>}
      {!t && hidden > 0 && (
        <button onClick={() => setShowAll(true)} className="focus-ring rounded pt-1 text-[12px] font-semibold text-plum hover:underline">
          Show {hidden} more
        </button>
      )}
      {!t && showAll && rest.length > LIMIT && (
        <button onClick={() => setShowAll(false)} className="focus-ring rounded pt-1 text-[12px] font-semibold text-plum hover:underline">Show fewer</button>
      )}
    </FilterGroup>
  );
}

/**
 * Price range in whole dollars, applied on blur or Enter rather than per keystroke — typing
 * "30" would otherwise fire a request for "3" first and repaginate under the cursor.
 * The catalogue spans $0.21 to $735, so the facet range is shown as the placeholder.
 */
function PriceFilter({ fs }: { fs: FilterState }) {
  const { facets, priceMin, priceMax, setP } = fs;
  const [lo, setLo] = useState(priceMin);
  const [hi, setHi] = useState(priceMax);
  // Re-sync when a chip clears the range from outside this component.
  const [seen, setSeen] = useState(`${priceMin}|${priceMax}`);
  if (seen !== `${priceMin}|${priceMax}`) { setSeen(`${priceMin}|${priceMax}`); setLo(priceMin); setHi(priceMax); }

  const clean = (v: string) => v.replace(/[^\d.]/g, "");
  const apply = () => {
    const a = clean(lo), b = clean(hi);
    // A backwards range returns nothing and reads as a bug, so swap it rather than obey it.
    const [min, max] = a && b && Number(a) > Number(b) ? [b, a] : [a, b];
    if (min !== priceMin) setP("priceMin", min);
    if (max !== priceMax) setP("priceMax", max);
    setLo(min); setHi(max);
  };
  const bounds = facets?.price;
  const cls = "focus-ring w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-muted";

  return (
    <FilterGroup title="Price">
      <div className="flex items-center gap-2 pt-0.5">
        <input value={lo} onChange={(e) => setLo(clean(e.target.value))} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()}
          inputMode="decimal" aria-label="Minimum price" placeholder={bounds ? usd(bounds.minCents).replace("$", "") : "Min"} className={cls} />
        <span className="text-muted">–</span>
        <input value={hi} onChange={(e) => setHi(clean(e.target.value))} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && apply()}
          inputMode="decimal" aria-label="Maximum price" placeholder={bounds ? usd(bounds.maxCents).replace("$", "") : "Max"} className={cls} />
      </div>
      {bounds && bounds.maxCents > 0 && (
        <p className="pt-1.5 text-[11px] text-muted">{usd(bounds.minCents)} – {usd(bounds.maxCents)} in this selection</p>
      )}
    </FilterGroup>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-line pb-4">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="focus-ring flex w-full items-center justify-between rounded text-[13px] font-semibold text-ink">
        {title} <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="mt-3 space-y-1.5">{children}</div>}
    </div>
  );
}

// Numbered pagination. The catalogue runs to ~200 pages, so the strip shows first,
// last, and a window around the current page rather than every number.
function Pagination({ page, pages, onGo }: { page: number; pages: number; onGo: (n: number) => void }) {
  const window: number[] = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) window.push(i);
  if (window[0] > 1) window.unshift(1);
  if (window[window.length - 1] < pages) window.push(pages);

  const btn = "focus-ring grid h-9 min-w-9 place-items-center rounded-full px-3 text-[13px] font-medium transition";
  return (
    <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
      <button onClick={() => onGo(page - 1)} disabled={page <= 1} className={`${btn} border border-line text-ink disabled:opacity-35`}>Prev</button>
      {window.map((n, i) => (
        <span key={n} className="flex items-center gap-1.5">
          {i > 0 && n - window[i - 1] > 1 && <span className="px-1 text-muted">…</span>}
          <button onClick={() => onGo(n)} aria-current={n === page ? "page" : undefined}
            className={`${btn} ${n === page ? "bg-plum text-white" : "border border-line text-ink hover:border-ink"}`}>{n}</button>
        </span>
      ))}
      <button onClick={() => onGo(page + 1)} disabled={page >= pages} className={`${btn} border border-line text-ink disabled:opacity-35`}>Next</button>
    </nav>
  );
}
