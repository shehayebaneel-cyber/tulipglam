import { useLocation, useParams, Link } from "react-router-dom";
import { usd, WA_UNSET_HELP } from "../lib/api";
import { ButtonAnchor, ButtonLink } from "../components/Button";
import { CheckIcon, WhatsAppIcon, ChevronRight } from "../components/ui";
import { TulipMark } from "../components/ui";

export function OrderSuccess() {
  const { number = "" } = useParams();
  const state = (useLocation().state ?? {}) as { wa?: string; total?: number };

  return (
    <div className="wrap grid min-h-[64vh] place-items-center py-14">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ok/10 text-ok">
          <CheckIcon className="h-8 w-8" />
        </div>
        <h1 className="serif mt-5 text-3xl font-medium text-ink sm:text-4xl">Order placed!</h1>
        <p className="mt-2 text-[15px] text-muted">Thank you. Your order <span className="font-semibold text-ink">{number}</span> has been received.</p>

        <div className="mt-6 rounded-2xl border border-line bg-surface p-6 text-left">
          <div className="flex items-center gap-2 text-plum"><TulipMark className="h-5 w-5" /><span className="text-[13px] font-semibold uppercase tracking-[0.14em]">What happens next</span></div>
          <ol className="mt-3 space-y-2.5 text-[14px] text-ink/85">
            <li className="flex gap-2"><span className="font-semibold text-plum">1.</span> We confirm each item is available to source.</li>
            <li className="flex gap-2"><span className="font-semibold text-plum">2.</span> We message you on WhatsApp to confirm your order & delivery.</li>
            <li className="flex gap-2"><span className="font-semibold text-plum">3.</span> Your order is delivered — <strong>pay cash on delivery</strong>{state.total ? ` (${usd(state.total)})` : ""}.</li>
          </ol>
          <p className="mt-3 text-[12px] text-muted">Orders are subject to product availability. If an item is unavailable, we’ll contact you before dispatch.</p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {/* The order is already recorded; this only hands off to WhatsApp. When WhatsApp is
              unconfigured the control is inert and says so, so nobody believes a message went out. */}
          <ButtonAnchor href={state.wa ?? ""} variant="primary" size="lg" uppercase title={state.wa ? undefined : WA_UNSET_HELP}>
            <WhatsAppIcon className="h-5 w-5" /> Confirm on WhatsApp
          </ButtonAnchor>
          <ButtonLink to={`/track/${number}`} variant="secondary" size="lg">Track your order</ButtonLink>
        </div>
        <Link to="/shop" className="mt-5 inline-flex items-center gap-1 text-[13px] font-semibold text-plum hover:gap-1.5">Continue shopping <ChevronRight className="h-4 w-4" /></Link>
      </div>
    </div>
  );
}
