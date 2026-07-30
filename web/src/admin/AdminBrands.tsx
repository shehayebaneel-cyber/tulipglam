import { useEffect, useMemo, useState } from "react";
import { adminApi, type AdminBrand } from "./adminApi";
import { PlusIcon, TrashIcon, SearchIcon } from "../components/ui";
import { Modal, L } from "./AdminCategories";
import { DataTable, type Column } from "./primitives/DataTable";
import { Combobox, type Option } from "./primitives/Combobox";
import { ConfirmDialog } from "./primitives/ConfirmDialog";
import { FilterBar, FilterChips, type Chip } from "./primitives/FilterBar";
import { useToast } from "./primitives/Toast";
import { useDebounced } from "./primitives/hooks";

const blank = { id: 0, slug: "", name: "", blurb: "", featured: false, sortOrder: 0, active: true, audience: "", _count: { products: 0 } };

/**
 * Brand-level default audience. A stated fact about the brand, so the classifier ranks it
 * above its own measured skew — 404 brands is a much smaller job than 9,533 products, and
 * getting one brand right settles every row under it. It is never written onto products:
 * a per-product audience set by hand still wins.
 */
const AUDIENCES: Option[] = [
  { value: "", label: "Not set" },
  { value: "unisex", label: "Anyone (unisex)" },
  { value: "women", label: "Women" },
  { value: "men", label: "Men" },
];
const AUDIENCE_LABEL: Record<string, string> = { unisex: "Unisex", women: "Women", men: "Men" };

const FEATURED: Option[] = [{ value: "", label: "All brands" }, { value: "1", label: "Featured" }, { value: "0", label: "Not featured" }];
const ACTIVE: Option[] = [{ value: "", label: "Any state" }, { value: "1", label: "Active" }, { value: "0", label: "Hidden" }];

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function AdminBrands() {
  const [rows, setRows] = useState<AdminBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [edit, setEdit] = useState<AdminBrand | null>(null);
  const [confirming, setConfirming] = useState<AdminBrand | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { push } = useToast();

  // Filtering is client-side here, unlike products: 405 brands is one small payload the page
  // already holds, so a round trip per keystroke would be slower and no more correct.
  const [qInput, setQInput] = useState("");
  const q = useDebounced(qInput, 200).trim().toLowerCase();
  const [featured, setFeatured] = useState("");
  const [active, setActive] = useState("");
  const [audience, setAudience] = useState("");
  const [sort, setSort] = useState("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  const load = () => {
    setLoading(true);
    setLoadError("");
    adminApi.brands()
      .then((r) => setRows(r.brands))
      .catch((e: Error) => setLoadError(e.message || "Request failed."))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const visible = useMemo(() => {
    const out = rows.filter((b) => {
      if (q && !b.name.toLowerCase().includes(q) && !b.slug.toLowerCase().includes(q)) return false;
      if (featured && String(Number(b.featured)) !== featured) return false;
      if (active && String(Number(b.active)) !== active) return false;
      if (audience === "none" ? b.audience !== "" : audience && b.audience !== audience) return false;
      return true;
    });
    const sign = dir === "asc" ? 1 : -1;
    out.sort((a, b) =>
      sort === "products" ? sign * (a._count.products - b._count.products) || collator.compare(a.name, b.name)
      : sign * collator.compare(a.name, b.name));
    return out;
  }, [rows, q, featured, active, audience, sort, dir]);

  const isFiltered = !!(q || featured || active || audience);
  const clearAll = () => { setQInput(""); setFeatured(""); setActive(""); setAudience(""); };

  const chips: Chip[] = [];
  if (q) chips.push({ key: "q", label: "Search", value: qInput, onClear: () => setQInput("") });
  if (featured) chips.push({ key: "featured", label: "Featured", value: featured === "1" ? "Yes" : "No", onClear: () => setFeatured("") });
  if (active) chips.push({ key: "active", label: "State", value: active === "1" ? "Active" : "Hidden", onClear: () => setActive("") });
  if (audience) chips.push({ key: "audience", label: "Shop for", value: audience === "none" ? "Not set" : AUDIENCE_LABEL[audience] ?? audience, onClear: () => setAudience("") });

  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { setErr("A name is required."); return; }
    setErr("");
    setBusy(true);
    try {
      if (edit.id) await adminApi.updateBrand(edit.id, edit); else await adminApi.createBrand(edit);
      push("ok", edit.id ? `${edit.name} saved` : `${edit.name} created`);
      setEdit(null);
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirming) return;
    setBusy(true);
    try {
      await adminApi.deleteBrand(confirming.id);
      push("ok", `${confirming.name} deleted`);
      setConfirming(null);
      load();
    } catch (e) { push("error", (e as Error).message); }
    finally { setBusy(false); }
  };

  const columns: Column<AdminBrand>[] = [
    {
      key: "name",
      header: "Brand",
      sortKey: "name",
      cell: (b) => (
        <div className="min-w-0">
          <button type="button" onClick={() => { setErr(""); setEdit(b); }} title={b.name}
            className="focus-ring block max-w-full cell-truncate text-left font-semibold text-ink hover:text-plum">
            {b.name}
          </button>
          {b.blurb && <p className="cell-truncate text-[11px] text-muted-strong">{b.blurb}</p>}
        </div>
      ),
    },
    {
      key: "products",
      header: "Products",
      sortKey: "products",
      align: "right",
      cellClass: "w-24",
      cell: (b) => <span className="num-tabular text-ink/80">{b._count.products}</span>,
    },
    {
      key: "audience",
      header: "Shop for",
      hideBelow: "md",
      cellClass: "w-28",
      cell: (b) => b.audience
        ? <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-ink/80">{AUDIENCE_LABEL[b.audience] ?? b.audience}</span>
        : <span className="text-muted-strong">—</span>,
    },
    {
      key: "state",
      header: "State",
      cellClass: "w-32",
      cell: (b) => (
        <span className="flex flex-wrap gap-1">
          {b.featured && <span className="rounded-full bg-plum-soft px-2 py-0.5 text-[11px] font-semibold text-plum">Featured</span>}
          {!b.active && <span className="rounded-full bg-soft px-2 py-0.5 text-[11px] font-semibold text-muted-strong">Hidden</span>}
          {!b.featured && b.active && <span className="text-muted-strong">—</span>}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cellClass: "w-24",
      cell: (b) => (
        <span className="whitespace-nowrap">
          <button onClick={() => { setErr(""); setEdit(b); }} className="focus-ring rounded-md px-2 py-1 text-[12px] font-semibold text-plum hover:bg-plum-soft">Edit</button>
          <button onClick={() => setConfirming(b)} aria-label={`Delete ${b.name}`}
            className="focus-ring ml-1 h-7 w-7 rounded-md text-muted-strong hover:text-sale"><TrashIcon className="mx-auto h-4 w-4" /></button>
        </span>
      ),
    },
  ];

  const withAudience = rows.filter((b) => b.audience).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Brands</h1>
          <p className="mt-1 text-sm text-muted">
            {loading ? "…" : isFiltered ? `${visible.length} of ${rows.length} brands` : `${rows.length} brands`}
            {!loading && rows.length > 0 && ` · ${withAudience} with a default audience`}
          </p>
        </div>
        <button onClick={() => { setErr(""); setEdit(blank as AdminBrand); }} className="btn btn-ink px-5 py-2.5"><PlusIcon className="h-4 w-4" /> New</button>
      </div>

      {/* 405 brands in one unsearchable table was a scroll to the bottom to find anything. */}
      <div className="mt-5">
        <FilterBar>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-strong" />
            <input value={qInput} onChange={(e) => setQInput(e.target.value)} type="search" placeholder="Search brands…" aria-label="Search brands"
              className="field focus-ring w-[14rem] py-2 pl-9 text-[13px]" />
          </div>
          <Combobox value={featured} onChange={setFeatured} ariaLabel="Filter by featured" className="w-[10rem]" options={FEATURED} />
          <Combobox value={active} onChange={setActive} ariaLabel="Filter by state" className="w-[9rem]" options={ACTIVE} />
          <Combobox value={audience} onChange={setAudience} ariaLabel="Filter by default audience" className="w-[10rem]"
            options={[{ value: "", label: "Any audience" }, ...AUDIENCES.slice(1), { value: "none", label: "Not set" }]} />
        </FilterBar>
        <FilterChips chips={chips} onClearAll={clearAll} />
      </div>

      <div className="mt-4">
        <DataTable
          caption="Brands"
          columns={columns}
          rows={visible}
          rowKey={(b) => b.id}
          loading={loading}
          error={loadError}
          onRetry={load}
          emptyTitle="No brands yet"
          emptyBody="Brands arrive with an import, or add one by hand."
          noResultsTitle="No brands match"
          isFiltered={isFiltered}
          onClearFilters={clearAll}
          sort={sort}
          dir={dir}
          onSort={(k, d) => { setSort(k); setDir(d); }}
        />
      </div>

      {edit && (
        <Modal title={edit.id ? "Edit brand" : "New brand"} onClose={() => setEdit(null)}>
          <L label="Name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="field focus-ring" /></L>
          <L label="Slug (optional)"><input value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} placeholder="auto from name" className="field focus-ring" /></L>
          <L label="Blurb"><input value={edit.blurb} onChange={(e) => setEdit({ ...edit, blurb: e.target.value })} className="field focus-ring" /></L>
          <L label="Shop for (brand default)">
            <Combobox value={edit.audience ?? ""} onChange={(v) => setEdit({ ...edit, audience: v })} ariaLabel="Default audience for this brand"
              options={AUDIENCES} buttonClassName="py-2.5" />
            <span className="mt-1 block text-[11px] text-muted-strong">
              Used when classifying this brand’s products. It doesn’t change any product on its own,
              and a product set by hand always wins.
            </span>
          </L>
          <div className="grid grid-cols-2 gap-3">
            <L label="Sort order"><input type="number" value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} className="field focus-ring num-tabular" /></L>
            <div className="flex flex-col justify-end gap-1 pb-1">
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={edit.featured} onChange={(e) => setEdit({ ...edit, featured: e.target.checked })} className="focus-ring accent-plum" /> Featured</label>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="focus-ring accent-plum" /> Active</label>
            </div>
          </div>
          {err && <p className="text-[12px] text-sale">{err}</p>}
          <div className="flex gap-2 pt-2">
            <button onClick={save} disabled={busy} className="btn btn-ink flex-1 py-3 disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
            <button onClick={() => setEdit(null)} className="btn btn-ghost px-5 py-3">Cancel</button>
          </div>
        </Modal>
      )}

      {/* Was a native confirm(), which can't say what is actually at stake. */}
      {confirming && (
        <ConfirmDialog
          title={`Delete “${confirming.name}”?`}
          confirmLabel="Delete brand"
          destructive
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirming(null)}
        >
          <p>
            {confirming._count.products > 0
              ? <>Its <strong>{confirming._count.products}</strong> product{confirming._count.products === 1 ? "" : "s"} stay in the catalogue but lose their brand, so they’ll show with no brand name until one is set.</>
              : <>It has no products, so nothing else changes.</>}
          </p>
          <p className="mt-2">
            To take a brand off the storefront without touching its products, untick <strong>Active</strong> instead.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
