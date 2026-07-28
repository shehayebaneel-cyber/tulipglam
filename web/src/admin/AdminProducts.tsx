import { useEffect, useState } from "react";
import { adminApi, type AdminProduct, type AdminProductFull, type AdminVariant, type AdminImage, type AdminCategory, type AdminBrand } from "./adminApi";
import { usd } from "../lib/api";
import { ProductGlyph } from "../components/ProductGlyph";
import { Spinner, PlusIcon, TrashIcon, CloseIcon, ChevronDown } from "../components/ui";
import type { Glyph } from "../lib/api";

const GLYPHS: Glyph[] = ["bottle", "dropper", "jar", "tube", "lipstick", "compact", "mist"];
const STATUSES = [["active", "Active"], ["hidden", "Hidden"], ["unavailable", "Temporarily unavailable"], ["discontinued", "Discontinued"]] as const;

export function AdminProducts() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [cats, setCats] = useState<AdminCategory[]>([]);
  const [brands, setBrands] = useState<AdminBrand[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminProductFull | "new" | null>(null);

  const load = () => {
    setLoading(true);
    adminApi.products(q, status).then((r) => setProducts(r.products)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [q, status]);
  useEffect(() => { adminApi.categories().then((r) => setCats(r.categories)); adminApi.brands().then((r) => setBrands(r.brands)); }, []);

  const openEdit = async (id: number) => setEditing(await adminApi.product(id));
  const remove = async (p: AdminProduct) => { if (confirm(`Delete “${p.name}”? This cannot be undone.`)) { await adminApi.deleteProduct(p.id); load(); } };
  const quickStatus = async (p: AdminProduct, s: string) => { await adminApi.setStatus(p.id, s); load(); };

  if (editing) return <ProductEditor product={editing} cats={cats} brands={brands} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Products</h1>
          <p className="mt-1 text-sm text-muted">{products.length} shown</p>
        </div>
        <button onClick={() => setEditing("new")} className="btn btn-ink px-5 py-2.5"><PlusIcon className="h-4 w-4" /> New product</button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" className="field max-w-xs" />
        <div className="relative">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="field appearance-none pr-9">
            <option value="">All statuses</option>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        </div>
      </div>

      {loading ? (
        <div className="grid place-items-center py-20 text-plum"><Spinner /></div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-soft/50 text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="px-4 py-3">Product</th><th className="hidden px-4 py-3 sm:table-cell">Category</th><th className="px-4 py-3">Price</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-soft/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="grid h-11 w-10 shrink-0 place-items-center overflow-hidden rounded-lg" style={{ background: p.tint }}>
                        {p.images[0]?.url ? <img src={p.images[0].url} alt="" className="h-full w-full object-cover" /> : <ProductGlyph kind={p.glyph as Glyph} className="h-full w-full p-1.5 text-plum/45" />}
                      </span>
                      <div>
                        <button onClick={() => openEdit(p.id)} className="font-semibold text-ink hover:text-plum">{p.name}</button>
                        <p className="text-[11px] text-muted">{p.brand?.name ?? "—"}{p._count.variants ? ` · ${p._count.variants} variant${p._count.variants === 1 ? "" : "s"}` : ""}{p.isBestSeller ? " · ★ Bestseller" : ""}</p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-muted sm:table-cell">{p.category.name}</td>
                  <td className="px-4 py-3 tabular">{p.saleCents ? <span><span className="text-sale">{usd(p.saleCents)}</span> <span className="text-muted line-through">{usd(p.priceCents)}</span></span> : usd(p.priceCents)}</td>
                  <td className="px-4 py-3">
                    <select value={p.status} onChange={(e) => quickStatus(p, e.target.value)} className="rounded-md border border-line bg-paper px-1.5 py-1 text-[11px]">
                      {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(p.id)} className="rounded-md px-2 py-1 text-[12px] font-semibold text-plum hover:bg-plum-soft">Edit</button>
                      <button onClick={() => remove(p)} aria-label="Delete" className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-soft hover:text-sale"><TrashIcon className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {products.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">No products match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ editor
function ProductEditor({ product, cats, brands, onClose, onSaved }:
  { product: AdminProductFull | "new"; cats: AdminCategory[]; brands: AdminBrand[]; onClose: () => void; onSaved: () => void }) {
  const isNew = product === "new";
  const p = isNew ? null : product;
  const [f, setF] = useState({
    name: p?.name ?? "", slug: p?.slug ?? "", status: p?.status ?? "active",
    price: p ? (p.priceCents / 100).toString() : "", sale: p?.saleCents ? (p.saleCents / 100).toString() : "",
    categoryId: p?.categoryId?.toString() ?? "", brandId: p?.brandId?.toString() ?? "",
    glyph: (p?.glyph ?? "bottle") as Glyph, tint: p?.tint ?? "#f5e9f0",
    isBestSeller: p?.isBestSeller ?? false, isNewMode: p?.isNewMode ?? "auto",
    concerns: p?.concerns ?? "", attributes: p?.attributes ?? "",
    shortDesc: p?.shortDesc ?? "", description: p?.description ?? "", howToUse: p?.howToUse ?? "", ingredients: p?.ingredients ?? "", videoUrl: p?.videoUrl ?? "",
  });
  const [variants, setVariants] = useState<AdminVariant[]>(p?.variants ?? []);
  const [images, setImages] = useState<AdminImage[]>(p?.images ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);

  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
        const { url } = await adminApi.upload(data);
        setImages((prev) => [...prev, { url, alt: "" }]);
      }
    } finally { setUploading(false); }
  };

  const save = async () => {
    setErr("");
    if (!f.name.trim() || !f.categoryId) { setErr("Name and category are required."); return; }
    setBusy(true);
    const body = { ...f, categoryId: Number(f.categoryId), brandId: f.brandId ? Number(f.brandId) : null, variants, images };
    try {
      if (isNew) await adminApi.createProduct(body); else await adminApi.updateProduct(p!.id, body);
      onSaved();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onClose} className="text-[13px] font-semibold text-plum hover:underline">← Products</button>
          <h1 className="serif mt-1 text-2xl font-medium text-ink">{isNew ? "New product" : `Edit: ${p!.name}`}</h1>
        </div>
        <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-soft"><CloseIcon /></button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* main */}
        <div className="space-y-5">
          <Section title="Basics">
            <Field label="Name"><input value={f.name} onChange={(e) => set("name", e.target.value)} className="field" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category"><Select value={f.categoryId} onChange={(v) => set("categoryId", v)} options={[["", "Select…"], ...cats.map((c) => [String(c.id), c.name] as [string, string])]} /></Field>
              <Field label="Brand"><Select value={f.brandId} onChange={(v) => set("brandId", v)} options={[["", "None"], ...brands.map((b) => [String(b.id), b.name] as [string, string])]} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (USD)"><input value={f.price} onChange={(e) => set("price", e.target.value)} inputMode="decimal" className="field" /></Field>
              <Field label="Sale price (optional)"><input value={f.sale} onChange={(e) => set("sale", e.target.value)} inputMode="decimal" placeholder="—" className="field" /></Field>
            </div>
            <Field label="Short description"><input value={f.shortDesc} onChange={(e) => set("shortDesc", e.target.value)} className="field" /></Field>
            <Field label="Description"><textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={4} className="field resize-none" /></Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="How to use"><textarea value={f.howToUse} onChange={(e) => set("howToUse", e.target.value)} rows={3} className="field resize-none" /></Field>
              <Field label="Ingredients"><textarea value={f.ingredients} onChange={(e) => set("ingredients", e.target.value)} rows={3} className="field resize-none" /></Field>
            </div>
          </Section>

          <Section title="Variants (shades / sizes)">
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
                  <Select value={v.type} onChange={(val) => setVariants((a) => a.map((x, j) => j === i ? { ...x, type: val } : x))} options={[["shade", "Shade"], ["size", "Size"]]} className="w-24" />
                  <input value={v.label} onChange={(e) => setVariants((a) => a.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Label" className="field flex-1 min-w-[7rem] py-2" />
                  {v.type === "shade" && <input type="color" value={v.hex || "#cccccc"} onChange={(e) => setVariants((a) => a.map((x, j) => j === i ? { ...x, hex: e.target.value } : x))} className="h-9 w-10 rounded border border-line" />}
                  <input value={v.priceCents != null ? (v.priceCents / 100).toString() : ""} onChange={(e) => setVariants((a) => a.map((x, j) => j === i ? { ...x, priceCents: e.target.value ? Math.round(Number(e.target.value) * 100) : null } : x))} placeholder="$ override" className="field w-24 py-2" />
                  <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={v.available} onChange={(e) => setVariants((a) => a.map((x, j) => j === i ? { ...x, available: e.target.checked } : x))} className="accent-plum" /> avail</label>
                  <button onClick={() => setVariants((a) => a.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:text-sale"><TrashIcon className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={() => setVariants((a) => [...a, { type: "shade", label: "", hex: "#c98d7a", priceCents: null, available: true }])} className="btn btn-ghost mt-2 px-4 py-2 text-[12px]"><PlusIcon className="h-4 w-4" /> Add variant</button>
          </Section>
        </div>

        {/* sidebar */}
        <div className="space-y-5">
          <Section title="Status & flags">
            <Field label="Status"><Select value={f.status} onChange={(v) => set("status", v)} options={STATUSES.map(([v, l]) => [v, l] as [string, string])} /></Field>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.isBestSeller} onChange={(e) => set("isBestSeller", e.target.checked)} className="accent-plum" /> Mark as best seller</label>
            <Field label="New badge"><Select value={f.isNewMode} onChange={(v) => set("isNewMode", v)} options={[["auto", "Auto (recent)"], ["always", "Always show New"], ["never", "Never"]]} /></Field>
            <Field label="Concerns (comma-separated)"><input value={f.concerns} onChange={(e) => set("concerns", e.target.value)} placeholder="hydration, brightening" className="field" /></Field>
            <Field label="Attributes (comma-separated)"><input value={f.attributes} onChange={(e) => set("attributes", e.target.value)} placeholder="vegan, clean" className="field" /></Field>
          </Section>

          <Section title="Images">
            <div className="grid grid-cols-3 gap-2">
              {images.map((im, i) => (
                <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-line">
                  <img src={im.url} alt="" className="h-full w-full object-cover" />
                  <button onClick={() => setImages((a) => a.filter((_, j) => j !== i))} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-ink/70 text-white opacity-0 group-hover:opacity-100"><CloseIcon className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <label className="grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed border-line-strong text-muted hover:border-plum hover:text-plum">
                {uploading ? <Spinner className="h-5 w-5" /> : <PlusIcon />}
                <input type="file" accept="image/*" multiple onChange={(e) => upload(e.target.files)} className="hidden" />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-muted">No photo? A line silhouette is shown instead.</p>
          </Section>

          <Section title="Fallback look">
            <Field label="Silhouette"><Select value={f.glyph} onChange={(v) => set("glyph", v as Glyph)} options={GLYPHS.map((g) => [g, g] as [string, string])} /></Field>
            <Field label="Image-bed colour"><input type="color" value={f.tint} onChange={(e) => set("tint", e.target.value)} className="h-10 w-full rounded border border-line" /></Field>
            <Field label="Product video URL (optional)"><input value={f.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} placeholder="/uploads/… or https://" className="field" /></Field>
          </Section>
        </div>
      </div>

      {err && <p className="mt-4 rounded-lg bg-sale/10 px-3 py-2 text-[13px] text-sale">{err}</p>}
      <div className="sticky bottom-0 mt-6 flex gap-3 border-t border-line bg-soft/80 py-4 backdrop-blur">
        <button onClick={save} disabled={busy} className="btn btn-ink px-8 py-3">{busy ? "Saving…" : isNew ? "Create product" : "Save changes"}</button>
        <button onClick={onClose} className="btn btn-ghost px-6 py-3">Cancel</button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink/70">{label}</span>{children}</label>;
}
function Select({ value, onChange, options, className = "" }: { value: string; onChange: (v: string) => void; options: [string, string][]; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field w-full appearance-none pr-9">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  );
}
