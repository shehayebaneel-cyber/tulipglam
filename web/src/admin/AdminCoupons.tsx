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

// One place per fact, so the card and the table can never come to say different things about
// the same coupon.
const discountLabel = (c: AdminCoupon) => c.type === "percent" ? `${c.value}%` : usd(c.value);
const usesLabel = (c: AdminCoupon) => `${c.usedCount}${c.maxUses != null ? ` / ${c.maxUses}` : ""}`;

/**
 * Coupons.
 *
 * ── WHY THERE ARE TWO RENDERINGS ───────────────────────────────────────────────────
 *
 * The last column is Edit / Delete, and the table sat in an `overflow-hidden` wrapper. At
 * 390px that column was not merely off-screen — there was no scrollbar to reach it with, so
 * a coupon could not be edited or deleted from a phone at all.
 *
 * That is the same defect 268695e fixed for the product list ("the Edit button was off-screen
 * on every laptop") via `stickyRight` in DataTable. This screen is a sibling that was missed.
 * Both halves of that fix are applied here: the table scrolls sideways and the actions cell is
 * pinned to the right edge, and below 640px it is cards instead — same rows, one source.
 */
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

  const startEdit = (c?: AdminCoupon) => { setErr(""); setEdit(toDraft(c)); };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Coupons</h1><p className="mt-1 text-sm text-muted">{rows.length} codes</p></div>
        <button onClick={() => startEdit()} className="btn btn-ink px-5 py-2.5"><PlusIcon className="h-4 w-4" /> New coupon</button>
      </div>

      {loading ? <div className="grid place-items-center py-20 text-plum"><Spinner /></div> : (
        <>
          <ul className="mt-5 space-y-3 sm:hidden">
            {rows.map((c) => <PhoneCard key={c.id} c={c} onEdit={() => startEdit(c)} onDelete={() => remove(c)} />)}
            {rows.length === 0 && <li className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-[13px] text-muted">No coupons yet.</li>}
          </ul>

          <div className="mt-5 hidden overflow-hidden rounded-2xl border border-line bg-surface sm:block">
            {/* The pinned cells carry an opaque background of their own — soft/50 and soft/40
                resolved against surface — because a translucent pin lets the columns scrolling
                under it show through. Same reasoning as DataTable's. */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-line bg-soft/50 text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Discount</th><th className="hidden px-4 py-3 sm:table-cell">Min order</th><th className="px-4 py-3">Used</th><th className="px-4 py-3">Status</th><th className="sticky right-0 bg-[#faf9fa] px-4 py-3"></th></tr></thead>
                <tbody className="divide-y divide-line">
                  {rows.map((c) => (
                    <tr key={c.id} className="group hover:bg-soft/40">
                      <td className="px-4 py-3 font-semibold text-ink">{c.code}</td>
                      <td className="px-4 py-3 tabular">{discountLabel(c)}</td>
                      <td className="hidden px-4 py-3 text-muted sm:table-cell tabular">{c.minOrderCents ? usd(c.minOrderCents) : "—"}</td>
                      <td className="px-4 py-3 tabular">{usesLabel(c)}</td>
                      <td className="px-4 py-3"><StatusPill active={c.active} /></td>
                      <td className="sticky right-0 bg-surface px-4 py-3 text-right shadow-[-8px_0_8px_-8px_rgba(26,26,30,0.12)] group-hover:bg-[#fbfafb]"><button onClick={() => startEdit(c)} className="rounded-md px-2 py-1 text-[12px] font-semibold text-plum hover:bg-plum-soft">Edit</button><button onClick={() => remove(c)} aria-label={`Delete ${c.code}`} className="ml-1 h-7 w-7 rounded-md text-muted hover:text-sale"><TrashIcon className="mx-auto h-4 w-4" /></button></td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No coupons yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
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

function StatusPill({ active }: { active: boolean }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-ok/10 text-ok" : "bg-soft text-muted"}`}>{active ? "Active" : "Off"}</span>;
}

/**
 * One coupon, as read on a phone.
 *
 * The code is what the operator is looking for — a customer quotes it down the phone — so it
 * leads and it is the largest thing here. Discount and uses are why they looked it up; the
 * expiry only appears when there is one, because a date that is blank on most rows teaches
 * everyone to stop reading that line.
 */
function PhoneCard({ c, onEdit, onDelete }: { c: AdminCoupon; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-all text-[19px] font-semibold leading-tight text-ink">{c.code}</p>
          <span className="shrink-0"><StatusPill active={c.active} /></span>
        </div>
        <p className="mt-1.5 text-[13px] text-muted-strong">
          {discountLabel(c)} off{c.minOrderCents ? ` · over ${usd(c.minOrderCents)}` : ""}
        </p>
        <p className="mt-0.5 text-[13px] tabular text-ink">Used {usesLabel(c)}</p>
        {c.expiresAt && <p className="mt-0.5 text-[11px] text-muted">Expires {new Date(c.expiresAt).toLocaleDateString()}</p>}
      </div>

      {/* The row's actions, as a footer a thumb can hit. */}
      <div className="flex border-t border-line">
        <button onClick={onEdit} className="focus-ring flex min-h-11 flex-1 items-center justify-center text-[13px] font-semibold text-plum">Edit</button>
        <button onClick={onDelete} aria-label={`Delete ${c.code}`} className="focus-ring flex min-h-11 w-14 shrink-0 items-center justify-center border-l border-line text-muted"><TrashIcon className="h-4 w-4" /></button>
      </div>
    </li>
  );
}
