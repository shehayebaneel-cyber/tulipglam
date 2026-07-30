import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi, type AdminOrder, type AdminOrderFull, type AdminOrderItem } from "./adminApi";
import { useStore } from "../lib/store";
import { ProductGlyph } from "../components/ProductGlyph";
import { StatusPill } from "./ui";
import { Spinner, WhatsAppIcon, AlertIcon, SearchIcon, CloseIcon } from "../components/ui";
import { waLink } from "../lib/api";
import { Combobox, type Option } from "./primitives/Combobox";
import { Pagination } from "./primitives/Pagination";
import { ConfirmDialog } from "./primitives/ConfirmDialog";
import { useToast } from "./primitives/Toast";
import { useDebounced } from "./primitives/hooks";
import { money, relativeTime, waitedFor } from "./primitives/format";
import type { Glyph } from "../lib/api";

export function AdminOrders() {
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  if (id) return <OrderDetail id={Number(id)} onBack={() => { const n = new URLSearchParams(params); n.delete("id"); setParams(n); }} />;
  return <OrderList />;
}

// ---------------------------------------------------------------- list
function OrderList() {
  const { site } = useStore();
  const statuses = site?.statuses ?? [];
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const [qInput, setQInput] = useState(params.get("q") ?? "");
  const q = useDebounced(qInput, 300);

  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const patch = (next: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) { if (v === undefined || v === "") p.delete(k); else p.set(k, String(v)); }
    if (!("page" in next)) p.delete("page");
    setParams(p, { replace: true });
  };

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    adminApi.orders(q, status, page)
      .then((r) => { setOrders(r.orders); setTotal(r.total); setPages(r.pages); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [q, status, page]);

  useEffect(() => { load(); }, [load]);

  // Push the debounced search into the URL. The functional form of setParams reads the
  // previous value, so this effect does not have to depend on `params` and re-run on every
  // navigation.
  useEffect(() => {
    setParams((prev) => {
      if ((prev.get("q") ?? "") === q) return prev;
      const p = new URLSearchParams(prev);
      if (q) p.set("q", q); else p.delete("q");
      p.delete("page");
      return p;
    }, { replace: true });
  }, [q, setParams]);

  const statusOptions: Option[] = [{ value: "", label: "Any status" }, ...statuses.map((s) => ({ value: s.key, label: s.label }))];

  return (
    <div>
      <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Orders</h1>
      <p className="mt-1 text-sm text-muted-strong"><span className="num-tabular">{total.toLocaleString()}</span> {status ? "matching" : "in total"}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <div className="relative min-w-[13rem] flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-strong" />
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Number, name or phone…"
            aria-label="Search orders" className="field focus-ring py-2 pl-9 pr-9 text-[13px]" />
          {qInput && (
            <button onClick={() => setQInput("")} aria-label="Clear search" className="focus-ring absolute right-3 top-1/2 -translate-y-1/2 text-muted-strong hover:text-ink">
              <CloseIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <Combobox value={status} onChange={(v) => patch({ status: v })} options={statusOptions} ariaLabel="Filter orders by status" className="w-[13rem]" />
      </div>

      {loading ? (
        <div className="mt-5 space-y-2" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-[4.5rem] rounded-2xl" />)}
        </div>
      ) : error ? (
        <div className="mt-5 rounded-2xl border border-line bg-surface px-4 py-12 text-center">
          <p className="text-[14px] font-semibold text-ink">Could not load orders</p>
          <p className="mt-1 text-[13px] text-muted-strong">{error}</p>
          <button onClick={load} className="btn btn-ghost focus-ring mt-4 px-5 py-2.5">Try again</button>
        </div>
      ) : orders.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-line-strong px-4 py-16 text-center">
          <p className="serif text-xl text-ink">{status || q ? "No matching orders" : "No orders yet"}</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted-strong">
            {status || q
              ? "Try a different status or search."
              : "When the first order arrives it appears here at Order Received, and you confirm each item can be sourced before moving it on."}
          </p>
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface">
          <ul className="divide-y divide-line">
            {orders.map((o) => (
              <li key={o.id}>
                <button onClick={() => setParams(new URLSearchParams({ id: String(o.id) }))}
                  className="focus-ring flex w-full items-center gap-4 px-4 py-3.5 text-left hover:bg-soft/55">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{o.number} · {o.fullName}</p>
                    <p className="text-[12px] text-muted-strong">
                      {o.phone} · {o.area || "no area"} · {relativeTime(o.createdAt)} · {o.items.length} item{o.items.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  {o.status === "awaiting_customer" && o.awaitingSince && (
                    <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#fdf1dd] px-2 py-0.5 text-[11px] font-semibold text-[#8a5f0c] sm:inline-flex">
                      <AlertIcon className="h-3.5 w-3.5" /> waiting {waitedFor(o.awaitingSince)}
                    </span>
                  )}
                  <StatusPill status={o.status} statuses={statuses} />
                  <span className="num-tabular shrink-0 text-[14px] font-semibold">{money(o.totalCents)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Pagination page={page} pages={pages} total={total} pageSize={50} label="orders"
            onPage={(n) => { const p = new URLSearchParams(params); if (n === 1) p.delete("page"); else p.set("page", String(n)); setParams(p); }}
            onPageSize={() => { /* orders use a fixed page size */ }} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- detail
function OrderDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { site } = useStore();
  const statuses = site?.statuses ?? [];
  const { push } = useToast();
  const [order, setOrder] = useState<AdminOrderFull | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askItem, setAskItem] = useState("");
  const [askNote, setAskNote] = useState("");
  const [resolving, setResolving] = useState<null | "accept" | "remove" | "cancel">(null);

  const load = useCallback(async () => {
    const o = await adminApi.order(id);
    setOrder(o);
    setNewStatus(o.status);
  }, [id]);

  useEffect(() => { load().catch((e: Error) => push("error", e.message)); }, [load, push]);

  if (!order) return <div className="grid place-items-center py-20 text-plum"><Spinner /></div>;

  const label = (k: string) => statuses.find((s) => s.key === k)?.label ?? k;
  const wa = order.whatsapp || order.phone;
  const waOk = order.context.whatsappConfigured;
  const blocked = order.items.find((i) => i.id === order.awaitingItemId) ?? null;

  const update = async () => {
    setBusy(true);
    try {
      await adminApi.setOrderStatus(id, newStatus, note);
      setNote("");
      await load();
      push("ok", `Order moved to ${label(newStatus)}`);
    } catch (e) {
      push("error", (e as Error).message);
      setNewStatus(order.status);
    } finally { setBusy(false); }
  };

  const ask = async () => {
    setBusy(true);
    try {
      await adminApi.askCustomer(id, Number(askItem), askNote);
      setAsking(false); setAskItem(""); setAskNote("");
      await load();
      push("ok", "Order is now awaiting the customer");
    } catch (e) { push("error", (e as Error).message); }
    finally { setBusy(false); }
  };

  const resolve = async (action: "accept" | "remove" | "cancel") => {
    setBusy(true);
    try {
      await adminApi.resolveOrder(id, action, "");
      setResolving(null);
      await load();
      push("ok", action === "cancel" ? "Order cancelled" : action === "remove" ? "Item removed and total recalculated" : "Order confirmed");
    } catch (e) { push("error", (e as Error).message); }
    finally { setBusy(false); }
  };

  // Only legal moves are offered; the server rejects anything else regardless.
  const statusOptions: Option[] = [
    { value: order.status, label: `${label(order.status)} (current)` },
    ...order.nextStatuses.map((k) => ({ value: k, label: label(k) })),
  ];
  const terminal = order.nextStatuses.length === 0;

  return (
    <div>
      <button onClick={onBack} className="focus-ring text-[13px] font-semibold text-plum hover:underline">← All orders</button>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">{order.number}</h1>
        <StatusPill status={order.status} statuses={statuses} />
      </div>
      <p className="mt-1 text-sm text-muted-strong">Placed {new Date(order.createdAt).toLocaleString()}</p>

      {/* ---------------- awaiting the customer ---------------- */}
      {order.status === "awaiting_customer" && (
        <section aria-labelledby="awaiting-heading" className="mt-5 overflow-hidden rounded-2xl border border-[#e5c890] bg-[#fdf1dd]/60">
          <div className="flex items-start gap-3 px-5 py-4">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-[#8a5f0c]" />
            <div className="min-w-0 flex-1">
              <h2 id="awaiting-heading" className="text-[14px] font-semibold text-ink">
                Waiting on the customer{order.awaitingSince ? ` — ${waitedFor(order.awaitingSince)}` : ""}
              </h2>
              {blocked ? (
                <p className="mt-1 text-[13px] text-ink/80">
                  Could not source <strong className="text-ink">{blocked.name}</strong>
                  {blocked.variantLabel ? ` (${blocked.variantLabel})` : ""} — {blocked.qty} × {money(blocked.priceCents)}
                </p>
              ) : (
                <p className="mt-1 text-[13px] text-ink/80">No specific item was recorded against this.</p>
              )}
              {order.awaitingNote && <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-[13px] italic text-ink/80">“{order.awaitingNote}”</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[#e5c890]/60 bg-white/40 px-5 py-3">
            <button onClick={() => setResolving("accept")} disabled={busy} className="btn btn-ink focus-ring px-4 py-2 text-[12px]">Accepted a substitute</button>
            <button onClick={() => setResolving("remove")} disabled={busy || !blocked || order.items.length < 2} className="btn btn-ghost focus-ring px-4 py-2 text-[12px]"
              title={!blocked ? "No item recorded" : order.items.length < 2 ? "This is the only item — cancel instead" : undefined}>
              Remove the item
            </button>
            <button onClick={() => setResolving("cancel")} disabled={busy} className="btn focus-ring bg-sale px-4 py-2 text-[12px] text-white hover:brightness-95">Customer cancelled</button>
          </div>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {/* ---------------- items + full money breakdown ---------------- */}
          <Card title="Items">
            <ul className="divide-y divide-line">
              {order.items.map((it) => (
                <li key={it.id} className={`flex items-center gap-3 py-3 ${it.id === order.awaitingItemId ? "opacity-100" : ""}`}>
                  <span className="grid h-12 w-11 shrink-0 place-items-center overflow-hidden rounded-lg" style={{ background: it.tint }}>
                    {it.imageUrl ? <img src={it.imageUrl} alt="" className="h-full w-full object-cover" /> : <ProductGlyph kind={it.glyph as Glyph} className="h-full w-full p-2 text-plum/45" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{it.name}</p>
                    <p className="text-[11px] text-muted-strong">{it.brandName}{it.variantLabel ? ` · ${it.variantLabel}` : ""}</p>
                    {it.id === order.awaitingItemId && <p className="mt-0.5 text-[11px] font-semibold text-[#8a5f0c]">Could not be sourced</p>}
                  </div>
                  <span className="num-tabular text-[13px] text-muted-strong">{it.qty} ×</span>
                  <span className="num-tabular text-[13px] font-semibold">{money(it.priceCents * it.qty)}</span>
                </li>
              ))}
            </ul>

            <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[13px]">
              <Money label="Subtotal" value={money(order.subtotalCents)} />
              {order.discountCents > 0 && (
                <Money label={`Coupon${order.couponCode ? ` · ${order.couponCode}` : ""}`} value={`−${money(order.discountCents)}`} tone="ok" />
              )}
              <Money
                label={
                  order.context.freeDeliveryApplied
                    ? `Delivery · free over ${money(order.context.freeDeliveryThresholdCents)}`
                    : `Delivery${order.area ? ` · ${order.area}` : ""}${order.context.areaFeeCents === null && order.deliveryCents > 0 ? " (default fee)" : ""}`
                }
                value={order.deliveryCents === 0 ? "Free" : money(order.deliveryCents)}
              />
              {order.giftCardCents > 0 && (
                <Money label={`Gift card${order.giftCardCode ? ` · ${order.giftCardCode}` : ""}`} value={`−${money(order.giftCardCents)}`} tone="ok" />
              )}
              <div className="flex items-baseline justify-between border-t border-line pt-2 font-semibold text-ink">
                <dt>Total — cash on delivery</dt>
                <dd className="num-tabular text-base">{money(order.totalCents)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[11px] text-muted-strong">Every figure was calculated on the server at checkout and recalculated there after any change.</p>
          </Card>

          <Card title="History">
            <ol className="space-y-3">
              {(order.events ?? []).map((e) => (
                <li key={e.id} className="flex gap-3 text-[13px]">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-plum" />
                  <div>
                    <p className="font-medium text-ink">{label(e.status)}</p>
                    {e.note && <p className="text-ink/70">{e.note}</p>}
                    <p className="text-[11px] text-muted-strong">{new Date(e.createdAt).toLocaleString()}</p>
                  </div>
                </li>
              ))}
              {(order.events ?? []).length === 0 && <li className="text-[13px] text-muted-strong">No history yet.</li>}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Customer">
            <p className="font-semibold text-ink">{order.fullName}</p>
            <p className="text-[13px] text-ink/80">{order.phone}</p>
            {order.email && <p className="text-[13px] text-ink/80">{order.email}</p>}
            <p className="mt-2 text-[13px] text-ink/80">{[order.address, order.city, order.area].filter(Boolean).join(", ") || "No address given"}</p>
            {order.notes && <p className="mt-2 rounded-lg bg-soft px-3 py-2 text-[13px] text-ink/70">“{order.notes}”</p>}

            {/* WhatsApp is the fulfilment channel — never render a link that would 404 */}
            {waOk ? (
              <a href={waLink(wa, `Hi ${order.fullName}, this is TulipGlam about your order ${order.number}.`)} target="_blank" rel="noreferrer"
                className="btn btn-cta focus-ring mt-3 w-full bg-[#25D366] py-2.5 text-white hover:brightness-95">
                <WhatsAppIcon className="h-4 w-4" /> Message on WhatsApp
              </a>
            ) : (
              <>
                <button type="button" disabled aria-describedby="wa-help"
                  className="btn btn-cta mt-3 w-full cursor-not-allowed bg-soft py-2.5 text-muted-strong">
                  <WhatsAppIcon className="h-4 w-4" /> Message on WhatsApp
                </button>
                <p id="wa-help" className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-sale">
                  <AlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                  Your store WhatsApp number is missing or a placeholder, so this would open a dead link. Set it in Settings.
                </p>
              </>
            )}
          </Card>

          <Card title="Update status">
            {terminal ? (
              <p className="text-[13px] text-muted-strong">
                <strong className="text-ink">{label(order.status)}</strong> is final — this order cannot change again.
              </p>
            ) : (
              <>
                <Combobox value={newStatus} onChange={setNewStatus} options={statusOptions} ariaLabel="New order status" buttonClassName="py-2.5" />
                <p className="mt-1.5 text-[11px] text-muted-strong">
                  Only the moves that make sense from {label(order.status)} are listed. The server rejects the rest.
                </p>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional, saved to history)"
                  aria-label="Status change note" className="field focus-ring mt-2" />
                <button onClick={update} disabled={busy || newStatus === order.status} className="btn btn-ink focus-ring mt-3 w-full py-3">
                  {busy ? "Updating…" : "Update"}
                </button>
              </>
            )}

            {order.status !== "awaiting_customer" && !terminal && (
              <button onClick={() => setAsking(true)} className="btn btn-ghost focus-ring mt-2 w-full py-2.5 text-[12px]">
                Can’t source an item — ask the customer
              </button>
            )}
          </Card>
        </div>
      </div>

      {/* ---------------- ask the customer ---------------- */}
      {asking && (
        <ConfirmDialog title="Which item can’t you source?" confirmLabel="Ask the customer" busy={busy}
          onCancel={() => setAsking(false)} onConfirm={ask}>
          <p>This moves the order to <strong className="text-ink">Awaiting your confirmation</strong> and records what you asked.</p>
          <div className="pt-1">
            <span className="mb-1 block text-[12px] font-medium text-ink/70">Item</span>
            <Combobox value={askItem} onChange={setAskItem} ariaLabel="Item that cannot be sourced" buttonClassName="py-2.5"
              options={[{ value: "", label: "Choose…" }, ...order.items.map((i: AdminOrderItem) => ({ value: String(i.id), label: `${i.name}${i.variantLabel ? ` · ${i.variantLabel}` : ""}` }))]} />
          </div>
          <div className="pt-1">
            <span className="mb-1 block text-[12px] font-medium text-ink/70">What did you ask them?</span>
            <textarea value={askNote} onChange={(e) => setAskNote(e.target.value)} rows={3}
              placeholder="e.g. Offered the 100ml instead of the 50ml, or asked whether to drop it."
              className="field focus-ring resize-none" />
            <span className="mt-1 block text-[11px] text-muted-strong">Required — it is shown on the order and in the history.</span>
          </div>
        </ConfirmDialog>
      )}

      {/* ---------------- resolution confirmations ---------------- */}
      {resolving === "accept" && (
        <ConfirmDialog title="Customer accepted a substitute?" confirmLabel="Confirm order" busy={busy}
          onCancel={() => setResolving(null)} onConfirm={() => resolve("accept")}>
          <p>The order moves to <strong className="text-ink">Confirmed</strong> and the total stays as it is.</p>
          <p className="text-muted-strong">Use this when the customer took an alternative at the same price. If the price differs, edit the order after confirming.</p>
        </ConfirmDialog>
      )}
      {resolving === "remove" && blocked && (
        <ConfirmDialog title={`Remove “${blocked.name}”?`} confirmLabel="Remove and recalculate" destructive busy={busy}
          onCancel={() => setResolving(null)} onConfirm={() => resolve("remove")}>
          <p>The line is dropped and the order moves to <strong className="text-ink">Confirmed</strong>.</p>
          <p>
            Subtotal, delivery, the coupon and the gift card are all recalculated on the server — removing{" "}
            {money(blocked.priceCents * blocked.qty)} may push the order back under the{" "}
            {money(order.context.freeDeliveryThresholdCents)} free-delivery threshold, or below a coupon’s minimum.
          </p>
        </ConfirmDialog>
      )}
      {resolving === "cancel" && (
        <ConfirmDialog title="Cancel this order?" confirmLabel="Cancel order" destructive busy={busy}
          onCancel={() => setResolving(null)} onConfirm={() => resolve("cancel")}>
          <p><strong className="text-ink">Cancelled</strong> is final — the order cannot be reopened afterwards.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted-strong">{title}</h2>
      {children}
    </div>
  );
}

function Money({ label, value, tone }: { label: string; value: string; tone?: "ok" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-strong">{label}</dt>
      <dd className={`num-tabular shrink-0 ${tone === "ok" ? "text-ok" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
