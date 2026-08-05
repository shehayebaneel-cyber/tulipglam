import { Link } from "react-router-dom";
import { Wordmark, WhatsAppIcon, InstagramIcon } from "./ui";
import { useStore } from "../lib/store";
import { waLink } from "../lib/api";

// The picks / best-sellers link is resolved per render from /api/site, so the footer cannot
// promise "Best Sellers" while the page it opens is headed "Our Picks". Everything else static.
const cols = (picksHref: string, picksLabel: string): { title: string; links: [string, string][] }[] => [
  { title: "Shop", links: [["/shop", "All products"], ["/categories", "All categories"], ["/new", "New Arrivals"], [picksHref, picksLabel], ["/sale", "Sale"], ["/brands", "Brands"], ["/gift-cards", "Gift Cards"]] },
  { title: "Help", links: [["/request", "Request a Product"], ["/track", "Order Tracking"], ["/shipping", "Shipping & Delivery"], ["/returns", "Returns & Refunds"], ["/contact", "Contact"], ["/faq", "FAQ"]] },
  { title: "Company", links: [["/about", "About Us"], ["/privacy", "Privacy Policy"], ["/terms", "Terms & Conditions"], ["/gift-card-terms", "Gift Card Terms"], ["/account", "Account"]] },
];

export function Footer() {
  const { site } = useStore();
  const wa = site?.settings.whatsappNumber ?? "";
  const ig = site?.settings.instagramUrl ?? "";
  const email = site?.settings.contactEmail ?? "";
  const COLS = cols(site?.picks?.href ?? "/our-picks", site?.picks?.label ?? "Our Picks");

  return (
    <footer className="mt-16 border-t border-line bg-surface pb-24 lg:pb-12">
      <div className="wrap grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-xs text-sm text-muted">Premium beauty, delivered across Lebanon. Cash on delivery, confirmed on WhatsApp.</p>
          <div className="mt-4 flex gap-2">
            {wa && <a href={waLink(wa, "Hi TulipGlam!")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold hover:border-ink"><WhatsAppIcon className="h-4 w-4" /> WhatsApp</a>}
            {ig && <a href={ig} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold hover:border-ink"><InstagramIcon className="h-4 w-4" /> Instagram</a>}
            {email && <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-xs font-semibold hover:border-ink">✉ Email</a>}
          </div>
        </div>
        {COLS.map((col) => (
          <div key={col.title}>
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{col.title}</h4>
            <ul className="mt-3 space-y-2 text-sm">
              {col.links.map(([to, label]) => (
                <li key={to}><Link to={to} className="text-ink/80 hover:text-plum">{label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="wrap flex flex-col gap-2 border-t border-line py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} TulipGlam · Beirut, Lebanon</p>
        <p>Prices in USD · Cash on delivery · Availability confirmed before dispatch</p>
      </div>
    </footer>
  );
}
