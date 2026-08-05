import { useEffect, useState } from "react";
import { adminApi, type AdminGiftCard } from "./adminApi";
import { usd } from "../lib/api";
import { Spinner, PlusIcon, TrashIcon } from "../components/ui";
import { Modal, L } from "./AdminCategories";

// One place per fact. "Spent" and "Off" are different answers and the two renderings must not
// be free to disagree about which one a card is showing.
const isLive = (g: AdminGiftCard) => g.active && g.balanceCents > 0;
const statusLabel = (g: AdminGiftCard) => !g.active ? "Off" : g.balanceCents > 0 ? "Active" : "Spent";

/**
 * Gift cards.
 *
 * ── WHY THERE ARE TWO RENDERINGS ───────────────────────────────────────────────────
 *
 * The last column is Edit / Delete, and the table sat in an `overflow-hidden` wrapper. At
 * 390px that column was not merely off-screen — there was no scrollbar to reach it with, so
 * a card's balance could not be corrected from a phone at all.
 *
 * That is the same defect 268695e fixed for the product list ("the Edit button was off-screen
 * on every laptop") via `stickyRight` in DataTable. This screen is a sibling that was missed.
 * Both halves of that fix are applied here: the table scrolls sideways and the actions cell is
 * pinned to the right edge, and below 640px it is cards instead — same rows, one source.
 */
export function AdminGiftCards() {
  const [rows, setRows] = useState<AdminGiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [create, setCreate] = useState<{ amount: string; code: string; recipientName: string; senderName: string; message: string } | null>(null);
  const [edit, setEdit] = useState<AdminGiftCard | null>(null);
  const [err, setErr] = useState("");
  const [newCode, setNewCode] = useState("");

  const load = () => { setLoading(true); adminApi.giftCards().then((r) => setRows(r.giftCards)).finally(() => setLoading(false)); };
  useEffect(load, []);

  const issue = async () => {
    if (!create) return; setErr("");
    try { const r = await adminApi.createGiftCard(create); setCreate(null); setNewCode(r.code); load(); }
    catch (e) { setErr((e as Error).message); }
  };
  const saveEdit = async () => {
    if (!edit) return;
    await adminApi.updateGiftCard(edit.id, { balance: edit.balanceCents / 100, active: edit.active, recipientName: edit.recipientName, senderName: edit.senderName, message: edit.message });
    setEdit(null); load();
  };
  const remove = async (g: AdminGiftCard) => { if (confirm(`Delete gift card ${g.code}?`)) { await adminApi.deleteGiftCard(g.id); load(); } };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div><h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Gift cards</h1><p className="mt-1 text-sm text-muted">{rows.length} issued</p></div>
        <button onClick={() => { setErr(""); setCreate({ amount: "50", code: "", recipientName: "", senderName: "", message: "" }); }} className="btn btn-ink px-5 py-2.5"><PlusIcon className="h-4 w-4" /> Issue gift card</button>
      </div>

      {newCode && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-ok/30 bg-ok/5 px-4 py-3 text-[13px]">
          <span className="text-ok">Issued <strong className="font-mono">{newCode}</strong> — share this code with the recipient.</span>
          <button onClick={() => { navigator.clipboard?.writeText(newCode); }} className="font-semibold text-plum hover:underline">Copy</button>
        </div>
      )}

      {loading ? <div className="grid place-items-center py-20 text-plum"><Spinner /></div> : (
        <>
          <ul className="mt-5 space-y-3 sm:hidden">
            {rows.map((g) => <PhoneCard key={g.id} g={g} onEdit={() => setEdit(g)} onDelete={() => remove(g)} />)}
            {rows.length === 0 && <li className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-[13px] text-muted">No gift cards issued yet.</li>}
          </ul>

          {/* The pinned cells carry an opaque background of their own — soft/50 and soft/40
              resolved against surface — because a translucent pin lets the columns scrolling
              under it show through. Same reasoning as DataTable's. */}
          <div className="mt-5 hidden overflow-hidden rounded-2xl border border-line bg-surface sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-line bg-soft/50 text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Balance</th><th className="hidden px-4 py-3 sm:table-cell">Initial</th><th className="hidden px-4 py-3 sm:table-cell">Recipient</th><th className="px-4 py-3">Status</th><th className="sticky right-0 bg-[#faf9fa] px-4 py-3"></th></tr></thead>
                <tbody className="divide-y divide-line">
                  {rows.map((g) => (
                    <tr key={g.id} className="group hover:bg-soft/40">
                      <td className="px-4 py-3 font-mono text-[12px] font-semibold text-ink">{g.code}</td>
                      <td className="px-4 py-3 tabular font-semibold">{usd(g.balanceCents)}</td>
                      <td className="hidden px-4 py-3 text-muted sm:table-cell tabular">{usd(g.initialCents)}</td>
                      <td className="hidden px-4 py-3 text-muted sm:table-cell">{g.recipientName || "—"}</td>
                      <td className="px-4 py-3"><StatusPill g={g} /></td>
                      <td className="sticky right-0 bg-surface px-4 py-3 text-right shadow-[-8px_0_8px_-8px_rgba(26,26,30,0.12)] group-hover:bg-[#fbfafb]"><button onClick={() => setEdit(g)} className="rounded-md px-2 py-1 text-[12px] font-semibold text-plum hover:bg-plum-soft">Edit</button><button onClick={() => remove(g)} aria-label={`Delete ${g.code}`} className="ml-1 h-7 w-7 rounded-md text-muted hover:text-sale"><TrashIcon className="mx-auto h-4 w-4" /></button></td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No gift cards issued yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {create && (
        <Modal title="Issue gift card" onClose={() => setCreate(null)}>
          <L label="Amount ($)"><input value={create.amount} onChange={(e) => setCreate({ ...create, amount: e.target.value })} inputMode="decimal" className="field" /></L>
          <L label="Custom code (optional)"><input value={create.code} onChange={(e) => setCreate({ ...create, code: e.target.value.toUpperCase() })} placeholder="auto-generated" className="field uppercase" /></L>
          <div className="grid grid-cols-2 gap-3">
            <L label="Recipient"><input value={create.recipientName} onChange={(e) => setCreate({ ...create, recipientName: e.target.value })} className="field" /></L>
            <L label="From"><input value={create.senderName} onChange={(e) => setCreate({ ...create, senderName: e.target.value })} className="field" /></L>
          </div>
          <L label="Message"><textarea value={create.message} onChange={(e) => setCreate({ ...create, message: e.target.value })} rows={2} className="field resize-none" /></L>
          {err && <p className="text-[12px] text-sale">{err}</p>}
          <div className="flex gap-2 pt-2"><button onClick={issue} className="btn btn-ink flex-1 py-3">Issue</button><button onClick={() => setCreate(null)} className="btn btn-ghost px-5 py-3">Cancel</button></div>
        </Modal>
      )}

      {edit && (
        <Modal title={`Edit ${edit.code}`} onClose={() => setEdit(null)}>
          <L label="Balance ($)"><input value={(edit.balanceCents / 100).toString()} onChange={(e) => setEdit({ ...edit, balanceCents: Math.round(Number(e.target.value) * 100) || 0 })} inputMode="decimal" className="field" /></L>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} className="accent-plum" /> Active</label>
          <div className="flex gap-2 pt-2"><button onClick={saveEdit} className="btn btn-ink flex-1 py-3">Save</button><button onClick={() => setEdit(null)} className="btn btn-ghost px-5 py-3">Cancel</button></div>
        </Modal>
      )}
    </div>
  );
}

function StatusPill({ g }: { g: AdminGiftCard }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${isLive(g) ? "bg-ok/10 text-ok" : "bg-soft text-muted"}`}>{statusLabel(g)}</span>;
}

/**
 * One gift card, as read on a phone.
 *
 * The code leads: a customer reads it out at checkout and this screen is how it gets found.
 * The balance sits under it as the figure the operator is actually being asked about, against
 * what was issued — "$12.50 left of $50" answers "has it been used?" without a second column.
 * The recipient only appears when the card was issued to someone named.
 */
function PhoneCard({ g, onEdit, onDelete }: { g: AdminGiftCard; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-all font-mono text-[16px] font-semibold leading-tight text-ink">{g.code}</p>
          <span className="shrink-0"><StatusPill g={g} /></span>
        </div>
        <p className="mt-2 flex items-baseline gap-1.5">
          <span className="serif text-[19px] leading-none tabular text-ink">{usd(g.balanceCents)}</span>
          <span className="text-[13px] text-muted-strong">left of {usd(g.initialCents)}</span>
        </p>
        {g.recipientName && <p className="mt-1 text-[13px] text-muted-strong">For {g.recipientName}</p>}
        <p className="mt-1 text-[11px] text-muted">Issued {new Date(g.createdAt).toLocaleDateString()}</p>
      </div>

      {/* The row's actions, as a footer a thumb can hit. */}
      <div className="flex border-t border-line">
        <button onClick={onEdit} className="focus-ring flex min-h-11 flex-1 items-center justify-center text-[13px] font-semibold text-plum">Edit</button>
        <button onClick={onDelete} aria-label={`Delete ${g.code}`} className="focus-ring flex min-h-11 w-14 shrink-0 items-center justify-center border-l border-line text-muted"><TrashIcon className="h-4 w-4" /></button>
      </div>
    </li>
  );
}
