import { usd, waLink } from "../lib/api";
import { useStore } from "../lib/store";
import { WhatsAppIcon, InstagramIcon, TruckIcon, BoxIcon } from "../components/ui";
import { Link } from "react-router-dom";

export function Contact() {
  const { site } = useStore();
  const wa = site?.settings.whatsappNumber ?? "";
  const ig = site?.settings.instagramUrl ?? "";

  return (
    <div className="wrap py-6 sm:py-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="serif text-3xl font-medium text-ink sm:text-4xl">Get in touch</h1>
        <p className="mt-2 text-[15px] text-muted">We’re here to help with orders, product advice and anything else. The fastest way to reach us is WhatsApp.</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {wa && (
            <a href={waLink(wa, "Hi TulipGlam! I have a question.")} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-plum/40">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[#25D366]/10 text-[#25D366]"><WhatsAppIcon className="h-6 w-6" /></span>
              <div><p className="text-[14px] font-semibold text-ink">WhatsApp</p><p className="text-[12px] text-muted">Chat with us directly</p></div>
            </a>
          )}
          {ig && (
            <a href={ig} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-plum/40">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-plum-soft text-plum"><InstagramIcon className="h-6 w-6" /></span>
              <div><p className="text-[14px] font-semibold text-ink">Instagram</p><p className="text-[12px] text-muted">Follow for new arrivals</p></div>
            </a>
          )}
          <Link to="/track" className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-plum/40">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-plum-soft text-plum"><BoxIcon className="h-6 w-6" /></span>
            <div><p className="text-[14px] font-semibold text-ink">Track an order</p><p className="text-[12px] text-muted">Follow your delivery</p></div>
          </Link>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-5">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-plum-soft text-plum"><TruckIcon className="h-6 w-6" /></span>
            <div><p className="text-[14px] font-semibold text-ink">Delivery</p><p className="text-[12px] text-muted">All Lebanon · free over {usd(Number(site?.settings.freeDeliveryThresholdCents ?? 6000))}</p></div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-line bg-plum-soft/40 p-5 text-[13px] text-ink/80">
          <p><strong>Hours:</strong> We reply to messages daily. Orders placed after hours are confirmed the next day.</p>
        </div>
      </div>
    </div>
  );
}
