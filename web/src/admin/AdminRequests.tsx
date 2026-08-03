import { useEffect, useState } from "react";
import { adminApi, type ProductRequestRow, type RequestSummary } from "./adminApi";
import { Spinner, WhatsAppIcon } from "../components/ui";
import { useToast } from "./primitives/Toast";

/**
 * What customers asked for and the shop does not carry.
 *
 * For a business that holds no inventory, this is the most valuable list in the admin: it is the
 * catalogue's gaps, written by the people who wanted them, with a phone number attached to each.
 *
 * ── ORDERED BY AGE, NOT BY ARRIVAL ─────────────────────────────────────────────────
 *
 * Open requests first and oldest-open most prominent, because the failure mode here is not
 * losing a request — it is answering the newest one repeatedly while somebody from three weeks
 * ago is still waiting. The summary leads with the age of the oldest open request for the same
 * reason.
 *
 * ── THE REPLY IS ONE TAP ───────────────────────────────────────────────────────────
 *
 * Every row opens WhatsApp with the customer's number and a message already written naming what
 * they asked for. The shop runs on WhatsApp and the whole promise made on the request form is
 * "we'll message you either way" — so the reply has to be the easiest thing on the screen, or
 * that promise quietly stops being kept.
 */
export function AdminRequests() {
  const { push } = useToast();
  const [data, setData] = useState<{ requests: ProductRequestRow[]; summary: RequestSummary } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "sourced" | "declined" | "all">("open");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    adminApi.productRequests(filter)
      .then((d) => { if (live) setData(d); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [filter, attempt]);

  const setStatus = async (id: number, status: string) => {
    try {
      await adminApi.updateProductRequest(id, { status });
      push("ok", status === "sourced" ? "Marked as sourced" : status === "declined" ? "Marked as declined" : "Reopened");
      setAttempt((n) => n + 1);
    } catch (e) {
      push("error", (e as Error).message);
    }
  };

  if (error) return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <p className="text-[14px] text-ink">Couldn’t load requests: {error}</p>
      <button onClick={() => setAttempt((n) => n + 1)} className="btn btn-ghost mt-3 px-4 py-2 text-[13px]">Try again</button>
    </div>
  );
  if (!data) return <div className="grid place-items-center py-16 text-plum"><Spinner /></div>;

  const { requests, summary } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="serif text-2xl text-ink">Product requests</h1>
        <p className="text-[13px] text-muted">What people asked for that we don’t carry.</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-plum/30 bg-plum-soft/40 p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-plum">Waiting on you</p>
          <p className="serif mt-1 text-2xl text-ink">{summary.open}</p>
          {/* The number that actually matters: not how many are open, but how long the oldest
              person has been waiting for the reply they were promised. */}
          <p className="mt-1 text-[12px] text-muted">
            {summary.oldestOpenDays === null
              ? "nothing outstanding"
              : summary.oldestOpenDays === 0
                ? "oldest came in today"
                : `oldest has waited ${summary.oldestOpenDays} day${summary.oldestOpenDays === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Sourced</p>
          <p className="serif mt-1 text-2xl text-ink">{summary.sourced}</p>
          <p className="mt-1 text-[12px] text-muted">found and listed or ordered</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Declined</p>
          <p className="serif mt-1 text-2xl text-ink">{summary.declined}</p>
          <p className="mt-1 text-[12px] text-muted">kept, so the reason survives</p>
        </div>
      </section>

      {summary.topTerms.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Asked for more than once</p>
          {/* A buying signal. Two people asking for the same brand is worth more than a hundred
              page views on a product that does not exist yet. */}
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.topTerms.map((t) => (
              <span key={t.term} className="chip">{t.term} <span className="text-muted">×{t.count}</span></span>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {(["open", "sourced", "declined", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`chip ${filter === f ? "chip-on" : ""}`}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong p-10 text-center">
          <p className="serif text-xl text-ink">Nothing here</p>
          <p className="mt-1 text-[13px] text-muted">
            {filter === "open" ? "No requests waiting. " : ""}
            Requests arrive from an empty search, the request page and dead product links.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-ink">{r.wanted}</p>
                  {r.note && <p className="mt-1 text-[13px] leading-snug text-muted">{r.note}</p>}
                  <p className="mt-1.5 text-[12px] text-muted">
                    {new Date(r.createdAt).toLocaleDateString("en-GB")} · {r.phone}
                    {r.email ? ` · ${r.email}` : ""}
                    {r.customer ? ` · account: ${r.customer.fullName || r.customer.email}` : ""}
                  </p>
                  {/* Where it came from, so the owner can see which entry point earns requests
                      rather than which one felt right to build. */}
                  <p className="mt-1 text-[11px] uppercase tracking-wide text-muted">
                    via {r.source}{r.searchTerm ? ` — searched “${r.searchTerm}”` : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                  r.status === "open" ? "bg-warn-soft text-warn ring-1 ring-inset ring-warn-line"
                    : r.status === "sourced" ? "bg-plum-soft text-plum"
                      : "bg-soft text-muted ring-1 ring-inset ring-line-strong"
                }`}>
                  {r.status}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                <a
                  href={`https://wa.me/${r.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                    `Hi! You asked us about "${r.wanted}" on TulipGlam — `,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3.5 py-1.5 text-[12px] font-semibold text-ink hover:border-plum hover:text-plum"
                >
                  <WhatsAppIcon className="h-3.5 w-3.5" /> Reply
                </a>
                {r.status !== "sourced" && (
                  <button onClick={() => setStatus(r.id, "sourced")} className="btn btn-ghost px-3.5 py-1.5 text-[12px]">Sourced</button>
                )}
                {r.status !== "declined" && (
                  <button onClick={() => setStatus(r.id, "declined")} className="btn btn-ghost px-3.5 py-1.5 text-[12px]">Can’t get it</button>
                )}
                {r.status !== "open" && (
                  <button onClick={() => setStatus(r.id, "open")} className="btn btn-ghost px-3.5 py-1.5 text-[12px]">Reopen</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
