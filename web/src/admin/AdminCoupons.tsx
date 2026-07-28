import { useEffect, useState } from "react";
import { adminApi, type AdminCoupon } from "./adminApi";
import { usd } from "../lib/api";
import { Spinner, PlusIcon, TrashIcon } from "../components/ui";
import { Modal, L, Sel } from "./AdminCategories";

type Draft = { id: number; code: string; type: string; value: string; minOrder: string; maxUses: string; expiresAt: string; active: boolean };
const toDraft = (c?: AdminCoupon): Draft => c ? {
  id: c.id, code: c.code, type: c.type, value: c.type === "fixed" ? (c.value / 100).toString() : c.value.toString(),
  minOrder: (c.minOrderCents / 100).toString(), maxUses: c.maxUses?.toString() ?? "", expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : "", active: c.active,
} : { id: 0, code: "", type: "percent", value: "10", minOrder: "0", maxUses: "", expiresAt: "", active: true };

export function AdminCoupons() {
  const [rows, setRows] = useState<AdminCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [err, setErr] = useState("");

  const load = () => { setLoading(true); adminApi.coupons().then((r) => setRows(r.coupons)).finally(() => setLoading(false)); };
  useEffect(load, []);

  const save = async () => {
    if (!edit) return; setErr("");
    const body = { code: edit.code, type: edit.type, value: edit.value, minOrder: edit.minOrder, maxUses: edit.maxUses || null, expiresAt: edit.expiresAt || null, active: edit.active };
    try { if (edit.id) await adminApi.updateCoupon(edit.id, body); else await adminApi.createCoupon(body); setEdit(null); load(); }
    catch (e) { setErr((e as Error).message); }
  };
  const remove = async (c: AdminCoupon) => { if (confirm(`Delete coupon ${c.code}?`)) { await adminApi.deleteCoupon(c.id); load(); } };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Coupons</h1><p className="mt-1 text-sm text-muted">{rows.length} codes</p></div>
        <button onClick={() => { setErr(""); setEdit(toDraft()); }} className="btn btn-ink px-5 py-2.5"><PlusIcon className="h-4 w-4" /> New coupon</button>
      </div>

      {loading ? <div className="grid place-items-center py-20 text-plum"><Spinner /></div> : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-soft/50 text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Discount</th><th className="hidden px-4 py-3 sm:table-cell">Min order</th><th className="px-4 py-3">Used</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-soft/40">
                  <td className="px-4 py-3 font-semibold text-ink">{c.code}</td>
                  <td className="px-4 py-3 tabular">{c.type === "percent" ? `${c.value}%` : usd(c.value)}</td>
                  <td className="hidden px-4 py-3 text-muted sm:table-cell tabular">{c.minOrderCents ? usd(c.minOrderCents) : "—"}</td>
                  <td className="px-4 py-3 tabular">{c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : ""}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.active ? "bg-ok/10 text-ok" : "bg-soft text-muted"}`}>{c.active ? "Active" : "Off"}</span></td>
                  <td className="px-4 py-3 text-right"><button onClick={() => { setErr(""); setEdit(toDraft(c)); }} className="rounded-md px-2 py-1 text-[12px] font-semibold text-plum hover:bg-plum-soft">Edit</button><button onClick={() => remove(c)} className="ml-1 h-7 w-7 rounded-md text-muted hover:text-sale"><TrashIcon className="mx-auto h-4 w-4" /></button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No coupons yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <Modal title={edit.id ? "Edit coupon" : "New coupon"} onClose={() => setEdit(null)}>
          <L label="Code"><input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} disabled={!!edit.id} placeholder="WELCOME10" className="field uppercase disabled:opacity-60" /></L>
          <div className="grid grid-cols-2 gap-3">
            <L label="Type"><Sel value={edit.type} onChange={(v) => setEdit({ ...edit, type: v })} options={[["percent", "Percent %"], ["fixed", "Fixed $"]]} /></L>
            <L label={edit.type === "percent" ? "Percent off" : "Amount off ($)"}><input value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} inputMode="decimal" className="field" /></L>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <L label="Min order ($)"><input value={edit.minOrder} onChange={(e) => setEdit({ ...edit, minOrder: e.target.value })} inputMode="decimal" className="field" /></L>
            <L label="Max uses (blank = ∞)"><input value={edit.maxUses} onChange={(e) => setEdit({ ...edit, maxUses: e.target.value })} inputMode="numeric" className="field" /></L>
          </div>
          <L label="Expires (optional)"><input type="date" value={edit.expiresAt} onChange={(e) => setEdit({ ...edit, expiresAt: e.target.value })} className="field" /></L>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="accent-plum" /> Active</label>
          {err && <p className="text-[12px] text-sale">{err}</p>}
          <div className="flex gap-2 pt-2"><button onClick={save} className="btn btn-ink flex-1 py-3">Save</button><button onClick={() => setEdit(null)} className="btn btn-ghost px-5 py-3">Cancel</button></div>
        </Modal>
      )}
    </div>
  );
}
