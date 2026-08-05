import { useState } from "react";
import { adminApi, type AdminProductFull, type AdminVariant, type AdminImage, type AdminCategory, type AdminBrand } from "./adminApi";
import { Spinner, PlusIcon, TrashIcon, CloseIcon } from "../components/ui";
import { Combobox, type Option } from "./primitives/Combobox";
import { PRODUCT_STATUSES } from "./primitives/StatusBadge";
import { useToast } from "./primitives/Toast";
import type { Glyph } from "../lib/api";

const GLYPHS: Glyph[] = ["bottle", "dropper", "jar", "tube", "lipstick", "compact", "mist"];

export function ProductEditor({ product, cats, brands, onClose, onSaved }: {
  product: AdminProductFull | "new";
  cats: AdminCategory[];
  brands: AdminBrand[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = product === "new";
  const p = isNew ? null : product;
  const { push } = useToast();
  const [f, setF] = useState({
    name: p?.name ?? "", slug: p?.slug ?? "", sku: p?.sku ?? "", status: p?.status ?? "active",
    price: p ? (p.priceCents / 100).toString() : "", sale: p?.saleCents ? (p.saleCents / 100).toString() : "",
    categoryId: p?.categoryId ? String(p.categoryId) : "", brandId: p?.brandId ? String(p.brandId) : "",
    glyph: (p?.glyph ?? "bottle") as Glyph, tint: p?.tint ?? "#f5e9f0",
    isBestSeller: p?.isBestSeller ?? false, isNewMode: p?.isNewMode ?? "auto",
    audience: p?.audience ?? "unisex",
    concerns: p?.concerns ?? "", attributes: p?.attributes ?? "",
    shortDesc: p?.shortDesc ?? "", description: p?.description ?? "", howToUse: p?.howToUse ?? "", ingredients: p?.ingredients ?? "", videoUrl: p?.videoUrl ?? "",
  });
  const [variants, setVariants] = useState<AdminVariant[]>(p?.variants ?? []);
  const [images, setImages] = useState<AdminImage[]>(p?.images ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);

  const set = (k: keyof typeof f, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));

  // two-level list so a department and its children read as a hierarchy
  const catOptions: Option[] = [{ value: "", label: "Select…" }];
  for (const t of cats.filter((c) => c.parentId === null).sort((a, b) => a.sortOrder - b.sortOrder)) {
    catOptions.push({ value: String(t.id), label: t.name });
    for (const c of cats.filter((x) => x.parentId === t.id).sort((a, b) => a.sortOrder - b.sortOrder)) {
      catOptions.push({ value: String(c.id), label: c.name, depth: 1 });
    }
  }
  const brandOptions: Option[] = [
    { value: "", label: "No brand" },
    ...[...brands].sort((a, b) => a.name.localeCompare(b.name)).map((b) => ({ value: String(b.id), label: b.name })),
  ];

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
        const { url } = await adminApi.upload(data);
        setImages((prev) => [...prev, { url, alt: "" }]);
      }
    } catch (e) {
      push("error", `Upload failed: ${(e as Error).message}`);
    } finally { setUploading(false); }
  };

  const save = async () => {
    setErr("");
    if (!f.name.trim() || !f.categoryId) { setErr("Name and category are required."); return; }
    setBusy(true);
    const body = { ...f, categoryId: Number(f.categoryId), brandId: f.brandId ? Number(f.brandId) : null, variants, images };
    try {
      if (isNew) await adminApi.createProduct(body); else await adminApi.updateProduct(p!.id, body);
      push("ok", isNew ? "Product created" : "Changes saved");
      onSaved();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onClose} className="focus-ring text-[13px] font-semibold text-plum hover:underline">← Products</button>
          <h1 className="serif mt-1 text-2xl font-medium text-ink">{isNew ? "New product" : `Edit: ${p!.name}`}</h1>
        </div>
        <button onClick={onClose} aria-label="Close editor" className="focus-ring grid h-9 w-9 place-items-center rounded-full hover:bg-soft"><CloseIcon /></button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <Section title="Basics">
            <Field label="Name"><input value={f.name} onChange={(e) => set("name", e.target.value)} className="field focus-ring" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category"><Combobox value={f.categoryId} onChange={(v) => set("categoryId", v)} options={catOptions} ariaLabel="Category" searchable searchPlaceholder="Search categories…" buttonClassName="py-2.5" /></Field>
              <Field label="Brand"><Combobox value={f.brandId} onChange={(v) => set("brandId", v)} options={brandOptions} ariaLabel="Brand" searchable searchPlaceholder="Search 400+ brands…" buttonClassName="py-2.5" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (USD)"><input value={f.price} onChange={(e) => set("price", e.target.value)} inputMode="decimal" className="field focus-ring num-tabular" /></Field>
              <Field label="Sale price (optional)"><input value={f.sale} onChange={(e) => set("sale", e.target.value)} inputMode="decimal" placeholder="—" className="field focus-ring num-tabular" /></Field>
            </div>
            <Field label="Supplier SKU (internal — never shown to customers)"><input value={f.sku} onChange={(e) => set("sku", e.target.value)} placeholder="e.g. 4000NAC4947" className="field focus-ring font-mono text-[13px]" /></Field>
            <Field label="Short description"><input value={f.shortDesc} onChange={(e) => set("shortDesc", e.target.value)} className="field focus-ring" /></Field>
            <Field label="Description"><textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={4} className="field focus-ring resize-none" /></Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="How to use"><textarea value={f.howToUse} onChange={(e) => set("howToUse", e.target.value)} rows={3} className="field focus-ring resize-none" /></Field>
              <Field label="Ingredients"><textarea value={f.ingredients} onChange={(e) => set("ingredients", e.target.value)} rows={3} className="field focus-ring resize-none" /></Field>
            </div>
          </Section>

          <Section title="Variants (shades / sizes)">
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2">
                  <Combobox value={v.type} onChange={(val) => setVariants((a) => a.map((x, j) => j === i ? { ...x, type: val } : x))}
                    options={[{ value: "shade", label: "Shade" }, { value: "size", label: "Size" }]} ariaLabel={`Variant ${i + 1} type`} className="w-24" />
                  {/* the shade's own photo — doubles as the storefront swatch when no hex is set */}
                  {v.imageUrl && <img src={v.imageUrl} alt="" title="Shade photo" className="h-9 w-9 shrink-0 rounded-full border border-line object-cover" />}
                  <input value={v.label} onChange={(e) => setVariants((a) => a.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Label" aria-label={`Variant ${i + 1} label`} className="field focus-ring min-w-[7rem] flex-1 py-2" />
                  <input value={v.sku ?? ""} onChange={(e) => setVariants((a) => a.map((x, j) => j === i ? { ...x, sku: e.target.value } : x))} placeholder="SKU" aria-label={`Variant ${i + 1} SKU`} className="field focus-ring w-28 py-2 font-mono text-[12px]" />
                  {v.type === "shade" && (
                    <input type="color" value={v.hex || "#cccccc"} aria-label={`Variant ${i + 1} swatch colour`}
                      title={v.hex ? "Swatch colour" : "No colour set — the shade photo is used as the swatch"}
                      onChange={(e) => setVariants((a) => a.map((x, j) => j === i ? { ...x, hex: e.target.value } : x))}
                      className={`focus-ring h-9 w-10 rounded border ${v.hex ? "border-line" : "border-dashed border-muted-strong"}`} />
                  )}
                  <input value={v.priceCents != null ? (v.priceCents / 100).toString() : ""} onChange={(e) => setVariants((a) => a.map((x, j) => j === i ? { ...x, priceCents: e.target.value ? Math.round(Number(e.target.value) * 100) : null } : x))} placeholder="$ override" aria-label={`Variant ${i + 1} price override`} className="field focus-ring num-tabular w-24 py-2" />
                  <label className="flex items-center gap-1.5 text-[12px] text-ink/80">
                    <input type="checkbox" checked={v.available} onChange={(e) => setVariants((a) => a.map((x, j) => j === i ? { ...x, available: e.target.checked } : x))} className="focus-ring accent-plum" />
                    Available
                  </label>
                  <button onClick={() => setVariants((a) => a.filter((_, j) => j !== i))} aria-label={`Remove variant ${i + 1}`} className="focus-ring grid h-8 w-8 place-items-center rounded-md text-muted-strong hover:text-sale"><TrashIcon className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={() => setVariants((a) => [...a, { type: "shade", label: "", sku: "", hex: "#c98d7a", imageUrl: "", priceCents: null, available: true }])} className="btn btn-ghost focus-ring mt-2 px-4 py-2 text-[12px]"><PlusIcon className="h-4 w-4" /> Add variant</button>
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Status & flags">
            <Field label="Status">
              <Combobox value={f.status} onChange={(v) => set("status", v)} ariaLabel="Product status"
                options={PRODUCT_STATUSES.map((s) => ({ value: s.value, label: s.label }))} buttonClassName="py-2.5" />
              <span className="mt-1 block text-[11px] text-muted-strong">
                {PRODUCT_STATUSES.find((s) => s.value === f.status)?.help}
              </span>
            </Field>
            {/* Was "Mark as best seller" — a claim about customers, set by hand. It has only ever
                meant "the owner chose this", which is what Our Picks is. The column keeps its
                old name (renaming it would be a destructive migration); the words people read
                do not. */}
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.isBestSeller} onChange={(e) => set("isBestSeller", e.target.checked)} className="focus-ring accent-plum" /> Show in Our Picks</label>
            <Field label="New badge"><Combobox value={f.isNewMode} onChange={(v) => set("isNewMode", v)} ariaLabel="New badge behaviour" buttonClassName="py-2.5"
              options={[{ value: "auto", label: "Auto (recent)" }, { value: "always", label: "Always show New" }, { value: "never", label: "Never" }]} /></Field>
            {/* Drives the "For him / For her" filter in the shop sidebar and the department
                dropdowns. Unisex is the default and is the right answer for most of the
                catalogue — only mark a product when the packaging or the product itself is
                clearly for one. */}
            <Field label="Shop for">
              <Combobox value={f.audience} onChange={(v) => set("audience", v)} ariaLabel="Audience" buttonClassName="py-2.5"
                options={[{ value: "unisex", label: "Anyone (shown in both)" }, { value: "women", label: "Women" }, { value: "men", label: "Men" }]} />
              <span className="mt-1 block text-[11px] text-muted-strong">
                {p?.audienceLocked
                  ? "Set by hand — the classifier won’t change it."
                  : "Changing this pins the value so the classifier won’t overwrite it."}
              </span>
            </Field>
            {/* Free text because there is no fixed vocabulary yet: the storefront builds its
                filter list from whatever is actually in use, so a typo becomes a filter of one.
                Keep to lowercase words already in the list until that list is agreed. */}
            <Field label="Concerns (comma-separated)"><input value={f.concerns} onChange={(e) => set("concerns", e.target.value)} placeholder="hydration, brightening" className="field focus-ring" /></Field>
            <Field label="Attributes (comma-separated)"><input value={f.attributes} onChange={(e) => set("attributes", e.target.value)} placeholder="vegan, clean" className="field focus-ring" /></Field>
          </Section>

          <Section title="Images">
            <div className="grid grid-cols-3 gap-2">
              {images.map((im, i) => (
                <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-line">
                  <img src={im.url} alt="" className="h-full w-full object-cover" />
                  <button onClick={() => setImages((a) => a.filter((_, j) => j !== i))} aria-label={`Remove image ${i + 1}`} className="focus-ring absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-ink/70 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"><CloseIcon className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              <label className="focus-ring grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed border-line-strong text-muted-strong hover:border-plum hover:text-plum">
                {uploading ? <Spinner className="h-5 w-5" /> : <PlusIcon />}
                <span className="sr-only">Upload images</span>
                <input type="file" accept="image/*" multiple onChange={(e) => upload(e.target.files)} className="hidden" />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-muted-strong">No photo? A line silhouette is shown instead.</p>
          </Section>

          <Section title="Fallback look">
            <Field label="Silhouette"><Combobox value={f.glyph} onChange={(v) => set("glyph", v as Glyph)} ariaLabel="Fallback silhouette" buttonClassName="py-2.5"
              options={GLYPHS.map((g) => ({ value: g, label: g }))} /></Field>
            <Field label="Image-bed colour"><input type="color" value={f.tint} onChange={(e) => set("tint", e.target.value)} aria-label="Image bed colour" className="focus-ring h-10 w-full rounded border border-line" /></Field>
            <Field label="Product video URL (optional)"><input value={f.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} placeholder="/uploads/… or https://" className="field focus-ring" /></Field>
          </Section>
        </div>
      </div>

      {err && <p role="alert" className="mt-4 rounded-lg bg-sale/10 px-3 py-2 text-[13px] text-sale">{err}</p>}
      <div className="sticky bottom-0 mt-6 flex gap-3 border-t border-line bg-soft/85 py-4 backdrop-blur">
        <button onClick={save} disabled={busy} className="btn btn-ink focus-ring px-8 py-3">{busy ? "Saving…" : isNew ? "Create product" : "Save changes"}</button>
        <button onClick={onClose} className="btn btn-ghost focus-ring px-6 py-3">Cancel</button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted-strong">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink/70">{label}</span>{children}</label>;
}
