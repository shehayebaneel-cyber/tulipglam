import { useState } from "react";
import { usd, waLink } from "../lib/api";
import { useStore } from "../lib/store";
import { TulipMark, WhatsAppIcon } from "../components/ui";

const AMOUNTS = [2500, 5000, 7500, 10000, 15000];

export function GiftCards() {
  const { site } = useStore();
  const [amount, setAmount] = useState(5000);
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  const [msg, setMsg] = useState("");
  const wa = site?.settings.whatsappNumber ?? "";

  const order = () => {
    const text = `Hi TulipGlam! I'd like to buy a gift card.\n\nAmount: ${usd(amount)}\nTo: ${to || "—"}\nFrom: ${from || "—"}\nMessage: ${msg || "—"}`;
    if (wa) window.open(waLink(wa, text), "_blank");
  };

  return (
    <div className="wrap py-6 sm:py-8">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        {/* preview */}
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="eyebrow">Digital gift cards</p>
          <h1 className="serif mt-2 text-3xl font-medium leading-tight text-ink sm:text-4xl">Give the gift of glow</h1>
          <p className="mt-3 max-w-md text-[15px] text-muted">A TulipGlam gift card lets them choose exactly what they love. Delivered by WhatsApp or email, redeemable at checkout.</p>
          <div className="mt-6 grid place-items-center">
            <div className="relative w-full max-w-sm rotate-[-3deg] rounded-3xl bg-gradient-to-br from-plum to-plum-dark p-7 text-white shadow-pop">
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
            {AMOUNTS.map((a) => (
              <button key={a} onClick={() => setAmount(a)} className={`rounded-xl border py-3 text-[15px] font-semibold tabular transition ${amount === a ? "border-plum bg-plum-soft text-plum" : "border-line-strong text-ink/80 hover:border-ink"}`}>{usd(a)}</button>
            ))}
          </div>
          <div className="mt-5 grid gap-3">
            <input placeholder="Recipient's name" value={to} onChange={(e) => setTo(e.target.value)} className="field" />
            <input placeholder="Your name" value={from} onChange={(e) => setFrom(e.target.value)} className="field" />
            <textarea placeholder="Add a message (optional)" value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} className="field resize-none" />
          </div>
          <button onClick={order} className="btn btn-cta mt-5 w-full bg-[#25D366] py-3.5 text-white hover:brightness-95">
            <span className="inline-flex items-center gap-2"><WhatsAppIcon className="h-5 w-5" /> Order gift card on WhatsApp</span>
          </button>
          <p className="mt-3 text-center text-[12px] text-muted">We’ll arrange payment and send the card to your recipient.</p>
        </div>
      </div>
    </div>
  );
}
