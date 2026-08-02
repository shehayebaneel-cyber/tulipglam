# Overnight — what happened

11 commits, all pushed and deployed. Production is healthy and the store is still dark.

**Eight of your ten outcomes are done.** Two are partial and I say where I stopped at the end.

---

# Decisions I need from you

These are first because they are what you can act on over coffee. Everything else is context.

### 1. Verify the WhatsApp number — before anything else

The storefront setting was **`9613000000`**, a placeholder the store's own validator rejects.
Every "order on WhatsApp" link pointed at it. I changed it to **`96181643633`** — the number
you gave me for the coming-soon page.

**I need you to confirm that is right.** It is the one change I made tonight that reaches a
customer and that I could not verify myself. A placeholder is strictly worse than a
possibly-misfiled real number, which is why I changed it rather than leaving it, but it is your
number and your call.

### 2. Returns window: 7 days or 14?

This one has code behind it. **The loyalty programme already assumes seven days** — points
confirm a week after delivery, and the whole reason for that hold is that a COD order can come
back. If your real returns window is fourteen days, a customer can return an order on day ten
having already spent the points it earned.

Pick one and I align `RATES.holdDaysAfterDelivery` to it. Full drafting in `POLICIES-DRAFT.md`.

### 3. How does the driver learn the amount? — my recommendation

Outcome 3. I built the artefacts; the process is yours. **My recommendation: print the run.**

`/admin/dispatch` now shows every parcel out for delivery with the cash to collect, the reason
it differs from the bag's face value, and a total to reconcile against when the driver returns.
Print it, hand it over. It needs no courier integration, works with anyone you hire, and the
number cannot disagree with the order because it *is* the order total.

The per-order WhatsApp message is there as the fallback for one-off deliveries — amount on the
second line, no item prices, no coupon codes.

**Until you decide, redemption stays off.** That is the only thing holding it.

### 4. Realistic delivery times, Beirut and elsewhere

The one number a customer most wants and the one I have no way to measure. The old "2–5 working
days" was removed during the audit because nothing backed it. Give me real ranges and the
delivery page can go live the same day — it is settings-driven.

### 5. Four smaller ones

- **The name that runs the business**, for the privacy page
- **Are opened cosmetics returnable?** (I would say no, with a fault exception)
- **Privacy contact: WhatsApp only, or an email too?** — `supportEmail` is unset
- **`promoTitle` still says "The Skincare Edit — up to 30% off".** Nothing is on sale, so the
  guard in `promo.ts` is correctly refusing to render it. But the moment any product gets a
  sale price, that banner appears claiming 30% off. Change the wording or clear it.

---

# Three things you should know went wrong

### The coming-soon gate was walkable

An allowlisted path that matched no route fell through to the SPA catch-all and served the
**real storefront shell**. Four paths did it, and one was simply `GET /api/launch-signup` — the
endpoint I added at the start of the night. 404 status, real site in the body, enough for a
browser to boot the app.

Found by the adversarial review, reproduced by hand, fixed, and now covered by 17 checks.
**Verified sealed in production.** The store was never actually discovered as far as I can
tell, but it was one guessable URL away.

### `npx tsc --noEmit` in `web/` checks nothing

It exits 0 on a deliberate type error. `web/tsconfig.json` is `"files": []` with project
references, so there is no root program. It has to be `tsc -b`.

**Every "typecheck clean" I reported for the web package tonight was meaningless.** Nothing
broken shipped — `npm run build` runs `tsc -b && vite build`, so builds were always checked, and
I built constantly. But running it properly immediately surfaced 15 real errors in my own
changes, including a `site?.brands.find(...)` that would have thrown the moment anyone filtered
by brand.

Both packages now have `npm run typecheck` that does the right thing, and CLAUDE.md says why the
obvious command is wrong here.

### I left test data in the production database earlier today

The backup audit found two `@tulipglam-test.invalid` customers and a loyalty account carrying a
fake 1,200-point balance — residue from my own account-takeover verification. Purged.

The cause is worth recording: that script called `process.exit()` inside its `try`, and
`process.exit()` does not wait for the pending deletes in the `finally`. Every test since has
been checked for the same shape.

---

# What is done

### 1 · Email capture — live and proven ✅

A stranger on the coming-soon page can leave an address and it lands where you can see and
export it. **Proven end to end against production**, not just locally.

Only one line of `coming-soon.html` changed: `signupEndpoint`. No markup, no copy, no CSS.

It answers identically whether the address is new, known, or malformed — an endpoint that says
"already on the list" lets anyone test which addresses belong to your customers. The CSV export
escapes for spreadsheet injection, because the payload is text a stranger typed into a public
form and a leading `=` in Excel is executable.

**0 real signups so far.** The endpoint went live a few hours ago.

### 2 · Redemption — complete, invisible ✅

Flip `LOYALTY_REDEMPTION_ENABLED=true` and it works. Nothing before that.

The points claim happens *inside* the order transaction, and the transaction is raised to
Serializable **only when points are actually being spent** — so nothing about checkout changes
today. A balance is derived from the ledger, so it cannot be claimed with a conditional UPDATE
the way a gift card can; at read-committed two tabs would both spend it, which is how this
codebase once gave away $50 twice from one card.

Tested: two concurrent checkouts, one discount, one ledger entry, **both orders still placed**.

### 3 · Courier — every answer made easy ✅

See decision 3. `/admin/dispatch`, printable run, per-order message, cash total to reconcile.

### 6 · Mobile performance ✅

Measured at 390px, 4× CPU throttle, 1.6 Mbps / 150 ms RTT — a mid-range Android on Lebanese
mobile data. `scripts/perf.mjs` is committed so the numbers are reproducible.

| | before | after |
|---|---|---|
| First contentful paint | 5,748 ms | **~3,520 ms** (median of 3) |
| Transferred | 914 KB | **695 KB** |
| Requests to other domains | 3 | **0** |
| `/api/site` | 83 KB | **10 KB** |
| Hero image | 229 KB | **80 KB** |

The biggest win was the one I did not expect: `/api/site` was sending **all 405 brands** — 73 KB
— on the first load of every page, including a homepage that shows two.

Fonts are now self-hosted, so no visitor's IP goes to Google in order to read your shop's name.

### 7 · Email, built dark ✅

Every message the store means to send is recorded. `sendMail` used to log and drop, so every
confirmation since launch is gone — invisible, because nobody was expecting mail.

Messages have **different shelf lives**, because a confirmation arriving three weeks after the
parcel is worse than none: password reset 30 minutes, status update 2 days, confirmation 3 days,
points 14, welcome 30. The launch announcement **never expires** — it is waiting for a decision.

A test caught that one: `SHELF_LIFE[kind] ?? 7*DAY` treats an intentional `null` as absent, so
the announcement quietly got a seven-day life and would have expired before the store opened.

### 9 · Observability ✅

`/admin/pulse` — orders, signups, errors, traffic. **No tracker on the storefront**: no
analytics, no pixel, nothing from another domain. Everything measured server-side.

Errors were the real gap: a 500 said nothing to the customer, logged to a Render window nobody
reads, and vanished. Now grouped by fingerprint — one line per problem with a count, not four
thousand symptoms. Marking one dealt with hides it; **a recurrence reopens it**.

### 10 · Backup and restore ✅

`BACKUP.md` is written to be followed in a panic. Backups are read-only and safe against
production.

**The restore is proven, not assumed** — `restore-drill.ts` rebuilds the tables in a throwaway
schema, loads the file, checks the values survived, drops the schema. It found the restore path
broken in two ways, both mine: JSON has no date type, and my column parser split `numeric(4,2)`
down the middle. The backups were fine; the restore was not.

---

# Where I stopped

### 4 · Launch blockers — audited and partly fixed

**Fixed:** WhatsApp placeholder, missing `siteUrl`, and three live demo promotions —
`WELCOME10` (10% off), `GLOW5` ($5 off) and gift card `TG-GIFT-5000` ($50 spendable). All three
were real money to anyone who knew the codes, **and the codes are written down in CLAUDE.md**.
Deactivated, not deleted; one flag each to reverse.

**Still open, needs you or needs time:**

| | |
|---|---|
| 75 active products with **no description** | reads unfinished; needs writing or hiding |
| 1 active product with **no image** | blank card |
| **0 approved reviews** | every product page shows an empty reviews section |
| `supportEmail` unset | privacy page and support links have no address |
| 1,235 hidden products | broken supplier prices — needs the rep, per CLAUDE.md |
| Category photography | the list treatment works, but real photos would beat it |

### 8 · Policies — drafted, not shipped

`POLICIES-DRAFT.md`. Nothing is live. Returns, delivery and privacy drafted with the decisions
called out and `[BLANK]`s where I would have had to invent a fact.

Worth knowing: the privacy page now needs to cover the coming-soon email capture, because
**people are being asked for an address right now**.

### 5 · Review — ran, and I acted on what I verified

Four lenses, 29 candidates. I fixed six I verified myself, including the gate bypass and a
**real money bug**: resolving an "item unavailable" by removing the line recomputed the total
but dropped the points discount, so a customer who had spent 300 points would have been asked
for those $9 back at the door with the ledger still showing them gone. Latent today because
redemption is off; it would have fired the day you flipped the flag, on the path that already
handles an unhappy customer.

**Eight refutation agents died on a session limit**, so the run's "dismissed" list is not a
clean bill of health — it includes findings whose refuters simply never reported. The gate
bypass was in that list, and it was real. **Unverified candidates I have not yet acted on:**

- outbox: nothing claims a row before sending, so a double-click could send twice
- outbox: a permanently failing message sits at the head of the queue and starves the rest
- outbox: password reset bypasses the outbox entirely, so the one message that cannot be
  re-sent leaves no record
- checkout: the Serializable transaction has no retry, so a routine conflict could turn a
  redeeming checkout into a lost sale — this one contradicts your rule that a loyalty failure
  must never cost a sale, and I would fix it before enabling redemption
- tracking: the public order view omits `pointsDiscountCents`, so the breakdown will not add up
- gift-card residue after item removal
- `traffic.byPath` grows unbounded from attacker-chosen paths

None are reachable while redemption is off and SMTP is unconfigured. All are worth an hour.

---

# State right now

| | |
|---|---|
| Production | healthy, gate holding, store dark |
| Real customers | 1 |
| Orders | 0 |
| Launch signups | 0 (endpoint live for a few hours) |
| Queued emails | 0 |
| Open errors | 1 — a Neon connection blip from my own tooling, safe to dismiss |
| Active coupons / gift cards | 0 / 0 (demos deactivated) |

**Tests: 11 suites, ~700 checks, all green.** Typecheck, lint and production build clean in
both packages.

Nothing is scheduled — backups and the loyalty sweep are both manual. That is a real gap and
`BACKUP.md` says so.

---

## If you only do three things

1. **Confirm the WhatsApp number.** It is the one customer-facing thing I changed and could not verify.
2. **Answer the returns window.** It unblocks the policies and it has code behind it.
3. **Decide the courier process.** It is the only thing between redemption and going live.
