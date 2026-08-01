import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ButtonLink } from "../components/Button";
import { api, type Rewards as RewardsData } from "../lib/api";
import { useStore } from "../lib/store";
import { ErrorState } from "../components/ErrorState";
import { Spinner, StarIcon, TruckIcon, CheckIcon, GiftIcon } from "../components/ui";

/**
 * TulipGlam Rewards.
 *
 * ── THIS COMPONENT DOES NO ARITHMETIC ──────────────────────────────────────────────
 *
 * Every figure, label, percentage and date comes off the payload already formatted. There is no
 * division, no threshold, no rate and no date formatting below. If something needs calculating,
 * it is calculated in `server/src/loyalty/present.ts` — a second implementation in JSX would
 * drift from the ledger the first time a rate changed, and would do it silently.
 *
 * ── AND IT NEVER MENTIONS REDEEMING WHILE THE FLAG IS OFF ──────────────────────────
 *
 * Not greyed out, not "coming soon", not a disabled button with a tooltip. Absent. A visible
 * dead feature is a promise with a date nobody has set, and the date this one needs depends on
 * a change to how the courier is told what to collect — which is a process, not a deploy.
 */
export function Rewards() {
  const { customer, authReady, site } = useStore();
  const navigate = useNavigate();
  const [data, setData] = useState<RewardsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A counter rather than a second copy of the fetch. The retry handler used to re-implement
  // the effect body without its cancellation guard, so tapping "Try again" and navigating away
  // set state on an unmounted component — and a retry that succeeded never cleared the error.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { if (authReady && !customer) navigate("/login", { state: { from: "/rewards" } }); }, [authReady, customer, navigate]);

  // The programme can be switched off while somebody is holding a bookmark or a shared link.
  // The Account card is already hidden, but the route is registered unconditionally, so without
  // this the page renders a rewards-shaped error for a programme that does not exist.
  useEffect(() => { if (site && !site.flags.loyalty) navigate("/account", { replace: true }); }, [site, navigate]);

  useEffect(() => {
    if (!customer) return;
    let live = true;
    setError(null);
    api.rewards()
      .then((r) => { if (live) { setData(r); setError(null); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [customer, attempt]);

  if (!authReady || !customer) return <div className="grid min-h-[60vh] place-items-center text-plum"><Spinner /></div>;
  if (error) return (
    <div className="wrap py-10">
      <ErrorState
        title="We couldn’t load your rewards"
        detail={error}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    </div>
  );
  if (!data) return <div className="grid min-h-[60vh] place-items-center text-plum"><Spinner /></div>;

  return (
    <div className="wrap py-6 sm:py-8">
      <header>
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-plum">TulipGlam Rewards</p>
        <h1 className="serif mt-1 text-2xl font-medium text-ink sm:text-3xl">
          {data.linked && data.available > 0
            ? `You have ${data.availableLabel} points`
            : `Earn points on everything you order`}
        </h1>
        <p className="mt-1 text-[13px] text-muted">{data.earnRateLabel}. No card, no sign-up — it starts with your next order.</p>
      </header>

      <Balances data={data} />
      <TierPanel data={data} />
      <Facts data={data} />
      <History data={data} />
    </div>
  );
}

/**
 * Available and pending.
 *
 * Deliberately NOT two similar numbers side by side. Available is the headline: large, serif, on
 * the plum surface the site uses for anything that belongs to you. Pending is a quieter row
 * underneath with a dashed edge and its own sentence, because "pending" without an explanation
 * reads as a bug — a customer who ordered yesterday and sees points they cannot spend assumes
 * something is broken rather than that a hold exists.
 */
function Balances({ data }: { data: RewardsData }) {
  return (
    <section className="mt-6">
      {/* Heading, note and expiry sentence are all server-owned strings. While redemption is
          off none of them may imply points can be exchanged for anything, and a rule enforced
          in JSX is a rule enforced by whoever edits this file next. */}
      <div className="rounded-2xl border border-line bg-plum-soft/50 p-5 sm:p-6">
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-plum">{data.availableHeading}</p>
        <p className="serif mt-1 text-4xl font-medium leading-none text-ink sm:text-5xl">{data.availableLabel}</p>
        <p className="mt-1.5 text-[13px] text-muted">{data.availableNote}</p>
        {data.expiryNote && <p className="mt-3 text-[12px] text-muted">{data.expiryNote}</p>}
      </div>

      {data.pending > 0 && (
        <div className="mt-3 rounded-2xl border border-dashed border-line-strong bg-surface p-4 sm:p-5">
          <div className="flex items-baseline gap-2">
            <span className="serif text-2xl font-medium text-muted">{data.pendingLabel}</span>
            <span className="text-[13px] font-semibold text-muted">pending</span>
          </div>
          <p className="mt-1 text-[13px] text-muted">{data.pendingNote}</p>
        </div>
      )}
    </section>
  );
}

/** The tier in force, its perks, and how far the next one is. `percent` is server-computed. */
function TierPanel({ data }: { data: RewardsData }) {
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-plum-soft text-plum"><StarIcon className="h-4 w-4" /></span>
          <div>
            <p className="serif text-xl text-ink">{data.tier.label}</p>
            <p className="text-[12px] text-muted">Your tier</p>
          </div>
        </div>
        <p className="text-[13px] text-muted">{data.spendLabel} in the last 12 months</p>
      </div>

      <ul className="mt-4 space-y-1.5">
        {data.tier.perks.map((perk) => (
          <li key={perk} className="flex items-start gap-2 text-[14px] text-ink">
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-plum" />
            <span>{perk}</span>
          </li>
        ))}
      </ul>

      {data.next && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-semibold text-ink">{data.next.toGoLabel} to {data.next.label}</p>
            <p className="text-[12px] text-muted">{data.next.multiplierLabel} points</p>
          </div>
          {/* A plain div, not a progress-bar component — the site has no such primitive and this
              does not need one. `percent` arrives already clamped and floored from the server.
              role="progressbar" rather than "presentation": the proportion is real information,
              and marking it decorative left a screen-reader user with the sentence above and
              nothing else. */}
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft"
            role="progressbar"
            aria-valuenow={data.next.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progress to ${data.next.label}`}
          >
            <div className="h-full rounded-full bg-plum transition-[width]" style={{ width: `${data.next.percent}%` }} />
          </div>
          <p className="mt-2 text-[12px] text-muted">Tiers are based on what you spend over 12 months, and last a full year once earned.</p>
        </div>
      )}
    </section>
  );
}

/**
 * The three sentences.
 *
 * Prominent by design, not fine print. Each one exists because the behaviour behind it is
 * surprising if unexplained: the week-long hold, the rate locked at checkout, and a new tier
 * starting with the next order rather than the one that earned it. The copy is server-side so
 * that the promise and the code that keeps it ship together.
 */
function Facts({ data }: { data: RewardsData }) {
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="serif text-lg text-ink">How it works</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {data.facts.map((f) => (
          <div key={f.key}>
            <p className="text-[14px] font-semibold leading-snug text-ink">{f.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** History in the customer's language. Every label is translated server-side. */
function History({ data }: { data: RewardsData }) {
  if (data.history.length === 0) {
    return (
      <section className="mt-4 rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center">
        <GiftIcon className="mx-auto h-8 w-8 text-plum/60" />
        <p className="serif mt-3 text-xl text-ink">Nothing here yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
          Your points will show up here the moment you place an order — one for every dollar of items, confirmed a week after the parcel arrives.
        </p>
        <ButtonLink to="/shop" variant="primary" className="mt-5">Start shopping</ButtonLink>
      </section>
    );
  }

  return (
    <section className="mt-4">
      <h2 className="serif text-lg text-ink">Your points</h2>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {data.history.map((h) => (
          <li key={h.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium text-ink">{h.title}</p>
              <p className="mt-0.5 text-[12px] text-muted">
                {h.atLabel}{h.detail ? ` · ${h.detail}` : ""}
              </p>
            </div>
            <span
              className={`shrink-0 text-[14px] font-semibold tabular-nums ${
                h.tone === "waiting" ? "text-muted" : h.tone === "debit" ? "text-ink" : "text-plum"
              }`}
            >
              {h.pointsLabel}
            </span>
          </li>
        ))}
      </ul>
      {data.historyTruncated && (
        <p className="mt-2 text-[12px] text-muted">Showing your most recent activity.</p>
      )}
      <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-muted">
        <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-plum/60" />
        <span>Points are worked out on the items in your order, after any discount, and not on delivery.</span>
      </p>
    </section>
  );
}
