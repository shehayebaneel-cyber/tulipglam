import { useState } from "react";
import { Link } from "react-router-dom";
import { usd, waHref, WA_UNSET_HELP } from "../lib/api";
import { useStore } from "../lib/store";
import { TulipMark, WhatsAppIcon, CheckIcon, AlertIcon } from "../components/ui";
import { ButtonAnchor } from "../components/Button";

const AMOUNTS = [2500, 5000, 7500, 10000, 15000];

export function GiftCards() {
  const { site } = useStore();
  const [amount, setAmount] = useState(5000);
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  const [msg, setMsg] = useState("");
  const wa = site?.settings.whatsappNumber ?? "";
  const text = `Hi TulipGlam! I'd like to buy a gift card.\n\nAmount: ${usd(amount)}\nTo: ${to || "—"}\nFrom: ${from || "—"}\nMessage: ${msg || "—"}`;
  // "" when the number is missing or a placeholder — the CTA then renders inert instead of
  // opening a wa.me link that goes nowhere.
  const href = waHref(wa, text);

  return (
    <div className="wrap py-6 sm:py-8">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        {/* preview */}
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="eyebrow">Digital gift cards</p>
          <h1 className="serif mt-2 text-3xl font-medium leading-tight text-ink sm:text-4xl">Give the gift of glow</h1>
          <p className="mt-3 max-w-md text-[15px] text-muted">A TulipGlam gift card lets them choose exactly what they love. Delivered by WhatsApp or email, redeemable at checkout.</p>
          <div className="mt-6 grid place-items-center">
            {/* flat plum — the system is gradient-free */}
            <div className="relative w-full max-w-sm rotate-[-3deg] rounded-3xl bg-plum p-7 text-white shadow-pop">
              <div className="flex items-center justify-between">
                <TulipMark className="h-8 w-8 text-white" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70">Gift card</span>
              </div>
              <p className="serif mt-12 text-5xl font-medium tabular">{usd(amount)}</p>
              <p className="mt-1 text-xs text-white/70">TulipGlam · redeemable across the store</p>
              {to && <p className="mt-4 text-[13px] text-white/85">For {to}</p>}
            </div>
          </div>
        </div>

        {/* form */}
        <div className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Choose an amount</h2>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {/* Selected state was a pale pink fill alone, which was easy to miss. Now a plum
                border, the tint, and a checkmark — three signals rather than one. */}
            {AMOUNTS.map((a) => (
              <button
                key={a}
                onClick={() => setAmount(a)}
                aria-pressed={amount === a}
                className={`relative rounded-xl border-2 py-3 text-[15px] font-semibold tabular transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum ${
                  amount === a ? "border-plum bg-plum-soft text-plum" : "border-line-strong text-ink/80 hover:border-ink"
                }`}
              >
                {usd(a)}
                {amount === a && (
                  <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-plum text-white">
                    <CheckIcon className="h-3 w-3" />
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="mt-5 grid gap-3">
            <input placeholder="Recipient's name" value={to} onChange={(e) => setTo(e.target.value)} className="field" />
            <input placeholder="Your name" value={from} onChange={(e) => setFrom(e.target.value)} className="field" />
            <textarea placeholder="Add a message (optional)" value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} className="field resize-none" />
          </div>
          {/* Was WhatsApp green (#25D366) — the loudest element on the site and a colour from
              another company's brand. Plum, with the glyph carrying the channel. */}
          <ButtonAnchor
            href={href}
            variant="primary"
            size="lg"
            full
            uppercase
            className="mt-5"
            title={href ? undefined : WA_UNSET_HELP}
          >
            <WhatsAppIcon className="h-5 w-5" /> Order gift card on WhatsApp
          </ButtonAnchor>

          {!href && (
            <p role="status" className="mt-2 flex items-start gap-1.5 text-[12px] text-sale">
              <AlertIcon className="mt-px h-3.5 w-3.5 shrink-0" /> {WA_UNSET_HELP}
            </p>
          )}

          {/* Was "We'll arrange payment and send the card to your recipient" — vague about a
              money transaction. Spells out the actual flow instead. */}
          <div className="mt-4 rounded-xl bg-soft px-4 py-3 text-[12px] leading-relaxed text-ink/80">
            <p className="font-semibold text-ink">How it works</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>Your details open a WhatsApp message to us — nothing is charged yet.</li>
              <li>We reply to confirm the amount and arrange cash payment on delivery.</li>
              <li>Once paid, we send the recipient their code by WhatsApp or email.</li>
            </ol>
            <p className="mt-2.5 border-t border-line pt-2 text-muted">
              Redeemable only at TulipGlam · can be spent over several orders · non-refundable and
              not exchangeable for cash. <Link to="/gift-card-terms" className="font-semibold text-plum hover:underline">Full terms</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
