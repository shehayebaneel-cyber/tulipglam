# TulipGlam — full-site audit

Started 2026-07-30. Findings verified against the running app (Vite 5330 / API 4230) and the
live Neon database, not by eye. Contrast is real WCAG math, brand ordering was traced to the
actual SQL, and every count below came from a query.

Legend: **FIXED** · **DEFERRED** (with reason) · **BLOCKED** (needs something only the owner has)

> Status reflects reality at the moment of writing. TODO items are on the worklist below,
> not silently assumed done.

---

## Verified facts this audit rests on

| Fact | Value |
|---|---|
| Products | 9,672 (9,533 visible, 139 hidden) |
| Brands | 405 |
| Products with a sale price | **0** |
| Orders | 0 |
| Images | 9,950 |
| Routes returning 200 | 29/29 |
| Storefront API endpoints healthy | 6/6 |

### Contrast (computed, sRGB relative luminance)
| Pair | Ratio | Verdict |
|---|---|---|
| `muted` #8B8790 on surface | 3.52:1 | **FAIL** for body text |
| `muted` on paper | 3.43:1 | **FAIL** |
| `muted` on soft | 3.16:1 | **FAIL** |
| `muted-strong` #6B6673 on surface | 5.57:1 | PASS |
| `ok` #2F8A5B on surface | 4.28:1 | **FAIL** (small text) |
| plum on surface | 10.00:1 | PASS |
| sale on surface | 5.90:1 | PASS |
| ink on surface | 17.35:1 | PASS |

`muted` is used for secondary text across the whole storefront, so this is a sitewide failure.

---

## Phase 1 — False and dangerous claims

### 1.1 Homepage promo band — FIXED
Live copy was *"The Skincare Edit — up to 30% off · Serums, moisturisers and masks from
Aureli, Novi & Botanique. While stocks last."* Every clause was false:
- Aureli, Novi, Botanique: confirmed **absent** from the database (deleted in the Dali import).
- Sale prices in the catalogue: **0**, so "up to 30% off" was untrue.
- "While stocks last" contradicts the zero-inventory model.

Resolved server-side in `server/src/promo.ts`; `Home.tsx` has no fallback copy of its own.
The band withholds itself when it is off, has no title, its scope names a brand/category that
does not exist / is inactive / holds no visible products, **or the wording promises a discount
that no in-scope product backs**. That last rule covers claims written into the title or body,
not just the separate discount field. Verified across 13 resolution paths including the deleted `aureli` scope.
**Current result: the band does not render.** Correct — there are no sale prices.

### 1.1b Stock-implying copy — FIXED
Added a check that refuses any promo whose copy implies inventory ("while stocks last",
"only N left", "selling fast", "limited stock"). The business holds none.

### 1.2 Trust bar — FIXED
Was hardcoded: *"100% authentic — genuine brands only"* and *"All of Lebanon — fast, tracked
dispatch."* There is no tracking system — only a manually-updated 13-step status timeline.
Now Settings-driven (`trustItems`), defaults rewritten to describe what exists: order status
checkable by number, no login needed. Unsupportable claims can now be removed without a deploy.

### 1.3 Sale nav + route — FIXED
Zero products have sale prices, so the nav item (styled in `#B23A3A`) led to an empty page.
Nav item and route now self-suppress unless at least one product has a sale price.

### 1.4 Placeholder contact details — FIXED (validation + sitewide degradation)
WhatsApp is `9613000000`; Instagram and contact email echo the store name. Checkout depends
entirely on WhatsApp, so **no order could reach the owner**.
- Strict validation in admin Settings rejects repeated-digit runs, sequential runs,
  `example.com`, dummy handles, malformed addresses. All-or-nothing save, per-field errors.
- Every WhatsApp CTA sitewide (checkout, order success, gift cards, footer, contact, admin
  orders) now detects an unconfigured/placeholder number and renders disabled with an
  explanation instead of a dead `wa.me` link.
- Footer Instagram/email links hide rather than link to nothing.
Sitewide degradation implemented this pass via `waUsable()` / `waHref()` in `lib/api.ts`,
mirroring the server rules: checkout CTA, order-success confirm, gift-card order, contact card
and footer links all render inert with an explanation when the number is missing or a
placeholder. Verified: with `9613000000` configured, every one degrades.
**The real values remain BLOCKED — see the BLOCKED section.**

### 1.5 Setup-incomplete banner — FIXED
Admin Dashboard lists every unconfigured or placeholder setting in three tiers —
`placeholder` (a wrong value that looks right, worst), `missing`, `unverified` (valid but
self-referential) — each with a direct link. Dismissible per session only (`sessionStorage`),
never permanently.

### 1.6 ADMIN_KEY — FIXED
Server refuses to boot when `NODE_ENV=production` and the key equals the repo default; exits 1
with rotation instructions. Verified both ways. No secret added to the repo; endpoints expose
only the boolean `adminKeyIsDefault`.
Admin gating audited: **every** `/api/admin/*` route sits behind one `requireAdmin` middleware
that compares the header key; verified 401 with no key, a wrong key, and on the bulk endpoint.
`/admin` in the client is a convenience gate only — the server is the real boundary.

---

## Phase 2 — Homepage

### 2.1 Navigation — FIXED
15 top-level items in one row, several wrapping mid-label. Restructured into 6 groups with
dropdown panels; labels use `white-space: nowrap` so nothing can wrap. Mobile drawer rebuilt
as an accordion.

### 2.2 Category naming — FIXED
Nav said Fragrance/Hair/Bath & Body; cards said Fragrances/Haircare/Body & Bath, because the
card labels were **baked into image files** while the nav read the database. Now a single
database-derived name everywhere.

### 2.3 Category grid — FIXED
Was two incompatible card types: image cards with name+tagline burned into the file (no
caption, off-palette beige/gold/baby-blue/pink backgrounds) and glyph placeholders with
captions. Different heights across rows. One `CategoryCard` component now; text is always live
DOM, uniform aspect ratio, plum-family tints.

### 2.4 New arrivals single-brand — FIXED
Verified: the newest 12 active products were **Lattafa ×12**. Added per-brand capping
(max 2 per row) with recency-ordered backfill.

### 2.5 Carousel clipping — FIXED
Scroll-snap and padding corrected so cards land on boundaries; swipeable at 390px.

### 2.6 Featured brands — FIXED
Not alphabetical as assumed — `/api/site` ordered by `[featured desc, sortOrder asc]` with
**no name tiebreak**, and 403 brands share `sortOrder=50`, so Postgres returned heap order that
merely looked alphabetical. Result included *Abercrombie and Fitch (1 product)* and
*Acnevit (2 products)*. Now an admin-curated ordered list with a minimum-product threshold,
falling back to product count — never raw insertion order.

### 2.7 Hero — FIXED (asset BLOCKED)
Heading, subheading, both CTAs and the image are now Settings-driven. The existing image is
visibly AI-generated; **a real photograph is BLOCKED on the owner.** Also removed the
three-stop CSS gradient behind the hero (constraint: no gradients).

---

### 2.8 Department counts read 0 — FIXED (found while verifying 2.1)
Departments hold no products directly, so `_count` returned 0 and both the nav and the
category cards displayed "Makeup 0" for a department with 1,951 products. Child counts now
roll up; the 13 departments sum to exactly 9,533, matching the visible product total.

---

## Phase 3 — Shop, category and filtering

### 3.1 Brand filter — FIXED
405 brands as an ungrouped **radio** list running thousands of pixels. Radios also forced
single-select, which is wrong for a filter. Now searchable, height-capped, **multi-select
checkboxes**, selected pinned to top, show-more affordance.

### 3.2 Filters not scoped — FIXED
Facets are now computed from the current result set with counts; zero-result options hidden.

### 3.3 Brand mis-sorting — FIXED (root cause found)
Not whitespace — **zero** brands have leading/trailing/double spaces. The cause is 2.6's
missing tiebreak: `Dr Pawpaw` sat between `Lakme` and `Lazartigue` because all Feel22 brands
share `sortOrder=50` and the query had no secondary sort. Now sorted on a normalized,
trimmed, locale-aware key (`Intl.Collator`) in SQL and in every client list. Verified the same
bug on `/brands` and in admin — both fixed.

### 3.4 Unavailable products in prime slots — FIXED
Verified: `/category/makeup` 3 of the first 8 unavailable; `/category/nails` 5 of 8. Default
Featured ordering now sorts unavailable and discontinued last, and an "Available only" toggle
defaults on.

### 3.5 Missing filters + URL state — FIXED
Added price range, availability and in-department category refinement, active-filter chips
with individual dismiss and Clear all, and full URL sync of filter/sort/page/search.

### 3.6 Card image framing — FIXED
Fixed aspect ratio, `object-fit: contain`, consistent padding and neutral bed.

**Superseded 2 Aug** — the ratio was 4:5 and the catalogue then measured **98.2% square**, so
the bed was letterboxing nearly every product with dead space above and below. Now square, and
served from generated WebP derivatives rather than the source PNG. See the 2 August section.

### 3.7 Unavailable overlay — FIXED
Heavy dark bar replaced with a compact on-palette badge reading "Unavailable";
discontinued gets its own distinct treatment.

### 3.8 Pagination — FIXED
Page numbers, first/last jump, "Showing X–Y of Z". Sorting and filtering confirmed
server-side across the whole result set, never page-local.

### 3.9 Sorting — FIXED
Added price asc/desc, newest and name. Featured is now a deliberate ordering
(availability, then best-seller, then recency) rather than insertion order.

### 3.10 Filters that lie — FIXED (found while building 3.5)
"Good for" offered 9 concerns and "Attributes" offered 5, all hardcoded in the client. Checked
against the database: `concerns` and `attributes` are empty on **all 9,533 visible products**,
so every one of those 14 options led to "Nothing here yet". Both groups are now built from a
server facet over what the catalogue actually carries, with counts, so an option exists only
if something is behind it — and the groups return on their own once products are tagged.

---

## Phase 4 — Brands page

### 4.1 Search + A–Z — FIXED
405 brands in an unsearchable grid meant scrolling past four hundred cards to find one. Added a
search box and an A–Z jump strip, with the list grouped into letter sections. Filing uses the
same key the server sorts by, so "L'Oréal" is under L and "The Aloelab" under A; diacritics are
folded, and anything not starting with a Latin letter goes to "#" rather than inventing a
section. Letters with nothing behind them render disabled, so the strip keeps a stable shape.

Cards became dense rows: only **2 of 405** brands have a blurb, so the card layout left a large
empty gap on the other 403.

The endpoint now sorts with the same collator as everything else and drops brands with no
visible products (currently none, but a card linking to an empty shelf is a dead end).
Verified: 0 out-of-order pairs across all 405, and "Dr Pawpaw" now sits with the other Dr
brands rather than between Lakme and Lazartigue.

### 4.2 Single-product brands — FIXED, differently from the plan
The plan was to hide brands below a threshold into an "Also available" section. Building the
A–Z index made that wrong: hiding a thin brand removes it from its letter, so the one shopper
looking for it can no longer find it — the exact problem 4.1 set out to solve.

Every brand stays in the directory, and each row carries its product count. "1 product" sets
the expectation honestly; hiding it never could. Distribution, for the record: 43 brands with
1 product, 29 with 2, 29 with 3, 18 with 4, 72 with 5–9, 214 with 10+.
### 4.5 Announcement bar quoted a hardcoded figure — FIXED (found while measuring the header)
The bar fell back to the literal string "Free delivery over $60", duplicating a number that
lives in `freeDeliveryThresholdCents`. True today only by coincidence: move the threshold and
every page of the site advertises a discount checkout will not apply.

The fallback is derived from the real figure now, and the claim is dropped entirely if no
threshold is set. The stored value is left alone — instead `checkFreeDeliveryClaim()` refuses
a save where the two disagree and raises it on the Dashboard, so the owner's words are never
rewritten for them. 12 cases verified, including "$60" appearing elsewhere in the same string.

### 4.3 Name normalization — FIXED (script written, dry-run verified, NOT RUN)
### 4.4 Brand curation tooling — FIXED (report below, no data changed)

---

## Phase 5 — Off-palette UI

Confirmed off-palette literals: `#25D366` WhatsApp green in 5 files, `#b7791f` in Track,
`#faf3ef`/`#f4e1eb`/`#f1e9e4` hero gradient, `#000` in `.btn-ink:hover`, plus 32 `btn-ink`
(black) usages across 20 files.

- 5.1 Single `Button` primitive with primary/secondary/tertiary/destructive — **FIXED** (all 32 `btn-ink` usages in the storefront converted; only a comment mentions it now)
- 5.2 WhatsApp green restyled to plum with a WhatsApp glyph — **FIXED** (`#25D366` gone from the storefront)
- 5.3 Amount-chip selected state now border + tint + checkmark — **FIXED**
- 5.4 Login show/hide password + forgot-password — **FIXED**. Every field had a placeholder
  and no `<label>`, so the label vanished the moment you typed. Real labels, autocomplete
  hints password managers understand, and a show/hide toggle that reports its state with
  `aria-pressed` rather than only swapping an icon.

  Forgot-password is a real token flow (`PasswordReset`, new table): single-use, 30-minute
  expiry, only the SHA-256 of the token stored, earlier unused tickets retired when a new one
  is issued, and the same response whether or not the address is registered — otherwise the
  endpoint becomes a way to test which addresses have accounts. A used link says it was used
  rather than "invalid", which would send someone hunting for a typo.

  **The link is only offered when mail can actually be sent.** Order and status emails degrade
  quietly without SMTP because WhatsApp carries the conversation; a reset has no such fallback,
  so a form that silently sends nothing would be worse than no form. `/api/site` publishes
  `emailConfigured` (a boolean, never the credentials), and with mail unconfigured the page
  says so and points at WhatsApp. 13 checks in `scripts/test-password-reset.mjs`.
- 5.5 Gift-card copy made specific; terms surfaced inline — **FIXED** (3-step flow + terms beside the CTA)

---

## Phase 6 — Admin
6.1 Product list — **FIXED** (previous pass; re-verified this audit)
6.2 Orders — transitions, `awaiting_customer` UI and money breakdown **FIXED**;
    coupon/gift-card concurrency **FIXED** — see 6.2 below
6.3 Dashboard zero-state — **FIXED**

---

### 6.2 Checkout gave away money under concurrency — FIXED (real bug, reproduced)
Checkout read a gift card's balance, computed the discount, created the order, and only then
decremented. Two orders paying with the same card at the same moment both saw the full balance,
both applied it, and both decremented. Reproduced against a throwaway $5 card:

    OLD read-then-write:  applied 1000c from a 500c card, balance now -500c  <-- OVERDRAWN
    NEW conditional:      applied  500c from a 500c card, balance now    0c  <-- correct

A `maxUses: 1` coupon went the same way — `usedCount` read, order created, then incremented.
The window is small, and it is exactly the window that opens when a code is shared in a
WhatsApp group.

Both are now *claimed* rather than read-then-written, and the order is written in the same
transaction as the claim. Each claim is a conditional UPDATE (`balanceCents >= want`,
`usedCount < maxUses`); Postgres re-evaluates the WHERE after waiting on the row lock, so a
claim that would overdraw matches no rows and the code falls back. No advisory locks, no
SERIALIZABLE retries. The gift-card path retries once against the balance the winner left
behind, bounded so it cannot spin.

A losing claim does not fail the order — it goes through at the real price, and the response
reports the numbers actually applied.

### 6.3 Public API published the whole settings table — FIXED (found while adding emailConfigured)
`/api/site` returned `settings` verbatim. Nothing sensitive is in there *today*, but only
because SMTP has never been configured — saving an SMTP password in admin would have published
it to every visitor. Replaced with an allowlist, which fails closed: a new setting is private
until it is deliberately named.

---

## Phase 7 — Cross-cutting
7.1 Accessibility — **FIXED**. Note: the header account/wishlist/bag icons *already had*
    `aria-label`s; the real failures were contrast (above) and keyboard operation of nav,
    filters and carousels.
7.2 Performance — **FIXED**.
- **The whole back office shipped to every shopper.** Twelve admin screens sat in the same
  bundle as the storefront, so a phone downloaded and parsed all of it before seeing a product.
  One operator uses admin; thousands of visitors were paying for it. Split out with `lazy()`:
  **556 KB → 433 KB** (124 KB gzipped), with ~112 KB of admin now loaded only on /admin.
  Storefront pages stay eager on purpose — they are the critical path.
- **Everything revalidated on every visit.** Express's default is a `Last-Modified` check, so a
  returning shopper made a conditional round trip to us-east-2 for each of ~48 product photos
  before a single 304 came back. `/assets/*` is content-hashed so it is now immutable for a
  year; product photos get a week, because a re-import can overwrite a filename in place.
- LCP images (hero, product main) are `fetchPriority="high"`; everything below the fold is
  lazy. Layout shift was already handled — every image sits in an aspect-ratio box.

- **Placeholder-as-label, everywhere.** Checkout, Account, Gift cards and Login used the
  placeholder as the only label, so once you had typed, nothing on screen said which box held
  the phone number — and a screen reader got no reliable name for the control. Checkout is the
  form an order depends on. Real `<label>`s throughout via `components/Field.tsx`, plus
  `autocomplete` so a phone can fill the address in one tap.
- **No skip link.** The header holds a menu button, wordmark, search, account, wishlist, bag and
  six nav groups with dropdowns, so reaching the products by keyboard meant tabbing through all
  of it on every page. Added, with `tabIndex={-1}` on `<main>` so focus actually moves rather
  than the page merely scrolling.
- Show/hide password reports state with `aria-pressed`, not just a swapped icon.

Still open: the two Google Fonts families are third-party and render-blocking. Self-hosting
them is a separate task with its own risk (unicode-range subsetting).
7.3 SEO/metadata — **FIXED**, server-side.
Client-side meta tags would have been useless for the one channel that matters: **WhatsApp's
link preview crawler does not run JavaScript**, and pasting a product link into a chat is how
products actually get shared here. Every share produced the same generic homepage card with no
photo, name or price.

`server/src/seo.ts` resolves the `<head>` on the server and injects it into the built
index.html — title, description, canonical, Open Graph, Twitter card, and JSON-LD
(`Product` + `BreadcrumbList`, `Store` on the homepage).

Details that matter:
- `availability` is `LimitedAvailability`, never `InStock` — nothing here is stocked, and
  `InStock` would be a structured-data claim the business cannot make.
- **No `sku`.** `Product.sku` is the *supplier's* reorder code. My first version published it
  in JSON-LD, which would have handed a competitor the sourcing list. Caught and removed;
  there is now a test asserting neither product nor variant SKUs reach any public surface.
- The catch-all route answered **200 for every unknown path**, so mistyped URLs were indexable
  as real pages. Unknown paths and missing slugs now answer 404.
- Cart, checkout, account, login, wishlist and search are `noindex`.
- `robots.txt` and `sitemap.xml` are generated from live data — **9,587 URLs, 1.5 MB**, inside
  the 50,000-URL protocol limit, cached 10 minutes.

32 checks in `scripts/test-seo.mjs`. Requires a build: in development Vite serves index.html
itself and none of the injection runs.

**Needs `siteUrl` set in Settings** — behind Render's proxy the request host is internal.
Flagged on the Dashboard until then.
7.4 Error handling — **FIXED**.
Home, Shop, Brands and the audience pages all destructured `error` from `useFetch` and then
ignored it, so a 500 or a dropped connection rendered **"Nothing here yet"** — telling a shopper
the catalogue is empty when nothing had loaded. Same class of problem as the promo that
advertised a discount that didn't exist: the page states something untrue with confidence.

Added `ErrorState` (what failed, and a retry that actually works — `useFetch` gained `reload`,
since the only recovery before was a full refresh) and an `ErrorBoundary` around the app so a
render crash shows a page instead of a blank screen.

The 404 offered exactly one link, home — the least useful destination for someone who arrived
with something specific in mind. It now seeds a search from the path they tried, since a dead
product link (stale bookmark, or a slug an import renamed) is the common case.
7.5 Policy pages — **FIXED**. Four claims the business could not back:
- *"Orders of $60 or more qualify for free delivery"* — the same hardcoded figure as the
  announcement bar, duplicating `freeDeliveryThresholdCents`. Now read from it.
- *"Most orders arrive within 2–5 working days"* — an invented delivery promise. There is no
  courier integration, no tracking and no SLA behind it, and a customer holding us to it would
  be right to. Now the `deliveryEstimate` setting; the sentence doesn't appear until someone
  who knows the answer fills it in.
- *"everything we carry is 100% genuine, sourced from official brand channels"* — the worst of
  them. The catalogue comes from three retail suppliers, not from the brands, so this is an
  authenticity guarantee the store is in no position to give. Replaced with what is true.
- *"contact us within 48 hours"* — a deadline nobody chose. Now the `returnsWindow` setting.

Also: the privacy page claimed we collect "only name, contact number and delivery address",
which was incomplete and therefore inaccurate — it now describes what the code actually stores
(email, a password hash, saved addresses, and the cart/wishlist/token that live in the
browser), and the gift-card page stops promising email delivery when no mail is configured.
Every policy page carries a last-updated date.
7.6 Checkout money math — **FIXED**. `scripts/test-checkout-money.mjs` drives real orders
through the API and deletes them afterwards. 17 checks: the free-delivery threshold at the
last qualifying cent below it, exactly on it, and past it (proving the comparison is `>=`,
not `>`); percent and fixed coupons; a coupon below its minimum; a gift card larger and
smaller than the total; and the two race conditions in 6.2. It picks a product whose price
divides the threshold so the boundary is hit exactly — $60.00 itself, not $59.85 and $60.80
either side — and says so when no such product exists.

Confirmed deliberate, not a bug: the threshold is compared against the subtotal **before**
discount, in checkout and in the admin recompute alike, so a coupon cannot take an order back
under it.

---

## Phase 8 — Men's / Women's
Confirmed the catalogue supports this: **For Him 327**, **For Her 358**, **Unisex 287**
products already exist as fragrance categories, and word-boundary name matching finds **391**
men-signal products spanning 8 departments (Fragrance 212, Deodorant 78, Skincare 30,
Accessories 29, Sets 22, Hair 12, Bath & Body 7, Makeup 1).

This is why Men cannot be a 13th department — implemented as an additive `audience` field
(`unisex` / `men` / `women`). `/men`, `/men/:department`, `/women` and
`/women/:department` share one parameterised implementation (`pages/Audience.tsx`); two
near-identical pages drift, and a fix applied to one silently skips the other.

Admin surface: a "Shop for" select in the product editor, an audience filter and bulk action
in the product list, and a brand-level default on `Brand.audience` that the classifier treats
as a stated fact — 404 brands is a far smaller job than 9,533 products, and settling "Axe"
settles every row under it.

`audienceLocked` marks a human decision, and only *changing* the value counts as one.
Locking on every save would mean fixing a typo pinned the audience to "unisex" forever.

**The pages are live but empty**, because the classifier is dry-run only and nothing is
classified yet — `/api/audience/men` returns 0. They say so, rather than showing a bare empty
grid, and the nav links stay hidden until there is something behind them. Running the
classifier is the owner's call — **see BLOCKED**.

False-positive guard verified: "Treatment", "Ointment", "Amenity"-style substrings do **not**
match, because matching is on word boundaries.

---

## BLOCKED — needs you

1. **Real WhatsApp number.** Checkout cannot deliver an order without it. Validation and the
   disabled-state degradation are built; the value must be yours. Admin → Settings.
2. ~~**Real Instagram handle**~~ — **DONE 3 Aug**: `https://www.instagram.com/tulipglam.lb/`,
   given by the owner. It replaced `https://instagram.com/tulipglam` — a placeholder plausible
   enough that the footer had been linking to a handle that is not theirs.

   **Contact email is still needed.** `hello@tulipglam.com` is a self-referential placeholder and
   the footer renders an Email button for it, so the store currently invites people to write to a
   mailbox nobody has confirmed exists. Either give a real address or say the word and the button
   goes, the way the trust bar did.
3. **Real hero photograph.** The current image is visibly AI-generated, which undercuts an
   authenticity-based proposition. Hero is now fully Settings-driven — upload and set it.
   I did not source or generate a replacement.
4. **`/men` and `/women` hero images.** Same: configurable, deliberately left empty.
5. **Run the audience classifier.** Report-only by default. Review, then run with the write flag:
   ```
   cd server && npx tsx scripts/classify-audience.ts            # report only
   cd server && npx tsx scripts/classify-audience.ts --write    # applies
   ```
6. **Run the brand-name normalization.** Report-only by default:
   ```
   cd server && npx tsx scripts/normalize-brand-names.ts
   cd server && npx tsx scripts/normalize-brand-names.ts --write
   ```
7. **Rotate `ADMIN_KEY` in Render** before/at the next deploy, or production will refuse to
   boot by design.
8. **Decide which brands to hide.** Tooling and the report are built; the editorial call is yours.
9. **Pricing.** Every price still equals the supplier's retail price, so margin is ~zero. Left
   untouched as instructed.

---

# 2 August — worked from the top; what is left is all yours

Everything in Phases 1–6 above still reads FIXED and I re-read the list rather than assuming.
**The punch list has no unambiguous items remaining.** The nine in BLOCKED are the whole
residue, and each of them needs a value, a photograph, or an editorial decision that is not
mine to make. I did not run the audience classifier or the brand normaliser: both are listed
as needing your review first, and both write to the live catalogue.

### Corroborated, not merely repeated

**BLOCKED #3 — the hero is AI-generated.** Confirmed again today from the rendered page
(`shots/before/home.png`), and there is now a **second** instance: a Beesline product photograph
whose filename is Google Gemini's own output convention,
`Gemini_Generated_Image_8hgb1o8hgb1o8hgb_…png`, flagged by the image pipeline and listed in
`IMAGE-SUSPECTS.txt`.

A generated hero is a mood; a generated *product* photograph is a claim about an object a
customer will hold. Raised as DECISIONS.md §2 rather than acted on — which product it belongs to
and whether it was deliberate is yours to know.

### New this day, and relevant to items above

- **3.6 superseded** (see inline note): 4:5 → square, and every surface now serves derivatives.
- **New: image sources are audited.** 10,110 files measured; 19 flagged in `IMAGE-SUSPECTS.txt`,
  including two corrupt PNGs. **One of those is the only image of an ACTIVE product** (Huda
  Beauty Lip Contour Lip Stain) — a replacement photograph is content, so it joins BLOCKED.
- **New: checkout renders a stripped shell.** The full header, the fifteen-link footer and the
  fixed bottom nav are gone from `/checkout`. Confirm or revert — DECISIONS.md §4.
- **Not re-verified against the live catalogue.** Neon was unreachable for most of the day, so
  today's storefront screenshots came from a fixture harness built on the real Dali catalogue.
  Honest, but not the same as the database. Worth one re-run before trusting them fully.

### BLOCKED gains one

10. **A replacement photograph for Huda Beauty Lip Contour Lip Stain For 12-Hour Wear.** Its
    only image file is a corrupt PNG that cannot be decoded, so the product currently renders as
    the house glyph. The product is `active`.
