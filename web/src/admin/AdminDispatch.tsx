import { useEffect, useState } from "react";
import { adminApi, type DispatchLine, type Manifest } from "./adminApi";
import { Spinner, TruckIcon, WhatsAppIcon, CheckIcon } from "../components/ui";
import { useToast } from "./primitives/Toast";

/**
 * Dispatch — what the driver collects.
 *
 * ── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────────────
 *
 * There is no courier integration. Until now the only artefact carrying an order total to a
 * human was a WhatsApp message the CUSTOMER composed at checkout — so the shop had nothing of
 * its own to hand a driver. That was survivable while every order was "goods plus delivery".
 * It stops being survivable the moment points are spendable: a $60 order with 300 points
 * redeemed is $51 at the door, and nothing on the parcel would say so.
 *
 * ── IT DOES NOT PICK A PROCESS ─────────────────────────────────────────────────────
 *
 * Which channel to use is the owner's decision and depends on the courier. This screen makes
 * every likely answer easy from the same figures: print a note for the parcel, print the day's
 * run for the driver, or copy a message to send. Whatever gets chosen, the amount is already
 * correct and comes from one place.
 */
export function AdminDispatch() {
  const { push } = useToast();
  const [data, setData] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    adminApi.dispatch()
      .then((d) => { if (live) setData(d); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [attempt]);

  if (error) return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <p className="text-[14px] text-ink">Couldn’t load dispatch: {error}</p>
      <button onClick={() => setAttempt((n) => n + 1)} className="btn btn-ghost mt-3 px-4 py-2 text-[13px]">Try again</button>
    </div>
  );
  if (!data) return <div className="grid place-items-center py-16 text-plum"><Spinner /></div>;

  const runs = data.outForDelivery;

  return (
    <div className="space-y-6">
      {/* print:hidden — everything in this block is for the operator, not for the driver */}
      <div className="print:hidden">
        <h1 className="serif text-2xl text-ink">Dispatch</h1>
        <p className="text-[13px] text-muted">
          What to collect at each door. Print the run for the driver, print a note for the parcel, or copy a message.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3 print:hidden">
        <div className="rounded-2xl border border-plum/30 bg-plum-soft/40 p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-plum">Cash expected back</p>
          <p className="serif mt-1 text-2xl text-ink">{data.expectedCashLabel}</p>
          <p className="mt-1 text-[12px] text-muted">
            across {runs.length} order{runs.length === 1 ? "" : "s"} out for delivery
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Being prepared</p>
          <p className="serif mt-1 text-2xl text-ink">{data.preparing.length}</p>
          <p className="mt-1 text-[12px] text-muted">confirmed or sourcing, not yet packed</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Carry a discount</p>
          <p className="serif mt-1 text-2xl text-ink">{data.discountedCount}</p>
          {/* The number that matters most on this screen: these are the doors where a driver
              would otherwise collect the wrong amount. */}
          <p className="mt-1 text-[12px] text-muted">
            {data.discountedCount > 0
              ? "the amount is not what the bag looks worth — the note says why"
              : "every order is goods plus delivery today"}
          </p>
        </div>
      </section>

      {runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong p-10 text-center print:hidden">
          <TruckIcon className="mx-auto h-8 w-8 text-plum/50" />
          <p className="serif mt-3 text-xl text-ink">Nothing out for delivery</p>
          <p className="mt-1 text-[13px] text-muted">Orders appear here once they are packed, dispatched or out for delivery.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Today’s run</h2>
            <button onClick={() => window.print()} className="btn btn-primary px-5 py-2.5 text-[13px]">Print the run</button>
          </div>

          {/* The printed sheet. Kept as one table so it survives a page break intact. */}
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface print:border-0">
            <div className="hidden print:block px-4 pt-4">
              <p className="serif text-xl text-ink">TulipGlam — delivery run</p>
              <p className="text-[12px] text-muted">
                {new Date(data.generatedAt).toLocaleString("en-GB")} · {runs.length} orders · collect {data.expectedCashLabel} in total
              </p>
            </div>
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Order</th>
                  <th className="px-4 py-2.5 font-semibold">Deliver to</th>
                  <th className="px-4 py-2.5 font-semibold">Where</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Collect</th>
                  <th className="px-4 py-2.5 font-semibold print:hidden">Send</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.map((o) => <Row key={o.id} o={o} onCopied={() => push("ok", "Message copied")} />)}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data.preparing.length > 0 && (
        <section className="print:hidden">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Being prepared</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {data.preparing.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">{o.number} · {o.fullName}</p>
                  <p className="truncate text-[12px] text-muted">{o.statusLabel} · {o.area || o.city}</p>
                </div>
                <span className="shrink-0 tabular text-[13px] text-muted">{o.collectLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Screen-only. Printing a run should not print an explanation to the operator. */}
      <p className="text-[12px] leading-relaxed text-muted print:hidden">
        The collect amount is the order total exactly as checkout worked it out — coupon, points,
        gift card and delivery already applied. It is never recalculated here, because a second
        calculation on the way to the door is how a driver ends up holding a different number from
        the customer.
      </p>
    </div>
  );
}

function Row({ o, onCopied }: { o: DispatchLine; onCopied: () => void }) {
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const copy = async () => {
    try {
      const full = msg ?? (await adminApi.dispatchOne(o.id)).courierMessage;
      setMsg(full);
      await navigator.clipboard.writeText(full);
      setCopied(true);
      onCopied();
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard refused — the printed note is the fallback */ }
  };

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-medium text-ink">{o.number}</p>
        <p className="text-[11px] text-muted">{o.itemCount} item{o.itemCount === 1 ? "" : "s"} · {o.statusLabel}</p>
      </td>
      <td className="px-4 py-3">
        <p className="text-ink">{o.fullName}</p>
        <p className="text-[12px] text-muted">{o.phone}</p>
      </td>
      <td className="px-4 py-3">
        <p className="text-ink">{[o.address, o.city].filter(Boolean).join(", ")}</p>
        <p className="text-[12px] text-muted">{o.area}</p>
        {o.notes && <p className="mt-0.5 text-[12px] text-plum">Note: {o.notes}</p>}
      </td>
      <td className="px-4 py-3 text-right">
        <p className="serif text-[17px] font-medium tabular text-ink">{o.collectLabel}</p>
        {/* Always printed. A driver holding a $60 bag and asked for $51 needs the reason on
            the sheet, or they assume a mistake and collect $60. */}
        <p className="text-[11px] leading-tight text-muted">{o.whyDifferent}</p>
      </td>
      <td className="px-4 py-3 print:hidden">
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-plum hover:text-plum"
        >
          {copied ? <CheckIcon className="h-3.5 w-3.5 text-plum" /> : <WhatsAppIcon className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </td>
    </tr>
  );
}
