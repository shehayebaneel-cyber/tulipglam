import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi, type AdminOrder } from "./adminApi";
import { usd } from "../lib/api";
import { useStore } from "../lib/store";
import { ProductGlyph } from "../components/ProductGlyph";
import { StatusPill } from "./ui";
import { Spinner, ChevronDown, WhatsAppIcon } from "../components/ui";
import { waLink } from "../lib/api";
import type { Glyph } from "../lib/api";

export function AdminOrders() {
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  if (id) return <OrderDetail id={Number(id)} onBack={() => { const n = new URLSearchParams(params); n.delete("id"); setParams(n); }} />;
  return <OrderList />;
}

function OrderList() {
  const { site } = useStore();
  const statuses = site?.statuses ?? [];
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setLoading(true); adminApi.orders(q, status).then((r) => setOrders(r.orders)).finally(() => setLoading(false)); }, [q, status]);

  const setStatus = (s: string) => { const n = new URLSearchParams(params); if (s) n.set("status", s); else n.delete("status"); setParams(n); };

  return (
    <div>
      <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Orders</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, name, phone…" className="field max-w-xs" />
        <div className="relative">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="field appearance-none pr-9">
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        </div>
      </div>

      {loading ? <div className="grid place-items-center py-20 text-plum"><Spinner /></div> : orders.length === 0 ? (
        <p className="mt-8 text-sm text-muted">No orders found.</p>
      ) : (
        <div className="mt-5 space-y-2">
          {orders.map((o) => (
            <button key={o.id} onClick={() => setParams(new URLSearchParams({ id: String(o.id) }))} className="flex w-full items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left hover:border-plum/40">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{o.number} · {o.fullName}</p>
                <p className="text-[12px] text-muted">{o.phone} · {o.area || "—"} · {new Date(o.createdAt).toLocaleDateString()} · {o.items.length} item{o.items.length === 1 ? "" : "s"}</p>
              </div>
              <StatusPill status={o.status} statuses={statuses} />
              <span className="serif text-[15px] tabular">{usd(o.totalCents)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { site } = useStore();
  const statuses = site?.statuses ?? [];
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => adminApi.order(id).then((o) => { setOrder(o); setNewStatus(o.status); });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!order) return <div className="grid place-items-center py-20 text-plum"><Spinner /></div>;

  const update = async () => {
    setBusy(true);
    try { await adminApi.setOrderStatus(id, newStatus, note); setNote(""); await load(); }
    finally { setBusy(false); }
  };
  const wa = order.whatsapp || order.phone;

  return (
    <div>
      <button onClick={onBack} className="text-[13px] font-semibold text-plum hover:underline">← All orders</button>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">{order.number}</h1>
        <StatusPill status={order.status} statuses={statuses} />
      </div>
      <p className="mt-1 text-sm text-muted">Placed {new Date(order.createdAt).toLocaleString()}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {/* items */}
          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Items</h2>
            <ul className="mt-3 divide-y divide-line">
              {order.items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 py-3">
                  <span className="grid h-12 w-11 shrink-0 place-items-center overflow-hidden rounded-lg" style={{ background: it.tint }}>
                    {it.imageUrl ? <img src={it.imageUrl} alt="" className="h-full w-full object-cover" /> : <ProductGlyph kind={it.glyph as Glyph} className="h-full w-full p-2 text-plum/45" />}
                  </span>
                  <div className="min-w-0 flex-1"><p className="text-[13px] font-medium text-ink">{it.name}</p><p className="text-[11px] text-muted">{it.brandName}{it.variantLabel ? ` · ${it.variantLabel}` : ""}</p></div>
                  <span className="text-[13px] text-muted">{it.qty} ×</span>
                  <span className="serif text-[14px] tabular">{usd(it.priceCents * it.qty)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[13px]">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular">{usd(order.subtotalCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd className="tabular">{order.deliveryCents === 0 ? "Free" : usd(order.deliveryCents)}</dd></div>
              <div className="flex justify-between pt-1 font-semibold text-ink"><dt>Total (COD)</dt><dd className="serif text-base tabular">{usd(order.totalCents)}</dd></div>
            </dl>
          </div>

          {/* history */}
          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">History</h2>
            <ol className="mt-3 space-y-3">
              {(order.events ?? []).map((e) => (
                <li key={e.id} className="flex gap-3 text-[13px]">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-plum" />
                  <div><p className="font-medium text-ink">{statuses.find((s) => s.key === e.status)?.label ?? e.status}</p>{e.note && <p className="text-muted">{e.note}</p>}<p className="text-[11px] text-muted">{new Date(e.createdAt).toLocaleString()}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* customer + actions */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-line bg-surface p-5 text-[13px]">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Customer</h2>
            <p className="mt-2 font-semibold text-ink">{order.fullName}</p>
            <p className="text-ink/80">{order.phone}</p>
            {order.email && <p className="text-ink/80">{order.email}</p>}
            <p className="mt-2 text-ink/80">{[order.address, order.city, order.area].filter(Boolean).join(", ")}</p>
            {order.notes && <p className="mt-2 rounded-lg bg-soft px-3 py-2 text-ink/70">“{order.notes}”</p>}
            <a href={waLink(wa, `Hi ${order.fullName}, this is TulipGlam about your order ${order.number}.`)} target="_blank" rel="noreferrer" className="btn btn-cta mt-3 w-full bg-[#25D366] py-2.5 text-white hover:brightness-95"><WhatsAppIcon className="h-4 w-4" /> Message on WhatsApp</a>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Update status</h2>
            <div className="relative mt-3">
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className="field w-full appearance-none pr-9">
                {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional, saved to history)" className="field mt-2" />
            <button onClick={update} disabled={busy || newStatus === order.status} className="btn btn-ink mt-3 w-full py-3 disabled:opacity-40">{busy ? "Updating…" : "Update"}</button>
            <p className="mt-2 text-[11px] text-muted">Tip: after confirming availability, move to <strong>Confirmed</strong>. Use <strong>Awaiting your confirmation</strong> when you need to reach the customer.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
