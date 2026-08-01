/**
 * The loyalty programme, shaped for a customer to read.
 *
 * ── THE UI DOES NO ARITHMETIC ──────────────────────────────────────────────────────
 *
 * Not the balance, not the tier, not "78% of the way to Bloom", not the date a pending entry
 * confirms. Every number and every string the rewards page renders is computed here. The page
 * is a template.
 *
 * This is the same rule that put all the money maths in `rules.ts`: a second implementation of a
 * calculation, however small, drifts from the first. A progress bar computed in React from a
 * threshold and a spend figure is a second implementation of `tierForSpend`, and the day someone
 * changes a threshold in `config.ts` the bar quietly starts lying. It is also the difference
 * between a customer disputing a number and a customer disputing a number the server never said.
 *
 * ── AND IT NEVER LEAKS INTERNAL VOCABULARY ─────────────────────────────────────────
 *
 * `redemptionReversal`, `manualAdjustment`, `void`, `dedupeKey` are our words for our machinery.
 * A customer reads "Points returned" and "Welcome bonus". The mapping is here, in one place, so
 * a new entry type cannot reach a customer just because someone forgot to translate it — the
 * fallback is deliberately vague rather than deliberately technical.
 */
import {
  RATES, TIERS, LOYALTY_ENABLED, LOYALTY_REDEMPTION_ENABLED,
  type TierKey,
} from "./config.js";
import {
  addMonths, applyMultiplier, maturesAt, tierRule,
  type AccountState, type LedgerFacts, type OrderFacts,
} from "./rules.js";

// ───────────────────────────────────────────────────────────────── the three facts

/**
 * The three things a customer must be told plainly, because each one makes otherwise-confusing
 * behaviour make sense. They are prominent on the page, not fine print.
 *
 *   1. Points sit pending for a week after delivery. Without this, "pending" reads as broken.
 *   2. The multiplier is fixed when the order is placed. Explains why an order paid the old
 *      rate after a promotion — and, more importantly, promises that it will.
 *   3. A new tier starts with the next order. Explains why crossing a threshold did not
 *      retroactively re-pay the order that crossed it.
 *
 * They live server-side so the copy and the behaviour ship together. A promise written in JSX
 * can be edited by someone who does not know it is load-bearing.
 */
export const PROGRAMME_FACTS = [
  {
    key: "hold",
    title: "Points confirm 7 days after delivery.",
    body: "They appear as pending the moment you order, and become yours to spend a week after the parcel reaches you.",
  },
  {
    key: "rate",
    title: "The rate you see when you order is the rate you get.",
    body: "Your tier is locked in at checkout. Nothing that happens while you wait can change what an order earns.",
  },
  {
    key: "tier",
    title: "Your new tier applies from your next order.",
    body: "Reaching a new tier does not re-pay the order that got you there — it sets the rate for everything after it.",
  },
] as const;

// ───────────────────────────────────────────────────────────────── formatting

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * A date a customer can read. Matches what `Track.tsx` already does, so the rewards page does
 * not introduce a second date style to the same account area.
 */
const dateLabel = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;

/** "1.25x" but "1x" rather than "1.00x" — a multiplier of one should not look like a discount. */
const multiplierLabel = (m: number) => `${Number(m.toFixed(2))}×`;

// ───────────────────────────────────────────────────────────────── history

export type HistoryEntry = {
  id: number;
  /** What happened, in the customer's words. */
  title: string;
  /** When, and anything conditional about it. Empty string when there is nothing to add. */
  detail: string;
  points: number;
  pointsLabel: string;
  /** ISO, for sorting or a title attribute. The page renders `atLabel`. */
  at: string;
  atLabel: string;
  tone: "credit" | "debit" | "waiting";
};

type EntryRow = LedgerFacts & {
  reason: string;
  dedupeKey: string | null;
};

/**
 * One ledger row, translated.
 *
 * `orderNumbers` maps order id to the human number (TG-001042) — the customer knows their order
 * by that, not by our primary key. An order we cannot name is described without one rather than
 * with a raw id.
 */
function describe(
  e: EntryRow,
  orders: ReadonlyMap<number, OrderFacts>,
  orderNumbers: ReadonlyMap<number, string>,
  now: Date,
): HistoryEntry | null {
  if (e.status === "void") return null; // never happened, as far as the customer is concerned

  const number = e.orderId === null ? null : orderNumbers.get(e.orderId) ?? null;
  const onOrder = number ? ` on order ${number}` : "";
  const at = e.confirmedAt ?? e.createdAt;

  let title: string;
  let detail = "";
  let points = e.points;
  let tone: HistoryEntry["tone"] = points < 0 ? "debit" : "credit";

  switch (e.type) {
    case "earn": {
      title = number ? `Order ${number}` : "Order";
      if (e.status === "pending") {
        tone = "waiting";
        // Shown at the PROMISED rate, which is what the ledger now guarantees will land. A
        // customer watching a pending figure grow into a different confirmed figure would
        // reasonably assume one of the two was a mistake.
        points = applyMultiplier(e.points, e.multiplierApplied);
        const order = e.orderId === null ? null : orders.get(e.orderId);
        const ready = maturesAt(order);
        detail = ready
          ? (ready > now ? `confirms ${shortDate(ready)}` : "confirming shortly")
          : "confirms 7 days after delivery";
      }
      break;
    }
    case "redeem":
      title = `Points used${onOrder}`;
      break;
    case "redemptionReversal":
      title = "Points returned";
      detail = number ? `order ${number} did not go ahead` : "";
      break;
    case "reversal":
      title = "Points removed";
      detail = number ? `order ${number} was returned` : "";
      break;
    case "expiry":
      title = "Points expired";
      detail = `${RATES.expiryMonths} months without a purchase`;
      break;
    case "manualAdjustment": {
      // Keyed, not parsed. The `reason` column is written by and for admins and can say
      // anything; the dedupe key is a controlled vocabulary we set ourselves.
      const key = e.dedupeKey ?? "";
      if (key.startsWith("signup:")) title = "Welcome bonus";
      else if (key.startsWith("birthday:")) title = "Birthday bonus";
      else if (points > 0) title = "Points added by TulipGlam";
      else title = "Points removed by TulipGlam";
      break;
    }
    default:
      // A type nobody has translated yet. Vague on purpose: an untranslated label is better
      // than leaking whatever internal word was invented this week.
      title = points >= 0 ? "Points added" : "Points adjusted";
  }

  return {
    id: e.id,
    title,
    detail,
    points,
    pointsLabel: `${signed(points)} points`,
    at: at.toISOString(),
    atLabel: dateLabel(at),
    tone,
  };
}

// ───────────────────────────────────────────────────────────────── the view

export type TierView = {
  key: TierKey;
  label: string;
  multiplier: number;
  multiplierLabel: string;
  perks: string[];
};

export type RewardsView = {
  /** The programme as a whole. False means the page should not exist. */
  enabled: boolean;
  /**
   * Spending points. When false, the page says NOTHING about redeeming — no disabled panel, no
   * "coming soon". A visible-but-dead feature is a promise with a date nobody has set.
   */
  redemptionEnabled: boolean;
  /** Whether this login has a loyalty account yet. False is the ordinary state for a new customer. */
  linked: boolean;

  available: number;
  availableLabel: string;
  pending: number;
  pendingLabel: string;
  /** Plain-language explanation of the pending figure, or "" when there is none. */
  pendingNote: string;

  tier: TierView;
  /** Progress toward the next tier, or null at the top. `percent` is computed HERE. */
  next: {
    key: TierKey;
    label: string;
    toGoCents: number;
    toGoLabel: string;
    percent: number;
    multiplierLabel: string;
  } | null;
  spendLabel: string;

  expiresAtLabel: string;
  history: HistoryEntry[];
  historyTruncated: boolean;

  facts: typeof PROGRAMME_FACTS;
  earnRateLabel: string;
};

/** How many history rows the page gets. Enough to be useful, bounded so the payload cannot grow. */
export const HISTORY_LIMIT = 40;

/** The perks a tier actually delivers. Only free delivery — see the note in `config.ts`. */
function perksFor(key: TierKey): string[] {
  const rule = tierRule(key);
  const out = [`${multiplierLabel(rule.multiplier)} points on everything`];
  if (rule.freeDeliveryOverCents === 0) out.push("Free delivery on every order");
  else if (rule.freeDeliveryOverCents !== null) out.push(`Free delivery over ${money(rule.freeDeliveryOverCents)}`);
  return out;
}

export function tierView(key: TierKey): TierView {
  const rule = tierRule(key);
  return {
    key, label: rule.label,
    multiplier: rule.multiplier,
    multiplierLabel: multiplierLabel(rule.multiplier),
    perks: perksFor(key),
  };
}

/**
 * The empty state: a real customer with no account yet, or the programme's first day.
 *
 * Deliberately not an error and not a spinner. Every customer starts here, so this is the most
 * seen state the page has, and it has to explain what the programme IS rather than apologise for
 * having no data.
 */
export function emptyView(): RewardsView {
  const tier = tierView(TIERS[0].key);
  const next = TIERS[1];
  return {
    enabled: LOYALTY_ENABLED,
    redemptionEnabled: LOYALTY_REDEMPTION_ENABLED,
    linked: false,
    available: 0, availableLabel: "0",
    pending: 0, pendingLabel: "0", pendingNote: "",
    tier,
    next: next
      ? {
          key: next.key, label: next.label,
          toGoCents: next.thresholdCents,
          toGoLabel: money(next.thresholdCents),
          percent: 0,
          multiplierLabel: multiplierLabel(next.multiplier),
        }
      : null,
    spendLabel: money(0),
    expiresAtLabel: "",
    history: [],
    historyTruncated: false,
    facts: PROGRAMME_FACTS,
    earnRateLabel: `1 point per $1 spent`,
  };
}

/**
 * Everything the rewards page renders, from state the rules already computed.
 *
 * Takes `AccountState` rather than a database handle: this module does no I/O and no arithmetic
 * beyond presentation, which keeps it testable without a fixture and keeps the temptation to
 * "just recompute that here" out of reach.
 */
export function buildView(input: {
  state: AccountState;
  entries: readonly EntryRow[];
  orders: ReadonlyMap<number, OrderFacts>;
  orderNumbers: ReadonlyMap<number, string>;
  now: Date;
}): RewardsView {
  const { state, now } = input;
  const tier = tierView(state.tier);

  // The next tier up from the one in force, and how far away it is. Computed here so the page
  // never divides a spend figure by a threshold — that would be `tierForSpend` reimplemented in
  // JSX, and it would go stale the first time a threshold moved.
  const idx = TIERS.findIndex((t) => t.key === state.tier);
  const upcoming = TIERS[idx + 1] ?? null;
  const previousThreshold = TIERS[idx]?.thresholdCents ?? 0;

  let next: RewardsView["next"] = null;
  if (upcoming) {
    const span = Math.max(1, upcoming.thresholdCents - previousThreshold);
    const done = Math.max(0, state.windowSpendCents - previousThreshold);
    next = {
      key: upcoming.key,
      label: upcoming.label,
      toGoCents: Math.max(0, upcoming.thresholdCents - state.windowSpendCents),
      toGoLabel: money(Math.max(0, upcoming.thresholdCents - state.windowSpendCents)),
      percent: Math.max(0, Math.min(100, Math.round((done / span) * 100))),
      multiplierLabel: multiplierLabel(upcoming.multiplier),
    };
  }

  const history = input.entries
    .map((e) => describe(e, input.orders, input.orderNumbers, now))
    .filter((h): h is HistoryEntry => h !== null)
    .sort((a, b) => b.at.localeCompare(a.at));

  return {
    enabled: LOYALTY_ENABLED,
    redemptionEnabled: LOYALTY_REDEMPTION_ENABLED,
    linked: true,
    available: state.balance,
    availableLabel: String(state.balance),
    pending: state.pending,
    pendingLabel: String(state.pending),
    pendingNote: state.pending > 0
      ? `From orders on their way. They confirm 7 days after each one is delivered.`
      : "",
    tier,
    next,
    spendLabel: money(state.windowSpendCents),
    expiresAtLabel: state.balance > 0 && state.expiresAt ? dateLabel(state.expiresAt) : "",
    history: history.slice(0, HISTORY_LIMIT),
    historyTruncated: history.length > HISTORY_LIMIT,
    facts: PROGRAMME_FACTS,
    earnRateLabel: `1 point per $${(RATES.centsPerPoint / 100).toFixed(0)} spent`,
  };
}

/** Exported for the tests, which assert the expiry label matches what the rules derived. */
export const _internal = { dateLabel, money, multiplierLabel, addMonths };
