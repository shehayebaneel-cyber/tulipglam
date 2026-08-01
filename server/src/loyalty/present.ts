/**
 * The loyalty programme, shaped for a customer to read.
 *
 * ── THE UI DOES NO ARITHMETIC ──────────────────────────────────────────────────────
 *
 * Not the balance, not the tier, not "78% of the way to Bloom", not the date a pending entry
 * confirms, and not the heading above the balance. Every number and every string the rewards
 * page renders is computed here. The page is a template.
 *
 * This is the same rule that put all the money maths in `rules.ts`: a second implementation of a
 * calculation, however small, drifts from the first. A progress bar computed in React from a
 * threshold and a spend figure is a second implementation of `tierForSpend`, and the day someone
 * changes a threshold in `config.ts` the bar quietly starts lying.
 *
 * ── IT NEVER LEAKS INTERNAL VOCABULARY ─────────────────────────────────────────────
 *
 * `redemptionReversal`, `manualAdjustment`, `void`, `dedupeKey` are our words for our machinery.
 * A customer reads "Points returned" and "Welcome bonus". The mapping is here, in one place, so
 * a new entry type cannot reach a customer just because someone forgot to translate it.
 *
 * ── AND IT OWNS THE COPY THAT DEPENDS ON A FLAG ────────────────────────────────────
 *
 * The heading above the balance and the expiry sentence are DATA, not JSX. While redemption is
 * off the page must not imply points can be exchanged for anything, and a rule enforced in a
 * component is a rule enforced by whoever edits that component next. An earlier version of this
 * page passed a test asserting it contained no "Redeem" while its largest label read "Available
 * to spend" — the check was against words I guessed, not against what the page said.
 */
import {
  RATES, TIERS, LOYALTY_ENABLED, LOYALTY_REDEMPTION_ENABLED,
  type TierKey,
} from "./config.js";
import {
  applyMultiplier, maturesAt, tierRule,
  type AccountState, type LedgerFacts, type OrderFacts,
} from "./rules.js";

// ───────────────────────────────────────────────────────────────── the three facts

/**
 * The three things a customer must be told plainly, because each one makes otherwise-confusing
 * behaviour make sense.
 *
 *   1. Points sit pending for a week after delivery. Without this, "pending" reads as broken.
 *   2. The multiplier is fixed when the order is placed. Explains why an order paid the old
 *      rate after a promotion — and, more importantly, promises that it will.
 *   3. A new tier starts with the next order. Explains why crossing a threshold did not
 *      retroactively re-pay the order that crossed it.
 *
 * The hold length is interpolated from RATES rather than written as "7", because these sentences
 * are a promise about behaviour and the behaviour is defined there. Three of these strings used
 * to say "7 days" as a literal while the dated version beside them read the config.
 */
const HOLD_DAYS = RATES.holdDaysAfterDelivery;

export const PROGRAMME_FACTS = [
  {
    key: "hold",
    title: `Points confirm ${HOLD_DAYS} days after delivery.`,
    body: `They appear as pending the moment you order, and become yours ${HOLD_DAYS} days after the parcel reaches you.`,
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

/** A date a customer can read. Matches what `Track.tsx` already does elsewhere in the account. */
const dateLabel = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;

/** "1.25×" but "1×" rather than "1.00×" — a multiplier of one should not look like a discount. */
const multiplierLabel = (m: number) => `${Number(m.toFixed(2))}×`;

// ───────────────────────────────────────────────────────────────── history

export type HistoryEntry = {
  /**
   * A per-response index, NOT the ledger row id.
   *
   * The primary key is a single global sequence across every account, so publishing it let a
   * customer with one login read the store's order volume off the gaps between their own
   * entries. React only needs something stable within the rendered list.
   */
  key: string;
  title: string;
  detail: string;
  points: number;
  pointsLabel: string;
  at: string;
  atLabel: string;
  tone: "credit" | "debit" | "waiting";
};

type EntryRow = LedgerFacts & { reason: string; dedupeKey: string | null };

/**
 * One ledger row, translated.
 *
 * `confirming` maps entry id to the points it is ABOUT to confirm for. An earn whose hold has
 * elapsed is already counted in the spendable balance by `computeState`, so describing it from
 * its stored `pending` status showed the same points twice — once in the headline figure and
 * again underneath as "confirming shortly". The stored status is a cache; this reads the same
 * derivation everything else does.
 */
function describe(
  e: EntryRow,
  index: number,
  confirming: ReadonlyMap<number, number>,
  orders: ReadonlyMap<number, OrderFacts>,
  orderNumbers: ReadonlyMap<number, string>,
  now: Date,
): HistoryEntry | null {
  if (e.status === "void") return null; // never happened, as far as the customer is concerned

  const number = e.orderId === null ? null : orderNumbers.get(e.orderId) ?? null;
  const onOrder = number ? ` on order ${number}` : "";
  const matured = confirming.get(e.id);

  let title: string;
  let detail = "";
  let points = e.points;
  let at = e.confirmedAt ?? e.createdAt;
  let tone: HistoryEntry["tone"] = points < 0 ? "debit" : "credit";

  switch (e.type) {
    case "earn": {
      title = number ? `Order ${number}` : "Order";
      if (matured !== undefined) {
        // Spendable already — the hold elapsed even though no sweep has written the row yet.
        points = matured;
        at = maturesAt(e.orderId === null ? null : orders.get(e.orderId)) ?? at;
      } else if (e.status === "pending") {
        tone = "waiting";
        // Shown at the PROMISED rate, which the ledger guarantees will land. A customer watching
        // a pending figure grow into a different confirmed figure would reasonably assume one of
        // the two was a mistake.
        points = applyMultiplier(e.points, e.multiplierApplied);
        const ready = maturesAt(e.orderId === null ? null : orders.get(e.orderId));
        detail = ready && ready > now
          ? `confirms ${shortDate(ready)}`
          : `confirms ${HOLD_DAYS} days after delivery`;
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
      detail = `${RATES.expiryMonths} months without a confirmed order`;
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
    key: String(index),
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
  /**
   * The order value above which this tier gets free delivery; 0 means always, null means never.
   *
   * Sent so checkout can show the perk BEFORE the order is placed. It is the customer's own
   * tier, on their own authenticated payload, so this is not a lookup anyone can point at
   * somebody else.
   */
  freeDeliveryOverCents: number | null;
};

export type RewardsView = {
  enabled: boolean;
  /**
   * Spending points. When false the page says NOTHING about redeeming — and the copy fields
   * below are already worded accordingly, so there is no branch for a component to get wrong.
   */
  redemptionEnabled: boolean;
  linked: boolean;

  available: number;
  availableLabel: string;
  /** Heading above the balance. Flag-aware: it must not promise spending that is switched off. */
  availableHeading: string;
  /** One line under the balance — explains zero, or explains a negative. */
  availableNote: string;
  pending: number;
  pendingLabel: string;
  pendingNote: string;

  tier: TierView;
  next: {
    key: TierKey;
    label: string;
    toGoCents: number;
    toGoLabel: string;
    percent: number;
    multiplierLabel: string;
  } | null;
  spendLabel: string;

  /** Full sentence, or "" when there is nothing to expire. Never just a date. */
  expiryNote: string;
  history: HistoryEntry[];
  historyTruncated: boolean;

  facts: typeof PROGRAMME_FACTS;
  earnRateLabel: string;
};

/** How many history rows the page gets. */
export const HISTORY_LIMIT = 40;

/**
 * How many rows the route should FETCH.
 *
 * More than it shows, because the display order (`confirmedAt ?? createdAt`) is not the order
 * the database can index on (`createdAt`), and confirmation is stamped at an order's maturity
 * date rather than at write time — so the newest row by one key is not always the newest by the
 * other. Over-fetching and sorting in memory makes a boundary swap vanishingly unlikely; the
 * truncation flag comes from an exact count rather than from this window.
 */
export const HISTORY_FETCH = HISTORY_LIMIT * 3;

/** 1 point per $1, from the config rather than from a sentence someone typed. */
const earnRateLabel = () => `1 point per ${money(RATES.centsPerPoint)} spent`;

/** The perks a tier actually delivers. Free delivery is honoured in checkout — see `hooks.ts`. */
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
    freeDeliveryOverCents: rule.freeDeliveryOverCents,
  };
}

/**
 * The heading above the balance.
 *
 * "Available to spend" is a promise that points can be exchanged for something. While redemption
 * is off that promise has no date behind it, so the heading describes what the number IS rather
 * than what it will one day do.
 */
const headingFor = () => (LOYALTY_REDEMPTION_ENABLED ? "Available to spend" : "Points earned");

/**
 * The expiry sentence.
 *
 * The clock resets on CONFIRMED activity only. The old wording — "unless you order or spend
 * before then" — was wrong twice over: it implied spending was possible while redemption is off,
 * and an order placed today moves nothing until it confirms, seven days after it is delivered.
 */
function expiryNoteFor(balance: number, expiresAt: Date | null): string {
  if (balance <= 0 || !expiresAt) return "";
  const base = `Points expire ${dateLabel(expiresAt)}.`;
  return LOYALTY_REDEMPTION_ENABLED
    ? `${base} Confirmed orders and redemptions extend this.`
    : `${base} Confirmed orders extend this.`;
}

/**
 * The empty state: a real customer with no account yet, or the programme's first day.
 *
 * Every field is derived the same way `buildView` derives it. An earlier version hardcoded the
 * earn-rate sentence here while `buildView` computed it, which agreed only for as long as
 * `centsPerPoint` stayed at 100 — two code paths for one number, in the module whose entire
 * purpose is having one.
 */
export function emptyView(): RewardsView {
  const tier = tierView(TIERS[0].key);
  const next = TIERS[1];
  return {
    enabled: LOYALTY_ENABLED,
    redemptionEnabled: LOYALTY_REDEMPTION_ENABLED,
    linked: false,
    available: 0,
    availableLabel: "0",
    availableHeading: headingFor(),
    availableNote: "Your first order starts the count.",
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
    expiryNote: "",
    history: [],
    historyTruncated: false,
    facts: PROGRAMME_FACTS,
    earnRateLabel: earnRateLabel(),
  };
}

/**
 * Everything the rewards page renders, from state the rules already computed.
 *
 * Takes `AccountState` rather than a database handle: no I/O, no arithmetic beyond presentation,
 * testable without a fixture, and no room to "just recompute that here".
 */
export function buildView(input: {
  state: AccountState;
  entries: readonly EntryRow[];
  orders: ReadonlyMap<number, OrderFacts>;
  orderNumbers: ReadonlyMap<number, string>;
  /** Exact count of non-void rows on the account, for an honest truncation flag. */
  totalEntries: number;
  now: Date;
}): RewardsView {
  const { state, now } = input;
  const tier = tierView(state.tier);

  // Entries the rules have already counted as spendable, with the points they will confirm for.
  const confirming = new Map(state.plan.confirm.map((c) => [c.entryId, c.finalPoints]));

  // Progress to the next tier, measured against the ABSOLUTE threshold — the same figure
  // `toGoCents` is measured against, so the bar and the sentence beside it cannot disagree.
  // Anchoring the bar on the held tier's own threshold made it read 0% for an entire band
  // whenever the twelve-month hold kept a tier the current spend no longer supported.
  const idx = TIERS.findIndex((t) => t.key === state.tier);
  const upcoming = TIERS[idx + 1] ?? null;

  let next: RewardsView["next"] = null;
  if (upcoming) {
    const toGoCents = Math.max(0, upcoming.thresholdCents - state.windowSpendCents);
    // FLOOR, and capped below 100 while anything is still owed. Math.round drew a completely
    // full bar at $599 of $600 while the line above it said "$1.00 to Bouquet".
    const raw = Math.floor((Math.max(0, state.windowSpendCents) / upcoming.thresholdCents) * 100);
    next = {
      key: upcoming.key,
      label: upcoming.label,
      toGoCents,
      toGoLabel: money(toGoCents),
      percent: toGoCents === 0 ? 100 : Math.max(0, Math.min(99, raw)),
      multiplierLabel: multiplierLabel(upcoming.multiplier),
    };
  }

  const history = input.entries
    .map((e, i) => describe(e, i, confirming, input.orders, input.orderNumbers, now))
    .filter((h): h is HistoryEntry => h !== null)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((h, i) => ({ ...h, key: String(i) })); // re-key after sorting, so keys match render order

  // A NEGATIVE balance is a supported state — a reversal on a returned order can produce one,
  // and `quoteRedemption` refuses against it deliberately rather than clamping. It must not be
  // dressed as a fresh account: "-150" under "your first order starts the count" is the kind of
  // thing a customer screenshots.
  const negative = state.balance < 0;
  const availableNote = negative
    ? "This balance is owed back after a returned order. Points from future orders clear it first."
    : state.balance > 0
      ? (LOYALTY_REDEMPTION_ENABLED ? "points, yours to spend" : "points, confirmed and yours")
      : "Your first order starts the count.";

  return {
    enabled: LOYALTY_ENABLED,
    redemptionEnabled: LOYALTY_REDEMPTION_ENABLED,
    linked: true,
    available: state.balance,
    availableLabel: String(state.balance),
    availableHeading: negative ? "Points owed back" : headingFor(),
    availableNote,
    pending: state.pending,
    pendingLabel: String(state.pending),
    pendingNote: state.pending > 0
      ? `From orders on their way. They confirm ${HOLD_DAYS} days after each one is delivered.`
      : "",
    tier,
    next,
    spendLabel: money(state.windowSpendCents),
    expiryNote: expiryNoteFor(state.balance, state.expiresAt),
    history: history.slice(0, HISTORY_LIMIT),
    // From the exact count, not from `history.length === fetched`. Void entries are dropped
    // during translation, so a voided row inside the fetch window used to make a truncated
    // list report itself as complete.
    historyTruncated: input.totalEntries > Math.min(history.length, HISTORY_LIMIT),
    facts: PROGRAMME_FACTS,
    earnRateLabel: earnRateLabel(),
  };
}

/** Exported for the tests. */
export const _internal = { dateLabel, money, multiplierLabel, headingFor, expiryNoteFor, earnRateLabel };
