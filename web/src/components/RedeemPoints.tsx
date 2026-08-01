import { useEffect, useState } from "react";
import { api, usd, type Rewards } from "../lib/api";
import { StarIcon } from "./ui";

/**
 * Spending points at checkout.
 *
 * ── IT DOES NOT EXIST WHILE THE FLAG IS OFF ────────────────────────────────────────
 *
 * The caller renders this only when the server says `redemptionEnabled`, and if it somehow got
 * mounted anyway it returns null before drawing anything. No greyed-out panel, no "coming soon",
 * no disabled slider with a tooltip — a promise a customer can see is a promise with a date on
 * it, and there is no date.
 *
 * ── AND IT IS NOT WHERE THE MONEY IS DECIDED ───────────────────────────────────────
 *
 * Everything here is a preview. The order endpoint re-quotes the redemption inside the same
 * transaction that creates the order, against a basket it prices itself — because the number
 * this component sends came from a browser, and the 50% cap depends on a basket the browser can
 * change after the quote was issued. If the two disagree the order refuses rather than shipping
 * a wrong price.
 */
export function RedeemPoints({
  rewards,
  merchandiseCents,
  points,
  onChange,
}: {
  rewards: Rewards | null;
  /** Goods after any coupon — the figure the cap is measured against. */
  merchandiseCents: number;
  points: number;
  onChange: (points: number) => void;
}) {
  const [max, setMax] = useState(0);
  const [note, setNote] = useState("");
  const [cents, setCents] = useState(0);

  const enabled = !!rewards?.redemptionEnabled && !!rewards.linked && rewards.available > 0;

  useEffect(() => {
    if (!enabled) { setMax(0); return; }
    let live = true;
    // A failed preview leaves the panel showing nothing rather than an error: this is an
    // optional discount, and checkout must never be blocked by it.
    api.redeemPreview(merchandiseCents, points)
      .then((q) => {
        if (!live) return;
        setMax(q.maxPoints);
        setCents(q.ok ? q.cents : 0);
        setNote(q.ok ? "" : (q.detail ?? ""));
      })
      .catch(() => { if (live) { setMax(0); setNote(""); } });
    return () => { live = false; };
  }, [enabled, merchandiseCents, points]);

  if (!enabled || max <= 0) return null;

  const step = 100; // points are spent in blocks; the server rounds down to one anyway
  const applied = points > 0 && cents > 0;

  return (
    <fieldset className="rounded-2xl border border-line bg-plum-soft/40 p-4">
      <legend className="flex items-center gap-1.5 px-1 text-[13px] font-semibold text-plum">
        <StarIcon className="h-3.5 w-3.5" /> Your points
      </legend>

      <p className="text-[13px] text-ink">
        You have <b>{rewards!.availableLabel}</b>. You can use up to <b>{max.toLocaleString()}</b> on this order
        {max > 0 && <> — worth <b>{usd(Math.floor(max / step) * 300)}</b></>}.
      </p>

      <div className="mt-3 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={max}
          step={step}
          value={Math.min(points, max)}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Points to use on this order"
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-soft accent-plum"
        />
        <button
          type="button"
          onClick={() => onChange(applied ? 0 : max)}
          className="shrink-0 rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-plum hover:text-plum"
        >
          {applied ? "Clear" : "Use all"}
        </button>
      </div>

      <p className="mt-2 text-[13px] text-ink">
        {applied
          ? <>Using <b>{Math.min(points, max).toLocaleString()} points</b> — <b className="text-plum">−{usd(cents)}</b> off your items.</>
          : <span className="text-muted">Slide to use your points on this order.</span>}
      </p>

      {note && <p className="mt-1 text-[12px] text-muted">{note}</p>}

      {/* The one rule a customer will otherwise discover by being surprised at the door. */}
      <p className="mt-2 text-[12px] text-muted">
        Points come off the items, not the delivery fee. You pay the rest in cash on delivery.
      </p>
    </fieldset>
  );
}
