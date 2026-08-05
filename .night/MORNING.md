# Overnight — 5 Aug 2026

**Suite green: 22 suites, 1,143 checks** (was 20 / 1,041). Gate verified live. Everything below
is pushed as `28ff7f1`.

**Nothing broke overnight.** No production data was written. The only thing production did all
night was answer a `pg_dump`.

---

## Decisions first

### 1. I installed a local Postgres, and it changed the night

Three of your outcomes — rehearsal, restore drill, load test — all say "somewhere that is not
production". There was nowhere. No Docker, no psql, no local cluster.

So I downloaded portable PostgreSQL binaries (17.10, then 18.2 when I found the version problem
below) and ran a cluster on `:5433`. That unblocked outcomes 2, 11 and 12, and gave a bonus:
**the Stage C latency projection is now a measurement.** The 145 ms Neon round trip is
**sub-millisecond** locally. Same code, same queries.

### 2. The session limit ended the agent budget with three outcomes untouched

Outcomes **7 (resolution flows)**, **9 (promo)** and **13 (adversarial review)** are not done.
That is the honest headline. See *Where I stopped*.

It also killed the *reports* of five agents whose *work had already landed* — I found that by
checking the files rather than trusting the "failed" status, which is how I caught the unmounted
route below.

### 3. Three judgement calls I made without you

- **I did not add a rate limit to checkout**, despite finding it has none. Blocking a real
  customer mid-purchase is a revenue decision, and CGNAT makes it dangerous. Filed, not fixed.
- **`.night/backup/` is gitignored.** It holds a real dump with customer names, phones and
  addresses. It must never be committed.
- **A stray server of mine was briefly listening on a port I reused.** I killed it and verified
  which database each subsequent server was on before trusting any screenshot.

---

## Per outcome

| # | Outcome | State |
|---|---|---|
| 1 | Admin on a phone | **done** — every daily screen, zero sideways scroll |
| 2 | Launch day rehearsed | **done** — 20 checks, friction list below |
| 3 | SEO | **done** — suite grew 44 → 114 checks |
| 4 | Browser-grade tests | **done** — 24 checks, own database |
| 5 | Client errors to me | **done** — and I found it half-wired |
| 6 | Round trips counted | **partial** — fixes landed, the audit table was lost with the agent |
| 7 | Resolution flows | **not started** |
| 8 | Catalog sweep | **done** — flag list below |
| 9 | Launch promo | **not started** |
| 10 | WhatsApp templates | **done** — wording in DECISIONS.md for sign-off |
| 11 | Restore rehearsed | **done** — on real data, store runs on the restored copy |
| 12 | Load survived | **done** — number below |
| 13 | Adversarial review | **not started** |
| 14 | Operations manual | **done** — OPERATIONS.md |
| 15 | Accessibility + budgets | **partial** — budgets in the suite; the a11y pass did not happen |

### 1 — You can run the store from your phone

Screenshots: `web/shots/admin-phone/`. Ten screens at 390×844 against real restored data.

**Zero screens scroll sideways.** The products table alone needed 728px of a 358px viewport.

Every daily screen now uses the dispatch pattern — two renderings from one data source, cards
below 640px, the existing table above. Orders, order detail, products, customers, coupons, gift
cards, loyalty, pulse.

**Order detail is the one to look at.** It now leads with **Update Status** — the dropdown, the
note, Update, and "Can't source an item" — then the customer with a tap-to-call number and the
WhatsApp button, then items, then money, then history collapsed behind "Show history (8)". It
used to put the status control *after* the entire item list and the full event history.

Three primitives that no screen could fix from its own file: Combobox option rows, Pagination
buttons, ConfirmDialog actions — all raised to 44px on a phone, unchanged above `sm`.

**The Pagination fix immediately broke something.** Seven 44px buttons do not fit in 390px, so
the page overflowed to 429px. The phone now shows a ±1 page window and the desktop keeps ±2.
Caught by re-running the measurement, not by thinking about it.

**And one blocker you would have hit this week:** the product-image delete button was
`opacity-0 group-hover:opacity-100`. A phone fires no hover — so on the device you actually work
from, the only way to remove a product image was a permanently invisible button.

**Still small (documented, not fixed):** 64 sub-40px targets on the products list and 9 on the
dashboard — mostly row checkboxes and inline Edit/Delete inside cards.

### 5 — Customer browsers report errors, and it was half-wired

Built first-party, errors only: message, trimmed stack, source, **route pattern** (`/product/:slug`,
never the full URL — a typed search term must not ride along), coarse UA family, timestamp. No
identifiers, no cookies, no page views, no third party. Rate-limited and size-capped, deduped
into the existing error store so client errors sit beside server ones and are distinguishable.

**The client half was installed and the server route was never mounted.** Every report a real
phone sent would have POSTed into the SPA catch-all and been answered with an HTML page — a
reporting feature that silently discards reports, which is worse than not having one. Mounted,
then smoke-tested end to end: 204 in, and it appears in your error list.

---

## The friction list

Full version: `.night/friction.md`. Twelve orders placed and worked through their whole lives;
**20 checks passed, 0 failed** — the business logic held up. These are the rubs.

| | Where | What | |
|---|---|---|---|
| F1 | Homepage | **Our Picks is empty.** The rail correctly hides rather than rendering empty, so launch morning has a homepage with no editorial. | **yours** — pick 8 |
| F2 | `POST /api/orders` | **No rate limit at all.** Login and password reset are capped; checkout is not. For a cash-on-delivery business a spam burst is real sourcing time spent on orders nobody accepts. | high |
| F3 | Order status API | The vocabulary is not discoverable. I guessed `ready` (it is `packed`) and skipped `dispatched`; every order dead-ended with `{"error":"Bad status."}`, which names the wrong value but never the legal ones. Your admin UI is fine — it offers only legal moves. | medium |
| F4 | `POST /api/orders` | Success shape is flat `{number, totalCents…}`, not `{order:{…}}`. I checked for `.order` and reported "0 placed" while twelve orders sat in the database. | low |
| F5 | Loyalty sweep | Header is `x-loyalty-sweep-key`; a wrong header gets a bare 404 that reads as "route does not exist". | low |

---

## The duplicate flag list

Full version: `.night/catalog-sweep.md`. Report only — nothing was merged, nothing was written.

**0 cross-feed duplicates.** 2,798,462 cross-feed pairs compared with the importer's own
algorithm (symmetric Jaccard ≥ 0.8, brand-prefix and volume stripped, bundle-only-matches-bundle).

**And it proves that zero is real** rather than a broken check: the same scorer finds **24
cross-brand pairs** and **882 pairs between 0.5 and 0.8**, printed so the threshold is auditable.
The feel22 importer's skip-at-import already caught these; nothing slipped past it.

| Check | Rows |
|---|---|
| Cross-feed duplicates, same brand | **0** |
| Same title, different brand (not duplicates) | 24 (2 both active) |
| Below threshold 0.5–0.8, shown for audit | 882 (68 visible) |
| **Active products with no image** | **1** |
| **Zero, negative or absurd prices** | **126** |
| Empty / brand-only names | 0 |
| Active products in an inactive category | 0 |
| Active products off the brand allowlist | 0 |

---

## The load number

Local cluster, real restored catalogue (1,178 active products). **This approximates the shape
after Stage C, not today on Neon** — today every number here is worse by the Ohio round trip.

**The current shape absorbs ~150 concurrent visitors with p50 under 1 s and zero errors.**
Nothing 500s, nothing drops, no checkout fails.

| Scenario | Ceiling | p50 @ high concurrency |
|---|---|---|
| Product pages | ~500 rps | 115 ms @ 40 |
| Browsing (48 + facets) | ~215 rps | 222 ms @ 50 |
| **Search** | **~67 rps** | **685 ms @ 50** |
| Checkout | 136 rps @ 20 | 143 ms, **0 failures over 106 orders** |
| Mixed burst | ~175 rps | 886 ms @ 150 |

**Search is what breaks first** — a third the throughput of browsing and the only thing whose p99
passes 1.3 s.

**CGNAT, answered properly.** My first pass hammered browsing from one shared IP, saw 0 × 429 in
300 requests, and would have reported "CGNAT-safe". That measured nothing: **browsing and
checkout carry no limiter at all.** On a route that *is* limited, one shared egress IP gets
**exactly 60 sign-ins per 15 minutes** — shared by everyone behind it. First 429 at attempt 61.

---

## Where I stopped

The session's agent budget ran out mid-flight. Three outcomes untouched:

- **7 — Resolution flows.** The rehearsal is the argument for it: all twelve orders went through
  unchanged, which is not how a source-per-order business runs. The survey mapped exactly what
  exists (`awaiting_customer` removes an item and recomputes money server-side; nothing swaps or
  adjusts quantity) — that map is in `.night/survey.json`.
- **9 — Launch promo.** Not started. The survey established what the Coupon model already has and
  what is missing (no first-order-only, no per-customer cap, no maximum-discount cap).
- **13 — Adversarial review.** Not started. It was scheduled last because it should review the
  promo, and the promo does not exist.

Also partial: **6** — the round-trip fixes landed in `index.ts` but the agent's audit table was
lost with its report, so I cannot give you the per-endpoint before/after numbers. **15** — budgets
are in the suite; the accessibility pass did not happen.

## Two things I would do first tomorrow

1. **Pick your 8 products.** It is the only thing standing between the homepage and looking
   finished, and it takes two minutes: Admin → Products → select → ★ Add to Our Picks.
2. **Decide on F2.** Checkout has no rate limit. I did not add one because blocking a customer
   mid-purchase is your call and CGNAT makes it risky — but a launch post plus one bored person
   is exactly when it matters.
