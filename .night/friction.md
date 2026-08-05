# Friction list — from the launch-day rehearsal

Produced by `server/scripts/rehearsal.mjs`, run against a **local copy of the restored production
catalogue** (1,178 active products). Twelve orders placed the way customers place them, then every
one worked through its whole life: confirming → confirmed → sourcing → packed → dispatched →
out for delivery → delivered, plus one refused at the door and one cancelled before dispatch,
then points confirmed after the seven-day hold.

**Result: 20 checks passed, 0 failed.** The business logic held up end to end. Everything below is
friction — places the flow made me stop, guess, or work around — not breakage.

The rehearsal script records what it can detect automatically. The rest of this list is what I hit
while writing it, which is the more honest sample: I was doing for the first time what the owner
will do on launch morning.

---

## Blocking launch (owner action, not code)

| # | Where | What | Fix |
|---|---|---|---|
| F1 | Homepage | **Our Picks rail is empty.** No product carries the flag, so the homepage opens with no curated row at all. The rail correctly hides rather than rendering empty — but launch morning has a homepage with no editorial. | Owner picks 8 products: Admin → Products → select → ★ Add to Our Picks |

## Worth fixing before launch (code)

| # | Where | What | Severity |
|---|---|---|---|
| F2 | `POST /api/orders` | **No rate limit at all.** The limiter is applied to login, register, password reset, product-request and launch-signup — the endpoints "where guessing is the attack" — but not to checkout. Measured: 30 orders from one IP at concurrency 10, all 200, zero 429. For a cash-on-delivery business, a spam burst is not a lost password, it is real sourcing time spent on orders nobody will accept. | **high** |
| F3 | Order status API | **The status vocabulary is not discoverable from the API.** I guessed `ready` (there is no such status — it is `packed`) and skipped `dispatched` entirely, so every order dead-ended at `sourcing` with `{"error":"Bad status."}`. The error names the offending value but never lists the legal ones. The admin UI is fine — it offers only legal moves — but anything else driving this endpoint has to read `src/status.ts`. | medium |
| F4 | `POST /api/orders` | **The success shape is undocumented and unexpected.** It returns a flat `{ number, totalCents, subtotalCents, … }`, not `{ order: {…} }`. I checked for `.order`, got `undefined`, and reported "0 placed" while twelve orders sat happily in the database. | low |
| F5 | Loyalty sweep | Header is `x-loyalty-sweep-key`, not the `x-sweep-secret` the name suggests. A wrong header gets a bare 404, which reads as "the route does not exist" rather than "your key header is wrong". | low |

## Expected, and correct

| # | Where | What |
|---|---|---|
| F6 | Homepage | No approved reviews, so the social-proof rail is absent. Correct — nobody has ordered yet. It will populate itself. |
| F7 | Restored data | One real `completed` order exists in production and is terminal. My first pass tried to march it through the lifecycle and got `"Completed" is a final status`. The transition table was right; the rehearsal was wrong to touch a row it did not create. |

---

## What the rehearsal proved

- Twelve orders priced themselves **server-side**, and every one reconciles:
  `total = subtotal + delivery − discount − giftCard`.
- The full 13-status lifecycle has **no dead end** between `received` and `delivered`.
- `refused` is reachable **only** from `out_for_delivery` — you cannot refuse a parcel that was
  never brought to your door — and a refused order **does not become a sale**.
- `cancelled` is terminal and also does not become a sale.
- Every delivered order carries a `deliveredAt` timestamp, which is what the points hold is
  measured from.
- Points earn as **pending** on delivery and **confirm** once the hold has elapsed. Verified by
  moving `deliveredAt` back eight days rather than waiting a week — the same thing the calendar
  does, without the week.
- The dispatch run loads and lists what to deliver.

## What it did NOT cover

- The **browser** side of admin — the rehearsal drives the API. The browser suite
  (`scripts/e2e/test-e2e.mjs`) covers the customer journey; admin screens at phone width are
  covered by screenshots, not by an automated walk.
- **Coupons and gift cards** at checkout under the rehearsal (they have their own money suite in
  `test-checkout-money.mjs`).
- **Order modification** — removing or swapping an item mid-flow. That is outcome 7, and this
  rehearsal is the argument for it: every one of the twelve orders went through unchanged, which
  is not how a source-per-order business actually runs.
