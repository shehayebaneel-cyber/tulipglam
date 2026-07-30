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

### 4.1 Search + A–Z — TODO
### 4.2 Single-product brands — TODO
Distribution: **43 brands with 1 product**, 76 with 2–4, 70 with 5–9, 163 with 10–49, 53 with
50+. Directory now hides brands below a configurable threshold into an "Also available"
section; still reachable by URL and filter.
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
- 5.4 Login show/hide password + forgot-password — **TODO**, honest about delivery when SMTP
  is unconfigured (no silent no-op link)
- 5.5 Gift-card copy made specific; terms surfaced inline — **FIXED** (3-step flow + terms beside the CTA)

---

## Phase 6 — Admin
6.1 Product list — **FIXED** (previous pass; re-verified this audit)
6.2 Orders — transitions, `awaiting_customer` UI and money breakdown **FIXED**;
    coupon/gift-card concurrency **TODO**
6.3 Dashboard zero-state — **FIXED**

---

## Phase 7 — Cross-cutting
7.1 Accessibility — **TODO**. Note: the header account/wishlist/bag icons *already had*
    `aria-label`s; the real failures were contrast (above) and keyboard operation of nav,
    filters and carousels.
7.2 Performance — **TODO**
7.3 SEO/metadata — **TODO**
7.4 Error handling — **TODO**
7.5 Policy pages — **TODO**
7.6 Checkout money math — **TODO** with boundary tests at $59.99 / $60.00 / $60.01

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
2. **Real Instagram handle and contact email.** Currently self-referential placeholders.
   Links hide themselves until set.
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
