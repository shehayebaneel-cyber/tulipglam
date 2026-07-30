import { useEffect, useState } from "react";
import { adminApi, type AdminCategory } from "./adminApi";
import { ProductGlyph } from "../components/ProductGlyph";
import { Spinner, PlusIcon, TrashIcon, CloseIcon } from "../components/ui";
import { Combobox } from "./primitives/Combobox";
import type { Glyph } from "../lib/api";

const GLYPHS: Glyph[] = ["bottle", "dropper", "jar", "tube", "lipstick", "compact", "mist"];
const blank = { id: 0, slug: "", name: "", blurb: "", glyph: "jar", tint: "#f5e9f0", sortOrder: 0, active: true, parentId: null, _count: { products: 0 } };

export function AdminCategories() {
  const [rows, setRows] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<AdminCategory | null>(null);
  const [err, setErr] = useState("");

  const load = () => { setLoading(true); adminApi.categories().then((r) => setRows(r.categories)).finally(() => setLoading(false)); };
  useEffect(load, []);

  const save = async () => {
    if (!edit) return; setErr("");
    const body = { ...edit };
    try {
      if (edit.id) await adminApi.updateCategory(edit.id, body); else await adminApi.createCategory(body);
      setEdit(null); load();
    } catch (e) { setErr((e as Error).message); }
  };
  const remove = async (c: AdminCategory) => {
    if (!confirm(`Delete “${c.name}”?`)) return;
    try { await adminApi.deleteCategory(c.id); load(); } catch (e) { alert((e as Error).message); }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Categories</h1><p className="mt-1 text-sm text-muted">{rows.length} categories</p></div>
        <button onClick={() => { setErr(""); setEdit(blank as AdminCategory); }} className="btn btn-ink px-5 py-2.5"><PlusIcon className="h-4 w-4" /> New</button>
      </div>

      {loading ? <div className="grid place-items-center py-20 text-plum"><Spinner /></div> : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl" style={{ background: c.tint }}><ProductGlyph kind={c.glyph as Glyph} className="h-8 w-8 text-plum/50" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{c.name} {!c.active && <span className="text-[11px] text-muted">(hidden)</span>}</p>
                <p className="text-[11px] text-muted">{c._count.products} products · /{c.slug}</p>
              </div>
              <button onClick={() => { setErr(""); setEdit(c); }} className="rounded-md px-2 py-1 text-[12px] font-semibold text-plum hover:bg-plum-soft">Edit</button>
              <button onClick={() => remove(c)} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:text-sale"><TrashIcon className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <Modal title={edit.id ? "Edit category" : "New category"} onClose={() => setEdit(null)}>
          <L label="Name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="field" /></L>
          <L label="Slug (optional)"><input value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} placeholder="auto from name" className="field" /></L>
          <L label="Blurb"><input value={edit.blurb} onChange={(e) => setEdit({ ...edit, blurb: e.target.value })} className="field" /></L>
          <div className="grid grid-cols-2 gap-3">
            <L label="Icon"><Sel value={edit.glyph} onChange={(v) => setEdit({ ...edit, glyph: v })} options={GLYPHS.map((g) => [g, g] as [string, string])} /></L>
            <L label="Tint"><input type="color" value={edit.tint} onChange={(e) => setEdit({ ...edit, tint: e.target.value })} className="h-10 w-full rounded border border-line" /></L>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <L label="Sort order"><input type="number" value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} className="field" /></L>
            <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="accent-plum" /> Show on site</label>
          </div>
          {err && <p className="text-[12px] text-sale">{err}</p>}
          <div className="flex gap-2 pt-2"><button onClick={save} className="btn btn-ink flex-1 py-3">Save</button><button onClick={() => setEdit(null)} className="btn btn-ghost px-5 py-3">Cancel</button></div>
        </Modal>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl bg-paper p-6 shadow-pop">
        <div className="mb-4 flex items-center justify-between"><h2 className="serif text-xl text-ink">{title}</h2><button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-soft"><CloseIcon /></button></div>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}
export function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink/70">{label}</span>{children}</label>;
}
/**
 * Kept for the pages that already use it (Categories, Coupons). Now backed by the shared
 * Combobox so the admin has one dropdown everywhere instead of an OS-rendered option list.
 */
export function Sel({ value, onChange, options, ariaLabel = "Select an option" }: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  ariaLabel?: string;
}) {
  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={options.map(([v, l]) => ({ value: v, label: l }))}
      ariaLabel={ariaLabel}
      buttonClassName="py-2.5"
    />
  );
}
