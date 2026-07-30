import { Link } from "react-router-dom";
import { usd } from "../lib/api";
import { useStore } from "../lib/store";

type Block = { h?: string; p?: string; li?: string[] };
type Page = { title: string; intro: string; blocks: Block[]; updated?: string };

/**
 * Policy and information pages.
 *
 * Built from settings rather than fixed prose, because the previous version stated several
 * things the business cannot back:
 *
 *  - "Orders of $60 or more qualify for free delivery" duplicated a figure that lives in
 *    `freeDeliveryThresholdCents`, exactly like the announcement bar did. Move the threshold and
 *    the policy page kept quoting the old one.
 *  - "Most orders arrive within 2–5 working days" was an invented delivery promise. There is no
 *    courier integration, no tracking and no SLA behind it, and a customer holding us to it
 *    would be right to. It is a setting now, and the sentence doesn't appear until someone who
 *    knows the answer fills it in.
 *  - "everything we carry is 100% genuine, sourced from official brand channels" was the worst.
 *    The catalogue comes from three retail suppliers, not from the brands, so that is an
 *    authenticity guarantee this store is in no position to give.
 *  - "contact us within 48 hours" set a deadline nobody chose. Also a setting.
 *
 * The rule throughout: state what the code and the business actually do, put anything else
 * behind a setting, and let the sentence disappear rather than guess.
 */
function pagesFor(s: Record<string, string>): Record<string, Page> {
  const threshold = Number(s.freeDeliveryThresholdCents ?? "");
  const hasThreshold = Number.isFinite(threshold) && threshold > 0;
  const estimate = (s.deliveryEstimate ?? "").trim();
  const returnsWindow = (s.returnsWindow ?? "").trim();
  const emailWorks = s.emailConfigured === "true";

  return {
    shipping: {
      title: "Delivery",
      intro: "How your order reaches you.",
      updated: "30 July 2026",
      blocks: [
        { h: "Where we deliver", p: "Across all of Lebanon. The fee depends on your area and is shown at checkout before you confirm." },
        {
          h: "Delivery fees",
          p: hasThreshold
            ? `Fees vary by area and are shown at checkout. Orders of ${usd(threshold)} or more are delivered free.`
            : "Fees vary by area and are shown at checkout, before you confirm anything.",
        },
        {
          h: "Timing",
          // Only the structurally true part is stated unconditionally; the estimate appears
          // only once someone has set one.
          p: `Every order is sourced after you place it, so we confirm each item with you on WhatsApp first, then dispatch.${estimate ? ` ${estimate}` : " We’ll give you a timeframe on that call."}`,
        },
        { h: "Paying", p: "Cash on delivery — you pay the courier when the order arrives. No card, and nothing is taken up front." },
      ],
    },

    returns: {
      title: "Returns",
      intro: "What happens when something isn’t right.",
      updated: "30 July 2026",
      blocks: [
        {
          h: "Damaged or wrong items",
          p: `If something arrives damaged or isn’t what you ordered, message us on WhatsApp${returnsWindow ? ` within ${returnsWindow}` : " as soon as you notice"} and we’ll put it right.`,
        },
        { h: "Opened products", p: "For hygiene reasons, opened makeup, skincare and fragrance can’t be returned unless they’re faulty. Unopened items in their original packaging can." },
        {
          h: "Items we can’t source",
          // True by construction: money is collected on delivery, and the admin's remove-item
          // flow recomputes the order server-side before anything is dispatched.
          p: "If we can’t source something you ordered, we contact you before dispatch. Because you pay on delivery, you are never charged for anything that doesn’t arrive — the total is recalculated first.",
        },
      ],
    },

    faq: {
      title: "Frequently asked questions",
      intro: "Quick answers to the things people ask most.",
      blocks: [
        {
          h: "Where do your products come from?",
          // What is actually true. The old answer promised "official brand channels", which is
          // an authenticity guarantee a reseller cannot give.
          p: "We work with established beauty suppliers in Lebanon and list their ranges. If you have a question about a specific product before you order, ask us on WhatsApp and we’ll answer honestly.",
        },
        { h: "How do I pay?", p: "Cash on delivery. You pay the courier when your order arrives." },
        {
          h: "Why do you confirm availability?",
          p: "We don’t hold stock. Sourcing each order lets us list a far wider range than we could otherwise carry, and it means we check every item is actually available before anything is dispatched.",
        },
        { h: "Can I change my order?", p: "Yes — reply on the WhatsApp thread we open with you after checkout, any time before dispatch." },
        { h: "Do I need an account?", p: "No. You can order as a guest and track it with the order number. An account just saves your address and keeps your order history." },
      ],
    },

    about: {
      title: "About TulipGlam",
      intro: "Premium beauty, delivered across Lebanon.",
      blocks: [
        { p: "TulipGlam brings makeup, skincare, hair and fragrance to your door — priced in USD, delivered anywhere in Lebanon, paid for in cash when it arrives." },
        { p: "We source each order rather than hold stock, which is why we can list thousands of products and why we confirm every item with you before it’s dispatched. It’s a slower conversation than a supermarket checkout, and a more honest one." },
      ],
    },

    privacy: {
      title: "Privacy",
      intro: "What we hold, and why.",
      updated: "30 July 2026",
      blocks: [
        {
          h: "When you order",
          p: "We store your name, phone number, WhatsApp number, delivery address and — if you give one — your email, together with what you ordered and what it cost. We need all of it to confirm the order and get it to you.",
        },
        {
          h: "If you create an account",
          // Describes what the code actually stores. The old page said we collect "only name,
          // contact number and delivery address", which was incomplete and so inaccurate.
          p: "We store your email and a scrambled version of your password — never the password itself — plus any addresses you save. Your cart, wishlist and sign-in token live in your own browser, not on our servers.",
        },
        { h: "How we use it", p: "Only to confirm, prepare and deliver your order, and to talk to you about it. We don’t sell it, and we don’t send marketing you didn’t ask for." },
        { h: "WhatsApp", p: "Orders are confirmed over WhatsApp, so those messages are also held by WhatsApp under their own terms." },
        ...(emailWorks ? [{ h: "Email", p: "If you give us an email address we use it for order confirmations and status updates." }] : []),
        { h: "Getting it removed", p: "Message us and we’ll delete your account and saved addresses. Order records are kept as the receipt for a completed sale." },
      ],
    },

    terms: {
      title: "Terms",
      intro: "The basics of ordering here.",
      updated: "30 July 2026",
      blocks: [
        { h: "Availability", p: "Every order is subject to the items being available. If something isn’t, we contact you before dispatch and adjust or cancel that item." },
        {
          h: "Pricing",
          p: "Prices are in USD. The total shown at checkout — items, delivery, and any coupon or gift card — is what you pay on delivery. We calculate it on our own server at the moment you order, so it can’t be altered in the browser.",
        },
        { h: "Paying", p: "Cash on delivery. Placing an order is an agreement to pay the courier the total shown at checkout." },
        { h: "Cancelling", p: "Reply on your WhatsApp thread any time before dispatch and we’ll cancel it. Nothing has been charged at that point." },
      ],
    },

    "gift-card-terms": {
      title: "Gift card terms",
      intro: "How TulipGlam gift cards work.",
      updated: "30 July 2026",
      blocks: [
        {
          li: [
            // Only claims the code implements. Email delivery is dropped entirely when no mail
            // is configured, rather than promising a message that would never send.
            emailWorks ? "Gift cards are sent digitally, by WhatsApp or email." : "Gift cards are sent digitally over WhatsApp.",
            "Enter the code at checkout and it comes off your total.",
            "If the card is worth more than the order, the remaining balance stays on it for next time.",
            "If the order is worth more than the card, you pay the difference on delivery.",
            "Gift cards can’t be exchanged for cash.",
          ],
        },
      ],
    },
  };
}

export function Info({ slug }: { slug: string }) {
  const { site } = useStore();
  const page = pagesFor(site?.settings ?? {})[slug];

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
        {/* A policy page with no date is impossible to hold anyone to. */}
        {page.updated && <p className="mt-8 text-[12px] text-muted">Last updated {page.updated}.</p>}
        <div className="mt-6 rounded-2xl border border-line bg-surface p-5 text-[13px] text-muted">
          Still have a question? <Link to="/contact" className="font-semibold text-plum hover:underline">Contact us</Link>.
        </div>
      </article>
    </div>
  );
}
