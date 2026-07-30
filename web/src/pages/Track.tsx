import { useState } from "react";
import { Button } from "../components/Button";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, usd, type Order } from "../lib/api";
import { useStore } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { ProductGlyph } from "../components/ProductGlyph";
import { BoxIcon, CheckIcon, Spinner } from "../components/ui";

export function Track() {
  const { number } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(number ?? "");

  if (!number) {
    return (
      <div className="wrap grid min-h-[56vh] place-items-center py-16">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-plum-soft text-plum"><BoxIcon className="h-7 w-7" /></div>
          <h1 className="serif mt-5 text-3xl text-ink">Track your order</h1>
          <p className="mt-2 text-sm text-muted">Enter the order number we sent you (e.g. TG-A1B2C3).</p>
          <form onSubmit={(e) => { e.preventDefault(); if (input.trim()) navigate(`/track/${input.trim().toUpperCase()}`); }} className="mt-6 flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="TG-XXXXXX" className="field flex-1 text-center uppercase tracking-wider" />
            <Button type="submit" variant="primary" size="md">Track</Button>
          </form>
        </div>
      </div>
    );
  }
  return <TrackResult number={number.toUpperCase()} />;
}

function TrackResult({ number }: { number: string }) {
  const { site } = useStore();
  const { data: order, loading, error } = useFetch(() => api.trackOrder(number), [number]);
  const statuses = site?.statuses ?? [];

  if (loading) return <div className="grid min-h-[60vh] place-items-center text-plum"><Spinner /></div>;
  if (error || !order) return (
    <div className="wrap grid min-h-[52vh] place-items-center py-20 text-center">
      <div><h1 className="serif text-3xl text-ink">Order not found</h1><p className="mt-2 text-sm text-muted">{error}</p><Link to="/track" className="btn btn-ghost mt-6 px-6 py-3">Try another number</Link></div>
    </div>
  );

  return (
    <div className="wrap py-8">
      <div className="mx-auto max-w-3xl">
        <Link to="/track" className="text-[13px] font-semibold text-plum hover:underline">← Track another</Link>
        <h1 className="serif mt-2 text-3xl font-medium text-ink sm:text-4xl">Order {order.number}</h1>
        <p className="mt-1 text-sm text-muted">Placed {new Date(order.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* timeline */}
          <div className="rounded-2xl border border-line bg-surface p-6">
            <Timeline order={order} statuses={statuses} />
          </div>

          {/* summary */}
          <aside className="space-y-4">
            <div className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Items</h2>
              <ul className="mt-3 space-y-3">
                {order.items.map((it) => (
                  <li key={it.id} className="flex gap-3">
                    <span className="grid h-12 w-11 shrink-0 place-items-center overflow-hidden rounded-lg" style={{ background: it.tint }}>
                      {it.imageUrl ? <img src={it.imageUrl} alt="" className="h-full w-full object-cover" /> : <ProductGlyph kind={it.glyph} className="h-full w-full p-2 text-plum/45" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-[13px] font-medium text-ink">{it.name}</p>
                      <p className="text-[11px] text-muted">{it.qty} × {usd(it.priceCents)}{it.variantLabel ? ` · ${it.variantLabel}` : ""}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-[13px]">
                <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular">{usd(order.subtotalCents)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd className="tabular">{order.deliveryCents === 0 ? "Free" : usd(order.deliveryCents)}</dd></div>
                <div className="flex justify-between pt-1 font-semibold text-ink"><dt>Total (COD)</dt><dd className="serif text-base tabular">{usd(order.totalCents)}</dd></div>
              </dl>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-5 text-[13px] text-ink/80">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Delivery to</h2>
              <p className="mt-2 font-medium text-ink">{order.fullName}</p>
              <p>{order.phone}</p>
              <p className="mt-1">{[order.address, order.city, order.area].filter(Boolean).join(", ")}</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Timeline({ order, statuses }: { order: Order; statuses: { key: string; label: string; hint: string; tone: string; terminal?: boolean }[] }) {
  const terminalKeys = ["cancelled", "unavailable", "on_hold"];
  const isTerminal = terminalKeys.includes(order.status);
  const meta = statuses.find((s) => s.key === order.status);
  // main happy-path steps
  const flow = statuses.filter((s) => !terminalKeys.includes(s.key));
  const currentIdx = flow.findIndex((s) => s.key === order.status);

  const toneColor = (t?: string) => t === "bad" ? "text-sale" : t === "warn" ? "text-[#b7791f]" : "text-ok";

  return (
    <div>
      <div className={`mb-5 flex items-center gap-2 rounded-xl px-4 py-3 text-[14px] font-semibold ${isTerminal ? "bg-soft" : "bg-plum-soft"}`}>
        <span className={isTerminal ? toneColor(meta?.tone) : "text-plum"}>{meta?.label ?? order.status}</span>
      </div>
      {isTerminal ? (
        <p className="text-[13px] text-muted">{meta?.hint}</p>
      ) : (
        <ol className="relative ml-1">
          {flow.map((s, i) => {
            const done = i < currentIdx;
            const active = i === currentIdx;
            return (
              <li key={s.key} className="flex gap-3 pb-5 last:pb-0">
                <div className="relative flex flex-col items-center">
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] ${done ? "bg-ok text-white" : active ? "bg-plum text-white ring-4 ring-plum-soft" : "border border-line-strong bg-surface text-muted"}`}>
                    {done ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  {i < flow.length - 1 && <span className={`w-px flex-1 ${done ? "bg-ok/50" : "bg-line"}`} />}
                </div>
                <div className={`pt-0.5 ${active ? "" : done ? "opacity-90" : "opacity-50"}`}>
                  <p className={`text-[14px] font-semibold ${active ? "text-plum" : "text-ink"}`}>{s.label}</p>
                  {active && <p className="mt-0.5 text-[12px] text-muted">{s.hint}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
