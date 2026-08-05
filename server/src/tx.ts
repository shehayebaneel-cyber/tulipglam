/**
 * How long an interactive transaction may take.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────
 *
 * Neither the checkout transaction nor the points redemption set one, so both ran on Prisma's
 * defaults: **`maxWait` 2 s, `timeout` 5 s**. Found in `/admin/errors`, recorded against
 * `/api/orders` on four separate days:
 *
 *     Transaction already closed: A query cannot be executed on an expired transaction.
 *     The timeout for this transaction was 5000 ms
 *
 * A customer hitting that gets **"Something went wrong."** and loses their checkout. This
 * codebase already decided that outcome is the worst one available — `withSerialisationRetry`
 * exists specifically so a conflict never loses a sale — and then let a clock do the same thing
 * by default.
 *
 * ── WHY IT HAPPENS HERE AND NOT ON A NORMAL STACK ──────────────────────────────────
 *
 * The transaction is a dozen or so sequential round trips: claim the coupon, claim the gift
 * card, re-price every line from the live catalogue, create the order, create its items, write
 * the ledger entry. Nominally that is fine. Against Neon in **us-east-2 (Ohio)** each of those
 * costs **145 ms** measured, so the floor is already ~2 s — and Neon's pooled endpoint under
 * concurrent queries has a measured tail reaching **2 s for a single trivial statement**. Two
 * bad trips and the budget is gone.
 *
 * It is not the transaction doing too much work. It is 5 s being a local-database number
 * applied across an ocean.
 *
 * ── WHY 20 SECONDS ─────────────────────────────────────────────────────────────────
 *
 * About ten times the nominal cost, which is the headroom the measured tail actually needs.
 * The risk of a longer window is locks held longer, and that is small here: a checkout touches
 * one coupon row, one gift-card row and its own new rows, and only takes SERIALIZABLE when
 * points are being spent. Weighed against losing a cash-on-delivery sale outright, the trade is
 * not close.
 *
 * `maxWait` is the time spent waiting to *start* — worth raising for the same reason, since a
 * busy pool at 145 ms per trip can easily eat 2 s before the first statement runs.
 *
 * ── AFTER STAGE C ──────────────────────────────────────────────────────────────────
 *
 * The round trip becomes sub-millisecond and this stops mattering. Leave it set anyway: it
 * costs nothing when transactions finish in 20 ms, and removing it would re-arm the same trap
 * for whoever next runs against a remote database.
 */
export const TX_TIMEOUT_MS = 20_000;
export const TX_MAX_WAIT_MS = 10_000;

/** Spread onto any interactive `$transaction` that writes money or points. */
export const TX_OPTIONS = { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS } as const;
