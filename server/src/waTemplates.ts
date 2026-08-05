/**
 * WhatsApp message templates — the order lifecycle's actual user interface.
 *
 * ── WHY THESE EXIST ────────────────────────────────────────────────────────────────
 *
 * The order lifecycle runs on messages typed by hand: confirming items, offering a swap for
 * something that cannot be sourced, out for delivery, delivered with thanks. Typed fresh each
 * time they are inconsistent, slow, and occasionally promise something the shop cannot do.
 *
 * ── EVERY WORD HERE IS A DRAFT UNTIL THE OWNER SAYS OTHERWISE ──────────────────────
 *
 * A message to a customer is a promise, and promises are the owner's to make. So each template
 * carries `approved: false` and the admin surface badges it **DRAFT**. The full wording is
 * reproduced in DECISIONS.md for sign-off; approving one is a one-line edit here — flip the flag.
 *
 * Nothing about that requires a deploy variable, a dashboard, or a flag flip at boot. It is a
 * code edit that shows up in review, which is the right shape for words that go to customers.
 *
 * ── THE RULES THE WORDING FOLLOWS ──────────────────────────────────────────────────
 *
 * - Never state a delivery DATE or duration. There is no courier integration; the store has no
 *   way to check such a claim, and this codebase already removed one ("2–5 working days").
 * - Never invent a discount, a refund policy, or a guarantee.
 * - Never quote a total that was not computed by the server. Every money value below is
 *   interpolated from the order, never typed.
 * - Say what happens next and who does it. A message that ends without a next step generates a
 *   phone call.
 */
import { statusMeta } from "./status.js";

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** Everything a template may interpolate. Deliberately narrow: no ad-hoc fields. */
export type TemplateOrder = {
  number: string;
  fullName: string;
  status: string;
  totalCents: number;
  subtotalCents: number;
  deliveryCents: number;
  discountCents: number;
  giftCardCents: number;
  pointsDiscountCents: number;
  area?: string | null;
  items: { name: string; qty: number; priceCents: number; variantLabel?: string | null }[];
};

export type Template = {
  key: string;
  /** What situation this is for, in the operator's words. */
  label: string;
  /** One line of guidance shown under the button. */
  when: string;
  /**
   * FALSE until the owner signs the wording off. The admin surface must badge unapproved
   * templates as DRAFT and must not present them as ready to send.
   */
  approved: boolean;
  /** Some templates need a value the order does not carry (which item, what swap). */
  needs?: { key: string; label: string; placeholder: string }[];
  build: (o: TemplateOrder, extra: Record<string, string>) => string;
};

const firstName = (full: string) => (full || "").trim().split(/\s+/)[0] || "there";

const itemLines = (o: TemplateOrder) =>
  o.items.map((i) => `• ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ""}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join("\n");

/**
 * The breakdown, only where it explains something.
 *
 * Same rule as the dispatch sheet: an ordinary order is goods plus delivery, which needs no
 * explanation. Printing a breakdown on every message trains the reader to skip them, and the one
 * that genuinely needs explaining gets skipped with the rest.
 */
const breakdown = (o: TemplateOrder) => {
  const parts: string[] = [];
  if (o.discountCents > 0) parts.push(`Discount: −${money(o.discountCents)}`);
  if (o.pointsDiscountCents > 0) parts.push(`Points: −${money(o.pointsDiscountCents)}`);
  if (o.giftCardCents > 0) parts.push(`Gift card: −${money(o.giftCardCents)}`);
  if (!parts.length) return "";
  return `\nItems: ${money(o.subtotalCents)}\nDelivery: ${o.deliveryCents === 0 ? "Free" : money(o.deliveryCents)}\n${parts.join("\n")}`;
};

export const TEMPLATES: Template[] = [
  {
    key: "confirm-items",
    label: "Confirm the order",
    when: "First message after an order arrives. Confirms what was ordered and the amount at the door.",
    approved: false,
    build: (o) => [
      `Hello ${firstName(o.fullName)}, this is TulipGlam.`,
      ``,
      `We have your order ${o.number}:`,
      itemLines(o),
      breakdown(o),
      ``,
      `Total to pay on delivery: ${money(o.totalCents)}${o.area ? ` (${o.area})` : ""}.`,
      ``,
      `We are checking availability now and will message you as soon as it is confirmed. Reply here if anything needs changing.`,
    ].filter((l) => l !== null).join("\n"),
  },
  {
    key: "offer-swap",
    label: "One item unavailable — offer a swap",
    when: "Use when a line cannot be sourced. Do NOT change the order until they reply.",
    approved: false,
    needs: [
      { key: "item", label: "Which item", placeholder: "the item you cannot source" },
      { key: "alternative", label: "Suggested alternative (optional)", placeholder: "leave blank to just remove it" },
    ],
    build: (o, x) => [
      `Hello ${firstName(o.fullName)}, this is TulipGlam about order ${o.number}.`,
      ``,
      `Unfortunately we cannot get ${x.item || "one of the items"} at the moment.`,
      ``,
      x.alternative
        ? `We can offer ${x.alternative} instead, or remove it from your order — whichever you prefer.`
        : `We can remove it from your order and adjust the total, or hold the order until it is back.`,
      ``,
      `Just reply and we will sort it. Nothing is dispatched until you confirm.`,
    ].join("\n"),
  },
  {
    key: "confirmed",
    label: "Confirmed and being prepared",
    when: "After every line is confirmed available.",
    approved: false,
    build: (o) => [
      `Hello ${firstName(o.fullName)}, your TulipGlam order ${o.number} is confirmed.`,
      ``,
      itemLines(o),
      ``,
      `Total to pay on delivery: ${money(o.totalCents)}.`,
      ``,
      `We are preparing it now and will message you when it is on the way.`,
    ].join("\n"),
  },
  {
    key: "out-for-delivery",
    label: "Out for delivery",
    when: "As you set off. Tells them the amount to have ready.",
    approved: false,
    build: (o) => [
      `Hello ${firstName(o.fullName)}, your TulipGlam order ${o.number} is on its way to you today.`,
      ``,
      `Please have ${money(o.totalCents)} ready in cash.`,
      ``,
      `We will call when we are close.`,
    ].join("\n"),
  },
  {
    key: "delivered-thanks",
    label: "Delivered — thank you",
    when: "After a successful delivery.",
    approved: false,
    build: (o) => [
      `Thank you ${firstName(o.fullName)} — your TulipGlam order ${o.number} is delivered.`,
      ``,
      `We hope you love it. If anything is not right, reply here and we will make it right.`,
    ].join("\n"),
  },
  {
    key: "on-the-way-delay",
    label: "Running late",
    when: "When a run slips. Deliberately gives no new time — see the no-unverifiable-claims rule.",
    approved: false,
    build: (o) => [
      `Hello ${firstName(o.fullName)}, this is TulipGlam about order ${o.number}.`,
      ``,
      `We are running behind today and have not reached you yet. Your order is safe with us.`,
      ``,
      `We will message you as soon as we are on our way. Sorry for the wait.`,
    ].join("\n"),
  },
  {
    key: "could-not-source",
    label: "Could not source the order",
    when: "When nothing on the order can be obtained. Order becomes Unavailable.",
    approved: false,
    build: (o) => [
      `Hello ${firstName(o.fullName)}, this is TulipGlam about order ${o.number}.`,
      ``,
      `We are sorry — we have not been able to get ${o.items.length === 1 ? "this item" : "these items"} for you:`,
      itemLines(o),
      ``,
      `Nothing has been charged. If you would like us to look for something similar, reply here and we will help.`,
    ].join("\n"),
  },
];

/** Fill one template for one order. Unknown key throws rather than sending a blank message. */
export function renderTemplate(key: string, order: TemplateOrder, extra: Record<string, string> = {}): string {
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`unknown template: ${key}`);
  return t.build(order, extra);
}

/** What the admin surface needs to render the library. Never leaks `build`. */
export function templateCatalogue() {
  return TEMPLATES.map((t) => ({
    key: t.key, label: t.label, when: t.when, approved: t.approved, needs: t.needs ?? [],
  }));
}

/** True when every template has been signed off. Used to decide whether to show the DRAFT banner. */
export const allApproved = () => TEMPLATES.every((t) => t.approved);

/** The status a template is normally used at, for ordering the list sensibly. */
export const suggestedFor = (status: string): string[] => {
  const m: Record<string, string[]> = {
    received: ["confirm-items", "offer-swap"],
    confirming: ["offer-swap", "confirmed", "could-not-source"],
    awaiting_customer: ["offer-swap", "could-not-source"],
    confirmed: ["confirmed"],
    sourcing: ["offer-swap", "could-not-source"],
    packed: ["out-for-delivery"],
    dispatched: ["out-for-delivery", "on-the-way-delay"],
    out_for_delivery: ["on-the-way-delay", "delivered-thanks"],
    delivered: ["delivered-thanks"],
    unavailable: ["could-not-source"],
  };
  return m[status] ?? [];
};

/** Human label for a status, reused so admin and templates cannot disagree. */
export const statusLabelFor = (status: string) => statusMeta(status).label;
