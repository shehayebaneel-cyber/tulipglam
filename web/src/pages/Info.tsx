import { Link } from "react-router-dom";

type Block = { h?: string; p?: string; li?: string[] };
const PAGES: Record<string, { title: string; intro: string; blocks: Block[] }> = {
  shipping: {
    title: "Shipping & Delivery",
    intro: "How and when your TulipGlam order reaches you.",
    blocks: [
      { h: "Where we deliver", p: "We deliver across all of Lebanon. Delivery fees vary by area and are shown at checkout." },
      { h: "Free delivery", p: "Orders of $60 or more qualify for free delivery." },
      { h: "Timing", p: "Because each order is sourced to your request, we first confirm availability on WhatsApp, then dispatch. Most orders arrive within 2–5 working days." },
      { h: "Payment", p: "Cash on delivery — you pay the courier when your order arrives. No card needed." },
    ],
  },
  returns: {
    title: "Returns & Refunds",
    intro: "Your satisfaction matters to us.",
    blocks: [
      { h: "Damaged or wrong items", p: "If an item arrives damaged or isn’t what you ordered, contact us on WhatsApp within 48 hours and we’ll make it right." },
      { h: "Hygiene", p: "For health and safety reasons, opened beauty products (makeup, skincare, fragrance) cannot be returned unless faulty." },
      { h: "Unavailable items", p: "If an item you ordered can’t be sourced, we’ll contact you before dispatch — you’re never charged for anything you don’t receive." },
    ],
  },
  faq: {
    title: "Frequently asked questions",
    intro: "Quick answers to common questions.",
    blocks: [
      { h: "Are your products authentic?", p: "Yes — everything we carry is 100% genuine, sourced from official brand channels." },
      { h: "How do I pay?", p: "Cash on delivery. You pay the courier when your order arrives." },
      { h: "Why do you confirm availability?", p: "We curate to order rather than hold heavy stock, which lets us offer a wide range at fair prices. We confirm each item is available before dispatch." },
      { h: "Can I change my order?", p: "Yes — just reply on the WhatsApp thread we open with you after checkout." },
    ],
  },
  about: {
    title: "About TulipGlam",
    intro: "Premium beauty, thoughtfully curated for Lebanon.",
    blocks: [
      { p: "TulipGlam brings the makeup, skincare, hair and fragrance you love to your door — curated with care, priced honestly in USD, and delivered across Lebanon with cash on delivery." },
      { p: "We believe beauty shopping should feel calm and considered, not overwhelming. So we edit down to what genuinely works, and make every order simple to place from your phone." },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro: "How we handle your information.",
    blocks: [
      { p: "We collect only what we need to fulfil your order: your name, contact number, and delivery address." },
      { h: "How we use it", p: "Your details are used solely to confirm, prepare and deliver your order, and to contact you about it. We never sell your data." },
      { h: "WhatsApp", p: "We use WhatsApp to confirm orders and delivery. Standard WhatsApp privacy terms apply to those messages." },
    ],
  },
  terms: {
    title: "Terms & Conditions",
    intro: "The basics of shopping with us.",
    blocks: [
      { h: "Availability", p: "All orders are subject to product availability. If an item is unavailable, we’ll contact you before dispatch and adjust or cancel that item." },
      { h: "Pricing", p: "Prices are shown in USD. The price you see at checkout is the price you pay on delivery, plus any delivery fee shown." },
      { h: "Payment", p: "Orders are paid by cash on delivery. By placing an order you agree to pay the courier the total shown at checkout." },
    ],
  },
  "gift-card-terms": {
    title: "Gift Card Terms",
    intro: "How TulipGlam gift cards work.",
    blocks: [
      { li: ["Gift cards are delivered digitally by WhatsApp or email.", "They can be redeemed against any order at checkout.", "Gift cards are not refundable or exchangeable for cash.", "Any remaining balance stays on the card for future orders."] },
    ],
  },
};

export function Info({ slug }: { slug: string }) {
  const page = PAGES[slug];
  if (!page) return (
    <div className="wrap grid min-h-[52vh] place-items-center py-20 text-center">
      <div><h1 className="serif text-3xl text-ink">Page not found</h1><Link to="/" className="btn btn-ghost mt-6 px-6 py-3">Back home</Link></div>
    </div>
  );
  return (
    <div className="wrap py-8 sm:py-10">
      <article className="mx-auto max-w-2xl">
        <h1 className="serif text-3xl font-medium text-ink sm:text-4xl">{page.title}</h1>
        <p className="mt-2 text-[15px] text-muted">{page.intro}</p>
        <div className="mt-8 space-y-6">
          {page.blocks.map((b, i) => (
            <div key={i}>
              {b.h && <h2 className="text-[15px] font-semibold text-ink">{b.h}</h2>}
              {b.p && <p className="mt-1.5 text-[14px] leading-relaxed text-ink/80">{b.p}</p>}
              {b.li && <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-ink/80">{b.li.map((x, j) => <li key={j}>{x}</li>)}</ul>}
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-line bg-surface p-5 text-[13px] text-muted">
          Still have a question? <Link to="/contact" className="font-semibold text-plum hover:underline">Contact us</Link>.
        </div>
      </article>
    </div>
  );
}
