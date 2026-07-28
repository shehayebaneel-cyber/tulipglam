import { useMemo, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { api, type Card } from "../lib/api";
import { useStore } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { ProductCard } from "../components/ProductCard";
import { FilterIcon, CloseIcon, ChevronDown, Spinner, ChevronRight } from "../components/ui";

type Mode = "all" | "category" | "new" | "bestsellers" | "sale" | "search";

const ATTRIBUTES = ["vegan", "clean", "cruelty-free", "refillable", "mini"];
const CONCERNS = ["hydration", "brightening", "anti-aging", "acne", "pores", "sensitivity", "protection", "frizz", "damage"];
const SORTS = [
  ["featured", "Featured"], ["newest", "Newest"], ["price-asc", "Price: low to high"],
  ["price-desc", "Price: high to low"], ["name", "Name A–Z"],
] as const;

const titleFor: Record<Mode, string> = {
  all: "All products", category: "", new: "New arrivals", bestsellers: "Best sellers", sale: "On sale", search: "Search",
};

export function Shop({ mode }: { mode: Mode }) {
  const { slug } = useParams();
  const { site } = useStore();
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState(false);

  const brand = params.get("brand") ?? "";
  const sort = params.get("sort") ?? "featured";
  const q = params.get("q") ?? "";
  const attrs = (params.get("attributes") ?? "").split(",").filter(Boolean);
  const concerns = (params.get("concerns") ?? "").split(",").filter(Boolean);
  const catParam = mode === "category" ? slug : params.get("category") ?? "";

  const query = useMemo(() => ({
    category: catParam || undefined,
    brand: brand || undefined,
    sort,
    q: mode === "search" ? q : undefined,
    new: mode === "new" ? "1" : undefined,
    best: mode === "bestsellers" ? "1" : undefined,
    sale: mode === "sale" ? "1" : undefined,
    attributes: attrs.join(",") || undefined,
    concerns: concerns.join(",") || undefined,
  }), [catParam, brand, sort, q, mode, attrs.join(","), concerns.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, loading } = useFetch(() => api.products(query), [JSON.stringify(query)]);
  const products = data?.products ?? [];

  const cat = site?.categories.find((c) => c.slug === catParam);
  const heading = mode === "category" ? cat?.name ?? "Category" : mode === "search" ? (q ? `Results for “${q}”` : "Search") : titleFor[mode];
  const sub = mode === "category" ? cat?.blurb : undefined;

  const setP = (key: string, val: string) => {
    const next = new URLSearchParams(params);
    if (val) next.set(key, val); else next.delete(key);
    setParams(next, { replace: true });
  };
  const toggleMulti = (key: string, arr: string[], val: string) => {
    const set = new Set(arr);
    set.has(val) ? set.delete(val) : set.add(val);
    setP(key, [...set].join(","));
  };
  const activeCount = (brand ? 1 : 0) + attrs.length + concerns.length + (mode !== "category" && catParam ? 1 : 0);
  const clearAll = () => { const n = new URLSearchParams(); if (sort !== "featured") n.set("sort", sort); if (mode === "search" && q) n.set("q", q); setParams(n, { replace: true }); };

  const Filters = () => (
    <div className="space-y-6">
      {mode !== "category" && !!site?.categories.length && (
        <FilterGroup title="Category">
          <label className="filter-row"><input type="radio" checked={!catParam} onChange={() => setP("category", "")} className="accent-plum" /> All categories</label>
          {site.categories.map((c) => (
            <label key={c.slug} className="filter-row"><input type="radio" checked={catParam === c.slug} onChange={() => setP("category", c.slug)} className="accent-plum" /> {c.name}</label>
          ))}
        </FilterGroup>
      )}
      {!!site?.brands.length && (
        <FilterGroup title="Brand">
          <label className="filter-row"><input type="radio" checked={!brand} onChange={() => setP("brand", "")} className="accent-plum" /> All brands</label>
          {site.brands.map((b) => (
            <label key={b.slug} className="filter-row"><input type="radio" checked={brand === b.slug} onChange={() => setP("brand", b.slug)} className="accent-plum" /> {b.name}</label>
          ))}
        </FilterGroup>
      )}
      <FilterGroup title="Good for">
        {CONCERNS.map((c) => (
          <label key={c} className="filter-row capitalize"><input type="checkbox" checked={concerns.includes(c)} onChange={() => toggleMulti("concerns", concerns, c)} className="accent-plum" /> {c.replace("-", " ")}</label>
        ))}
      </FilterGroup>
      <FilterGroup title="Attributes">
        {ATTRIBUTES.map((a) => (
          <label key={a} className="filter-row capitalize"><input type="checkbox" checked={attrs.includes(a)} onChange={() => toggleMulti("attributes", attrs, a)} className="accent-plum" /> {a.replace("-", " ")}</label>
        ))}
      </FilterGroup>
    </div>
  );

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
          <span className="hidden text-[13px] text-muted sm:inline">{loading ? "…" : `${products.length} item${products.length === 1 ? "" : "s"}`}</span>
          <div className="relative">
            <select value={sort} onChange={(e) => setP("sort", e.target.value)} className="appearance-none rounded-full border border-line bg-surface py-2 pl-4 pr-9 text-[13px] font-medium text-ink outline-none focus:border-ink">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          </div>
          <button onClick={() => setSheet(true)} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-medium lg:hidden">
            <FilterIcon className="h-4 w-4" /> Filters{activeCount ? ` · ${activeCount}` : ""}
          </button>
        </div>
      </div>

      <div className="mt-6 flex gap-8">
        {/* desktop sidebar */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Filters</h2>
            {activeCount > 0 && <button onClick={clearAll} className="text-[12px] font-semibold text-plum hover:underline">Clear</button>}
          </div>
          <div className="mt-4"><Filters /></div>
        </aside>

        {/* grid */}
        <div className="min-w-0 flex-1">
          {loading ? (
            <div className="grid place-items-center py-24 text-plum"><Spinner /></div>
          ) : products.length === 0 ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong py-20 text-center">
              <div>
                <p className="serif text-2xl text-ink">Nothing here yet</p>
                <p className="mx-auto mt-2 max-w-xs text-sm text-muted">No products match these filters. Try clearing a few.</p>
                {activeCount > 0 && <button onClick={clearAll} className="btn btn-ghost mt-5 px-6 py-2.5">Clear filters</button>}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-3.5 gap-y-8 sm:grid-cols-3 sm:gap-5 xl:grid-cols-4">
              {products.map((p: Card) => <ProductCard key={p.id} p={p} />)}
            </div>
          )}
        </div>
      </div>

      {/* mobile filter sheet */}
      {sheet && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-paper p-5 pb-8 shadow-pop">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="serif text-xl text-ink">Filters</h2>
              <button onClick={() => setSheet(false)} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-soft"><CloseIcon /></button>
            </div>
            <Filters />
            <div className="mt-6 flex gap-3">
              {activeCount > 0 && <button onClick={clearAll} className="btn btn-ghost flex-1 py-3">Clear</button>}
              <button onClick={() => setSheet(false)} className="btn btn-ink flex-1 py-3">Show {products.length} items</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-line pb-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-[13px] font-semibold text-ink">
        {title} <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="mt-3 space-y-1.5">{children}</div>}
    </div>
  );
}
