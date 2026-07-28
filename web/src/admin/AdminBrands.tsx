import { useEffect, useState } from "react";
import { adminApi, type AdminBrand } from "./adminApi";
import { Spinner, PlusIcon, TrashIcon } from "../components/ui";
import { Modal, L } from "./AdminCategories";

const blank = { id: 0, slug: "", name: "", blurb: "", featured: false, sortOrder: 0, active: true, _count: { products: 0 } };

export function AdminBrands() {
  const [rows, setRows] = useState<AdminBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<AdminBrand | null>(null);
  const [err, setErr] = useState("");

  const load = () => { setLoading(true); adminApi.brands().then((r) => setRows(r.brands)).finally(() => setLoading(false)); };
  useEffect(load, []);

  const save = async () => {
    if (!edit) return; setErr("");
    try { if (edit.id) await adminApi.updateBrand(edit.id, edit); else await adminApi.createBrand(edit); setEdit(null); load(); }
    catch (e) { setErr((e as Error).message); }
  };
  const remove = async (b: AdminBrand) => { if (confirm(`Delete “${b.name}”? Products keep their data but lose the brand.`)) { await adminApi.deleteBrand(b.id); load(); } };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Brands</h1><p className="mt-1 text-sm text-muted">{rows.length} brands</p></div>
        <button onClick={() => { setErr(""); setEdit(blank as AdminBrand); }} className="btn btn-ink px-5 py-2.5"><PlusIcon className="h-4 w-4" /> New</button>
      </div>

      {loading ? <div className="grid place-items-center py-20 text-plum"><Spinner /></div> : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-soft/50 text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Brand</th><th className="px-4 py-3">Products</th><th className="px-4 py-3">Featured</th><th className="px-4 py-3"></th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((b) => (
                <tr key={b.id} className="hover:bg-soft/40">
                  <td className="px-4 py-3"><p className="serif text-[15px] font-medium text-ink">{b.name}</p><p className="text-[11px] text-muted">{b.blurb}</p></td>
                  <td className="px-4 py-3 text-muted">{b._count.products}</td>
                  <td className="px-4 py-3">{b.featured ? <span className="rounded-full bg-plum-soft px-2 py-0.5 text-[11px] font-semibold text-plum">Featured</span> : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-3 text-right"><button onClick={() => { setErr(""); setEdit(b); }} className="rounded-md px-2 py-1 text-[12px] font-semibold text-plum hover:bg-plum-soft">Edit</button><button onClick={() => remove(b)} className="ml-1 h-7 w-7 rounded-md text-muted hover:text-sale"><TrashIcon className="mx-auto h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <Modal title={edit.id ? "Edit brand" : "New brand"} onClose={() => setEdit(null)}>
          <L label="Name"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="field" /></L>
          <L label="Slug (optional)"><input value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} placeholder="auto from name" className="field" /></L>
          <L label="Blurb"><input value={edit.blurb} onChange={(e) => setEdit({ ...edit, blurb: e.target.value })} className="field" /></L>
          <div className="grid grid-cols-2 gap-3">
            <L label="Sort order"><input type="number" value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} className="field" /></L>
            <div className="flex flex-col justify-end gap-1 pb-1">
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={edit.featured} onChange={(e) => setEdit({ ...edit, featured: e.target.checked })} className="accent-plum" /> Featured</label>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="accent-plum" /> Active</label>
            </div>
          </div>
          {err && <p className="text-[12px] text-sale">{err}</p>}
          <div className="flex gap-2 pt-2"><button onClick={save} className="btn btn-ink flex-1 py-3">Save</button><button onClick={() => setEdit(null)} className="btn btn-ghost px-5 py-3">Cancel</button></div>
        </Modal>
      )}
    </div>
  );
}
