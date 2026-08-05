import { useEffect, useState } from "react";
import { adminApi, type ErrorRow, type LaunchList, type OutboxStatus, type Pulse } from "./adminApi";
import { Spinner, UsersIcon, ChatIcon, CheckIcon } from "../components/ui";
import { useToast } from "./primitives/Toast";
import { money, relativeTime } from "./primitives/format";

/** 44px for anything a thumb presses; the denser admin scale returns above `sm`. */
const TAP = "min-h-[44px] sm:min-h-0";

/**
 * What is happening on the store.
 *
 * ── NOTHING HERE COMES FROM A TRACKER ──────────────────────────────────────────────
 *
 * No analytics snippet, no session cookie, no per-visitor identifier, nothing loaded from
 * another domain. Every figure is measured server-side from data the store already holds. That
 * costs real capability — there is no bounce rate, no funnel, no idea what people looked at and
 * did not buy — and it buys a storefront that ships nothing to anyone else.
 *
 * The panel that matters most is Errors. A 500 in production used to be invisible: the message
 * a customer sees says nothing, and Render's free-tier log window is short and unread. So the
 * first person to know was the customer. Now it is here.
 */
export function AdminPulse() {
  const { push } = useToast();
  const [p, setP] = useState<Pulse | null>(null);
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [list, setList] = useState<LaunchList | null>(null);
  const [outbox, setOutbox] = useState<OutboxStatus | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    // Sequential, not Promise.all. Neon's free tier has a small connection ceiling and a
    // dashboard that fans out concurrent queries intermittently 500s — which is exactly how
    // the launch-list panel failed the first time it was built.
    (async () => {
      try {
        const a = await adminApi.pulse(); if (!live) return; setP(a);
        const b = await adminApi.errors(); if (!live) return; setErrors(b.errors);
        const c = await adminApi.launchList(); if (!live) return; setList(c);
        const d = await adminApi.outbox(); if (!live) return; setOutbox(d);
      } catch { /* panels render what they have */ }
    })();
    return () => { live = false; };
  }, [reload]);

  if (!p) return <div className="grid place-items-center py-16 text-plum"><Spinner /></div>;

  const open = errors.filter((e) => !e.resolvedAt);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="serif text-2xl text-ink">What’s happening</h1>
        <p className="text-[13px] text-muted">
          Measured on the server. No tracker on the storefront, no third party, nothing that needs a cookie banner.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders today" value={String(p.ordersToday)} note={`${p.ordersWeek} in the last 7 days`} />
        <Stat label="Taken today" value={money(p.revenueTodayCents)} note="cash on delivery, once collected" />
        <Stat label="Launch signups" value={String(p.signupsTotal)} note={`${p.signupsToday} today`} />
        <Stat
          label="Open errors"
          value={String(p.openErrors)}
          note={p.openErrors > 0 ? "something is broken — see below" : "nothing broken since the last deploy"}
          tone={p.openErrors > 0 ? "bad" : "ok"}
        />
      </section>

      {/* ── errors ── */}
      <section className="rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Errors</h2>
            <p className="text-[12px] text-muted">Grouped by what broke, not by how often — one row per distinct problem.</p>
          </div>
          <button onClick={() => setReload((n) => n + 1)} className={`btn btn-ghost shrink-0 px-4 text-[13px] sm:px-3 sm:py-1.5 sm:text-[12px] ${TAP}`}>Refresh</button>
        </div>
        {errors.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted sm:px-5">
            Nothing has thrown. This stays empty until something does.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {errors.slice(0, 12).map((e) => (
              <li key={e.id} className={`px-4 py-3 sm:px-5 ${e.resolvedAt ? "opacity-50" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-[13px] font-medium text-ink">
                      <span className="text-muted">{e.method}</span> {e.path}
                    </p>
                    <p className="mt-0.5 break-words text-[13px] leading-snug text-sale sm:text-[12px]">{e.message}</p>
                    <p className="mt-1 text-[11px] text-muted">
                      {e.count}× · first {relativeTime(e.firstSeen)} · last {relativeTime(e.lastSeen)}
                    </p>
                  </div>
                  {/* Full-width footer on a phone, inline pill from sm up. A 30px pill wedged
                      beside a wrapping stack trace is a target that has to be aimed at. */}
                  {!e.resolvedAt && (
                    <button
                      onClick={async () => {
                        try { await adminApi.resolveError(e.id); push("ok", "Marked as dealt with"); setReload((n) => n + 1); }
                        catch (err) { push("error", (err as Error).message); }
                      }}
                      className={`w-full shrink-0 rounded-full border border-line-strong px-4 text-[13px] font-semibold hover:border-plum hover:text-plum sm:w-auto sm:px-3 sm:py-1.5 sm:text-[12px] ${TAP}`}
                    >Dealt with</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {open.length > 0 && (
          <p className="border-t border-line px-4 py-2.5 text-[11px] text-muted sm:px-5">
            Marking one as dealt with hides it. If it happens again it reopens itself.
          </p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── launch list ── */}
        <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">
                <UsersIcon className="h-4 w-4" /> Launch list
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">People who left an email on the coming-soon page.</p>
            </div>
            {list && list.total > 0 && (
              /**
               * Fetched and downloaded as a blob, NOT a plain <a href>.
               *
               * A link would have to carry the admin key as a query parameter, which puts it in
               * Render's access logs, the browser's history and any Referer header. Fetching
               * lets it stay in a header where it belongs. The cost is a few lines here; the
               * alternative is a leaked admin key.
               */
              <button
                onClick={async () => {
                  try {
                    const { blob, filename } = await adminApi.launchListCsv();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url; a.download = filename;
                    document.body.appendChild(a); a.click(); a.remove();
                    URL.revokeObjectURL(url);
                  } catch (e) { push("error", (e as Error).message); }
                }}
                className={`shrink-0 rounded-full border border-line-strong px-4 text-[13px] font-semibold hover:border-plum hover:text-plum sm:px-3 sm:py-1.5 sm:text-[12px] ${TAP}`}
              >Export CSV</button>
            )}
          </div>

          {!list ? <div className="py-6 text-center text-muted"><Spinner className="mx-auto h-5 w-5" /></div> : list.total === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-line-strong p-5 text-center text-[13px] text-muted">
              Nobody yet. The form is live on the coming-soon page.
            </p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-x-6 sm:gap-y-1">
                <Tally value={list.subscribed} label="subscribed" />
                <Tally value={list.today} label="today" />
                <Tally value={list.last7} label="this week" />
              </div>
              <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                {list.recent.slice(0, 8).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px] sm:py-2">
                    {/* Wraps on a phone. A clipped address with no title attribute is a value
                        nobody can recover on the device it is clipped on. */}
                    <span className="min-w-0 break-all text-ink sm:truncate">{s.email}</span>
                    <span className="shrink-0 text-[11px] text-muted">{relativeTime(s.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* ── outbox ── */}
        <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">
            <ChatIcon className="h-4 w-4" /> Email
          </h2>
          {!outbox ? <div className="py-6 text-center text-muted"><Spinner className="mx-auto h-5 w-5" /></div> : (
            <>
              <p className="mt-2 text-[13px] text-ink">
                {outbox.configured
                  ? <>SMTP is configured. <b>{outbox.sent}</b> sent, <b>{outbox.waiting}</b> waiting.</>
                  : <>SMTP is <b>not configured</b>, so nothing has been sent — but nothing has been lost either.</>}
              </p>
              <p className="mt-1 text-[13px] text-muted">
                <b className="serif text-[22px] leading-none text-ink sm:text-lg">{outbox.waiting}</b> message{outbox.waiting === 1 ? "" : "s"} queued
                {outbox.oldestWaiting && <> · oldest {relativeTime(outbox.oldestWaiting)}</>}
              </p>
              {outbox.byKind.length > 0 && (
                <ul className="mt-3 space-y-1 text-[13px] text-muted sm:text-[12px]">
                  {outbox.byKind.map((k) => (
                    <li key={k.kind} className="flex justify-between gap-4"><span className="min-w-0 break-words">{k.kind}</span><span className="tabular shrink-0">{k.waiting}</span></li>
                  ))}
                </ul>
              )}
              {outbox.expired > 0 && (
                <p className="mt-3 text-[12px] text-muted">
                  {outbox.expired} went stale and will not be sent — a confirmation arriving weeks after the parcel is worse than none.
                </p>
              )}
              {outbox.configured && outbox.waiting > 0 && (
                <button
                  onClick={async () => {
                    try { const r = await adminApi.flushOutbox(); push("ok", `Sent ${r.sent}`); setReload((n) => n + 1); }
                    catch (e) { push("error", (e as Error).message); }
                  }}
                  className={`btn btn-primary mt-4 w-full px-4 py-2 text-[13px] sm:w-auto ${TAP}`}
                >Send what’s waiting</button>
              )}
            </>
          )}
        </section>
      </div>

      {/* ── traffic ── */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Traffic</h2>
        <p className="mt-0.5 text-[12px] text-muted">
          Counted in the server’s memory. <b>It resets on every deploy and cold start</b>, and on this
          hosting tier that is often — so it answers “is anything happening right now”, not “how many
          visitors did we have in July”.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-8 sm:gap-y-2">
          <Tally value={p.traffic.pageViews} label="page views" />
          <Tally value={p.traffic.apiCalls} label="API calls" />
          <p className="col-span-2 text-[12px] text-muted sm:col-span-1 sm:text-[13px]">since {relativeTime(p.traffic.since)}</p>
        </div>
        {p.traffic.topPaths.length > 0 && (
          <ul className="mt-3 space-y-1 text-[13px] sm:text-[12px]">
            {p.traffic.topPaths.map((t) => (
              <li key={t.path} className="flex justify-between gap-4">
                {/* A path is the identifying detail here — clipped, one row looks like another. */}
                <span className="min-w-0 break-all text-muted sm:truncate">{t.path}</span>
                <span className="tabular shrink-0 text-ink">{t.hits}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * A glance figure. Set at 32px on a phone and back to the desktop scale above `sm`.
 *
 * These four cards are the whole reason the screen gets opened, and on a phone they are one
 * column — so there is nothing competing for the width and no reason for the number to be the
 * same size as the sentence explaining it.
 */
function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "ok" | "bad" }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === "bad" ? "border-sale/40 bg-sale/5" : "border-line bg-surface"}`}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="serif mt-1.5 flex items-center gap-2 text-[32px] leading-none text-ink sm:mt-1 sm:text-2xl">
        {value}
        {tone === "ok" && <CheckIcon className="h-4 w-4 text-plum" />}
      </p>
      <p className="mt-1.5 text-[13px] leading-snug text-muted sm:mt-1 sm:text-[12px]">{note}</p>
    </div>
  );
}

/**
 * The small figures inside a panel — launch list and traffic.
 *
 * Three across on a phone rather than a wrapped inline sentence: at 390px "12 subscribed 3
 * today 9 this week" wraps mid-pair and the numbers stop belonging to their labels.
 */
function Tally({ value, label }: { value: number; label: string }) {
  return (
    <div className="sm:flex sm:items-baseline sm:gap-1.5">
      <p className="serif text-[22px] leading-none text-ink sm:text-lg">{value}</p>
      <p className="mt-1 text-[12px] leading-snug text-muted sm:mt-0 sm:text-[13px]">{label}</p>
    </div>
  );
}
