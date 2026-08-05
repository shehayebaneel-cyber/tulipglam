# TulipGlam — CLAUDE.md

## What this is
**TulipGlam** — a premium beauty e-commerce store for Lebanon (makeup, skincare,
bath & body, hair, fragrance, accessories, gift sets). Prices in **USD ($)**.
**Mobile-first** — most customers shop on phones; the 390px experience is the
primary design, desktop is the enhancement. Feel: **minimal luxury** (clean space,
refined type, elegant, trustworthy, fast).

## Business model (important — no inventory)
Owner holds **no stock**. Products are listed from sources; after an order the owner
sources + delivers. So: **NO** stock counts, low-stock alerts, warehouse, supplier
accounts, purchase orders. Products have a simple status: **Active / Hidden /
Temporarily unavailable / Discontinued** (manual). Checkout shows: *"Orders are
subject to product availability. If an item is unavailable, the customer will be
contacted."* Fulfilment = **cash on delivery + WhatsApp confirmation** (no online
card gateway for now). Order starts as **Order Received**, availability confirmed
before proceeding.

## Stack & layout
- web/ (Vite + React + Tailwind v4, TS strict, React Router) — port 5330
- server/ (Express + Prisma → Neon Postgres, tsx) — port 4230
- Deploy: TBD (likely Render single web service like the other stores). Ask before first deploy.

## Commands
- Dev: `cd server && npm run dev` + `cd web && npm run dev`
- Typecheck: **`npm run typecheck`** in web/ and server/.
  **In web/, `npx tsc --noEmit` silently checks NOTHING** and exits 0 on a deliberate type
  error — `web/tsconfig.json` is `"files": []` with project references, so there is no root
  program to check. It has to be `tsc -b`. (`npm run build` always did the right thing, so
  builds were never unchecked; only the standalone command was a no-op.) Verified by appending
  `const x: number = "nope"` and watching it pass.
- Lint: `npm run lint` in web/ and server/ (ESLint 9 flat config, gated at `--max-warnings 0`)
- DB: `npx prisma db push`

### Lint scope (read before "fixing" the config)
`eslint-plugin-react-hooks` v7 ships the React-Compiler-era rules
(`set-state-in-effect`, `static-components`, `refs`, `immutability`, `use-memo`) in its
`recommended` preset. They flag ordinary patterns all through this codebase — `useFetch`,
the store provider, Checkout, Shop — so only `rules-of-hooks` and `exhaustive-deps` are on.
Turning the rest on is a worthwhile separate task, not a config tweak.
`react-refresh/only-export-components` is off too: this codebase deliberately colocates
components with their constants (`PRODUCT_STATUSES` beside `StatusBadge`).

## Brand
- Name: **TulipGlam** (owner has the name only — I create logo/wordmark + full look).
- Voice: elegant, premium, feminine, trustworthy. Motif to explore: the tulip.
- Direction: **minimal luxury** — final direction chosen from 3 presented moodboards (pending).
- Tokens: web/src/index.css @theme (set after direction is chosen).
- Assets: real product photography now in place (see Catalogue below). Still missing:
  logo/wordmark, hero photography, real WhatsApp number + Instagram URL.

## Catalogue — real products (imported 2026-07-30)
The placeholder catalogue is **gone**. The store carries three supplier imports, all copied
with the suppliers' permission: **Dali**, **Beesline** and **Feel22**.

**9,672 products / 405 brands**, 9,945 images (784 MB in `web/dist` after a build).
9,533 visible on the storefront, 139 hidden (broken supplier prices — see below).

| Source | Products | Status | Images | Notes |
|---|---|---|---|---|
| `feel22` | 9,327 | 7,232 active / 1,999 unavailable / 96 hidden | 9,373 | 404 brands, 11,526 variants |
| `beesline` | 308 | 191 / 74 / 43 | 555 | single-variant |
| `dali` | 37 | all active | 182 | 116 shade variants + swatches |

### Importers are scoped by `source`, NOT by brand
`npm run import:dali` · `npm run import:beesline` · `npm run import:feel22`

Each is destructive but **only for its own `Product.source`**. Brand is not a safe scope:
Feel22 is a retailer that carries Beesline and Dali as vendors, so a brand-scoped delete
would have had the imports destroying each other's rows. An earlier version of the Dali
importer deleted *every* product in the table — don't reintroduce that.

Run order matters only for duplicates: run Feel22 last so it can skip products already
carried direct.

### Feel22 (imported 2026-07-30)
Source: https://feel22.com Shopify feed. Source of truth: `../feel22-import/`.

- **A multi-brand retailer, not a single brand** — 404 vendors incl. L'Oréal Paris, Clarins,
  Clinique, Shiseido, Kérastase, Garnier, Avène, Pupa Milano. **The product photography and
  copy belong to those brands, not to Feel22**, which cannot license what it doesn't own.
  Confirm with the Feel22 contact what the agreement covers.
- Status from the export's quality flag: `ok` → active, `out_of_stock` → unavailable,
  `price_zero` → hidden (96).
- Pricing: `price_regular`, **no sale price** — same rule as the other two.
- **54 products skipped** because we already carry them direct from Beesline/Dali. The direct
  listings win: cleaner titles ("Keratin Conditioner" vs "Beesline Keratin Conditioner
  200ml"), our pricing, and Dali's shade variants. Nothing is deleted — the Feel22 row is
  never created.
  Matching uses **symmetric Jaccard ≥ 0.8** with brand-prefix and volume stripping, plus a
  bundle-only-matches-bundle guard. A containment score was tried first and was wrong: a
  short title inside a longer one scores 1.0, so bundles matched their own components
  ("Everyone Barrier Cream + Super Hydrating Serum" matched plain "Everyone Barrier Cream")
  and it would have deleted 156 products instead of skipping 54.
- Placement is an **explicit table of all 109 `product_type` values** (their types are clean,
  unlike Beesline's). Unmapped type = hard error.
- Only the **first image per product** is hosted. The full catalogue is 32,720 images /
  ~12 GB; these are Shopify's `_600x600` renditions (~81 KB each).
- Inserts are **batched with `createMany`**, not a nested create per product. Per-product
  round trips to Neon ran at ~60/minute — 2.5 hours for this catalogue. Batched it takes
  about a minute. Products go in first, then ids are read back by slug to attach images
  and variants.

### Scale broke two things — both now fixed
Everything worked at 345 products and fell over at 9,672. If you add another large source,
check for the same class of problem.

- **`GET /api/products` returned the whole catalogue** — 4 MB in 17 s. Now paginated
  (`page`, `limit`, default 48, max 96) returning `{products, total, page, pages, limit}`.
  The Shop page has numbered pagination with `page` in the URL; changing any filter resets
  to page 1. The `new` filter moved from a post-query JS `.filter()` into the SQL `where`,
  because filtering after pagination drops most of each page.
- **Admin product list returned all 9,672** — 17 MB in 15 s. Now paginated (default 50,
  max 200) with Previous/Next.

Still unpaginated and worth watching: `/api/site` and `/api/brands` now carry **405 brands**
(~65 KB). The payload is survivable but the Shop sidebar renders a 405-entry brand radio
list, which needs a search box or a "featured brands" cut.

### Beesline (imported 2026-07-30)
Source: https://beesline.com Shopify `products.json` (`/en-lb` market, USD).
Source of truth: `../beesline-import/` (raw pulls, CSV/JSON, all 555 images, README).

- **117 of the 308 products have unusable prices** in the supplier's own store, so status
  is driven by a data-quality flag: `ok` → active (191), `out_of_stock` → unavailable (74),
  and three broken-price tiers → **hidden** (43): 24 with prices still in **Lebanese
  pounds** after their store moved to USD (e.g. Mud Mask at `252390.00`), 13 at a flat
  `500.00` placeholder, 6 at `0.00`. Hidden products keep the bad price **verbatim** so
  it's obvious in admin what needs fixing. Nine of them are still in stock on Beesline's
  site, so this isn't only dead stock — get real figures from the rep, fix, then activate.
  The single-product endpoints are disabled, so the prices can't be recovered from the API.
- Pricing: `price_regular` becomes our price, **no sale price**. Beesline's own promos
  (7–50%, varying per product) are not carried over. These are their **retail** prices,
  not wholesale — set your own margin before selling.
- All single-variant (no shades/sizes), unlike Dali.
- `isNewMode: "never"` — an existing range, not new arrivals for this store.
- Category placement is **rule-based**, not a per-product table (43 messy supplier types
  with case/plural duplicates and combo values). Title rules run before type mapping, and
  anything unmatched is a hard error. The subtle part: "(1+1 Free)" means the *same*
  product twice — an offer, not a bundle — so those markers are stripped before looking
  for a genuine multi-product title, and "SPF50+" must not read as a bundle either. Get
  that wrong and 98 products land in Sets & Routines instead of 57.
- 2 visible products have no description at all (supplier gap): "Whitening Facial Soap
  (1+1)" and "Propolis Solution".

### Taxonomy (12 active departments, two levels)
Nails (Nail Colours, Nail Care) · Makeup (Face, Eyes, Lips, Brushes & Tools) ·
Skincare (Cleansers, Serums, Moisturisers, Masks, Toners & Mists, Eye Care, Skincare Tools) ·
Fragrance (For Her, For Him, Unisex, Mists & Sprays) · Hair (Shampoo, Conditioner,
Treatments, Styling & Colour) · Bath & Body (Shower & Soap, Body Care, Intimate Care) ·
Deodorant · Sun Care (Sunscreen, Tanning, After Sun) · Oral Care · Kids & Baby · Wellness ·
Sets & Routines · Accessories (Electricals).

Largest departments: Makeup 1,951 · Fragrance 1,067 · Skincare (all subs) · Sets & Routines
830 · Nails 399.

History worth knowing: `Sunscreen` moved out of Skincare and under Sun Care, taking Dali's
two sunscreens with it. `Gift Sets` was reactivated and renamed **Sets & Routines**.
**Fragrance** was reactivated by the Feel22 import (1,067 perfumes and mists).

### Dali (imported 2026-07-30)
Copied with the supplier's permission from https://dalibeauty.co (WordPress/WooCommerce).

- **37 products / 132 sellable SKUs** — 16 standalone + 116 colour shades.
- Prices **$2.10–$6.50** USD. The supplier site shows a flat 20% off everything; we import
  the **regular** price and set **no** sale price, so their discount never reaches customers.
  Owner's decision — revisit only if that 20% is confirmed as a real retail promo, not cost.
- Source of truth: `../dali-import/` (raw API pulls, CSV/JSON, all 182 images, README
  explaining how it was pulled and how to refresh).
- Import: `cd server && npm run import:dali` — destructive + idempotent, **scoped to the
  Dali brand**. Rebuilds from `server/prisma/dali-catalog.json`. Validates
  placement/price/image-file presence *before* touching the DB. Orders/customers/coupons
  untouched (order items keep their snapshot, lose only the product link).
- Images live in **`web/public/products/dali/`** (182 webp, 13 MB) → `/products/dali/…`.
  NOT in `server/uploads/` — that's gitignored and ephemeral on Render, so uploads there
  vanish on redeploy. Anything that must survive a deploy goes in `web/public/`.
  Beesline's 555 sit alongside in `web/public/products/beesline/` (56 MB). `web/dist` is
  ~70 MB after a build, so deploys are heavier than they were.
- Departments hold no products directly, so `/api/products?category=` matches a category
  **and its children**. Related-products does the same widening. Keep that in mind when
  adding subcategories.
- **Shade swatches**: the supplier publishes shade names but no colour codes, so swatch
  colours were read out of the shade photos (`dali-import/extract-swatch-hex.ps1`). That
  works where packaging carries the shade (polish through glass, colour-matched lipstick and
  balm tubes, powder pans) → 102 colour circles. For **Eye Pencil, Lip Pencil Waterproof,
  Creamy Blush, Concealer** the barrel is a neutral house colour and the shade is a small
  accent, so extraction returns the packaging (a "Black" pencil reads peach) — those 14
  variants ship with `hex: ""`, which makes the storefront use the **shade photo** as the
  swatch instead. Rule: `hex` set → colour circle; empty → photo; neither → grey.
- `Product.sku` / `ProductVariant.sku` hold the supplier's codes for re-ordering. **Admin-only** —
  never serialised to the public product endpoint.
- Gaps in the source data, not bugs: no `howToUse` / `ingredients` for any product (the
  supplier's Application/Benefits/Ingredients accordions are empty on their own site), no
  best-seller flags, no concerns/attributes tags. All need writing by hand.

## Domain rules
- Currency USD; no online payment (COD + WhatsApp). Delivery across **all of Lebanon**
  (fee-by-area configurable later; free-delivery threshold configurable).
- Huge category taxonomy (Makeup/Skincare/Bath & Body/Hair/Fragrance/Gift Sets with
  many subcategories + "shop by concern/family/style"). Products can be vegan/clean/
  luxury/mini/jumbo/refillable; have shades/colours/sizes as variants.
- New Arrivals period is configurable (default 1 month, auto-expires) — same pattern
  as mundo-dos-brinquedos. Best sellers = manual flag. Sale = has sale price.

## Build plan (MVP-first — owner chose this)
- **Phase 1 (MVP):** brand/design system; home; category taxonomy + Shop; product
  pages (shades/sizes, gallery); cart; COD+WhatsApp checkout with availability flow;
  order tracking; wishlist; core admin (products/categories/brands/orders + Excel import).
- **Phase 2:** gift cards, delivery-area fees, coupons, reviews, customer accounts,
  notifications (email/WhatsApp), promotions/homepage management, policies pages.

## Design system — "Blanc Tulipe" (chosen 2026-07-26)
Crisp near-white, confident grotesque, one tulip-plum accent, soft serif for prices.
Deliberately **light-only**. Tokens in `web/src/index.css @theme`: paper #FCFCFB,
surface #FFF, soft #F4F2F5, ink #1A1A1E, muted #8B8790, line #EAE7EC, **plum #6C2A55**
(dark #52203F, soft #F5E9F0), sale #B23A3A. Fonts: **Hanken Grotesk** (sans, via
Google Fonts) + **Fraunces** (serif, prices/accents). Tulip = house mark (`TulipMark`
in components/ui.tsx). Product photos stubbed with line silhouettes (`ProductGlyph`).

## Current status / next up
- ✅ Discovery + 3 directions (moodboard) → owner chose **iii · Blanc Tulipe**. Home prototype signed off.
- ✅ **Phase 1 MVP built & verified** (typecheck + build clean, screenshots mobile 390 / desktop 1280).

### Backend (`server/`, port 4230)
- Express + Prisma + **SQLite locally** (`prisma/dev.db`, `DATABASE_URL="file:./dev.db"`).
  Schema kept Postgres-portable (String statuses, no arrays/enums). To deploy: switch
  provider to `postgresql`, set Neon URL, `npm run db:push` + seed.
- Models: Category (self-parent), Brand, Product (status active|hidden|unavailable|discontinued,
  no stock), ProductImage, ProductVariant (shade|size), Review (approval-gated), Order + OrderItem
  (price snapshot) + OrderEvent (history), Setting (k/v), DeliveryArea (fee by area).
- ~~Seed = 29 products / 8 brands / 6 categories~~ — **superseded by the Dali import** (see
  Catalogue above). `prisma/seed.ts` is kept only for the delivery areas / settings / demo
  coupon + gift card; running `npm run seed` again would re-add placeholder products.
- Order statuses = 13, defined in `src/status.ts` (received→…→delivered/completed + on_hold/cancelled/unavailable).
- Admin auth = `x-admin-key` header (`.env` ADMIN_KEY, currently `tulip-admin-2026`).
- Excel import via `xlsx` (template download + upsert by brand+name). Image upload = base64 → `uploads/`.
- Prices ALWAYS computed server-side at checkout (never trust client).

### Frontend (`web/`, port 5330)
- State: `src/lib/store.tsx` StoreProvider = cart + wishlist (localStorage) + site bootstrap (/api/site).
  `src/lib/api.ts` client + types. `src/lib/hooks.ts` useFetch (loading/error/data).
- Public pages: Home, Shop (one component, mode=all|category|new|bestsellers|sale|search; filters+sort+search),
  Product (shade swatches = colour circle or shade photo; picking a shade swaps the gallery hero
  and the cart/order thumbnail to that shade's photo; sizes, video, tabs, reviews+submit, related), Cart, Checkout (COD + WhatsApp,
  area fee + free-over-threshold, availability notice), OrderSuccess (WA confirm link), Track (13-step timeline),
  Wishlist, Brands, GiftCards (WA order), Contact, Account (guest), Info (shipping/returns/faq/about/privacy/terms/gift-card-terms).
- Admin at `/admin` (key gate): Dashboard, Orders (list+detail+status workflow+WA), Products (list+full editor:
  variants/images/flags), Categories, Brands, Reviews (moderation), Import (Excel), Settings (store + delivery areas).
- Photos still stubbed with `ProductGlyph` silhouettes until real images uploaded.
- **Home "Shop by category" is a LIST, not a card grid** (`components/CategoryList.tsx`, Aug 2026).
  The grid rendered 11 tiles against only 6 glyph kinds, so 8 of 11 were visually identical —
  `bottle` covered Nails, Hair, Deodorant *and* Kids & Baby. At 390px that was ~1,300px of
  near-identical placeholder art before any product. The list is ~590px, sorted by catalogue
  depth (with no artwork, position is the only emphasis), with each department's own `tint` as
  the dot. **Do not re-add cards using `web/public/category/*`** — those six files have the name
  and tagline burned into the image over off-palette grounds, which is why `CATEGORY_IMG` was
  always empty. Real text-free department photography would beat the list; nothing else does.

## Phase 2 (✅ built & verified July 2026)
- **Customer accounts** — register/login (bcryptjs + JWT, 60d token in localStorage, `src/auth.ts`).
  Account page: order history, saved addresses CRUD, profile edit. Header/bottom-nav show signed-in state.
  Guest checkout still fully supported. Server: `/api/auth/*`. Store holds `customer`/`login`/`register`/`logout`.
- **Coupons** — percent|fixed, minOrder, maxUses, expiry, active; admin CRUD (`/admin/coupons`); applied at
  checkout via `/api/coupons/validate`; usedCount incremented on order. Demo: WELCOME10 (10%), GLOW5 ($5 over $30).
- **Gift cards** — real balance model; admin issue/edit (`/admin/gift-cards`); checkout applies min(balance, total)
  via `/api/gift-cards/:code`; balance decremented on order. Public GiftCards page still WhatsApp-orders one.
  Demo card seeded: TG-GIFT-5000 ($50).
- **Customers admin** (`/admin/customers`) — list with order count + total spent.
- **Notifications** — `src/mailer.ts` nodemailer layer, **graceful**: no-ops (logs) unless SMTP configured
  in Settings (smtpHost/port/user/pass/secure/emailFrom) or env (SMTP_URL/SMTP_HOST). Sends order-confirmation
  + status-update emails. WhatsApp remains the primary channel (order confirm link + per-order admin message).
- **Promo/homepage** — managed via Settings (promoTitle/promoText/promoActive already wired to Home band).
- Checkout recomputes ALL money server-side (coupon + gift card + delivery) — never trusts client.
- Order model gained: customerId, discountCents, giftCardCents, couponCode, giftCardCode.
- New `.env` keys: JWT_SECRET (change in prod), optional SMTP_*.

## Admin rebuild + production fixes (2026-07-30)

### The promo can no longer lie
`GET /api/home` returns a `promo` object resolved in `server/src/promo.ts`, or **null**.
The client renders exactly what it is given and has no fallback copy — hardcoded defaults in
`Home.tsx` are how the live store came to advertise deleted brands at a discount that did not
exist. It refuses to render when: it is switched off, has no title, its scope is a
brand/category that does not exist or is inactive or holds no visible products, or **the
wording promises a discount while nothing in scope has a sale price**. That last rule covers
claims written into the title or body, not just the separate `promoDiscountText` field,
because we must not rewrite the owner's words to make them true.

Settings: `promoActive`, `promoTitle`, `promoText`, `promoDiscountText`, `promoScopeType`
(`""` | `brand` | `category` | `sale`), `promoScopeSlug`, `promoCtaLabel`.

### Settings are validated, never guessed
`server/src/setup.ts` holds both the save-time validators and the Dashboard audit, in one
file so they cannot disagree. Placeholder-looking values are rejected with a per-field
message (long runs of the same digit, sequential digits, `example.com`, "yourhandle"…), and
the save is all-or-nothing. `PUT /api/admin/settings` answers `400 { error, errors: {field: msg} }`.

The **Setup incomplete** banner on the Dashboard (`GET /api/admin/setup`) lists everything
unconfigured, in three tiers: `placeholder` (a wrong value that looks right — worst),
`missing`, `unverified` (valid but self-referential, e.g. an Instagram handle matching the
store name). This is the mechanism for surfacing real values that are needed; nothing is
invented anywhere.

### The server refuses to boot with the dev admin key
`NODE_ENV=production` plus `ADMIN_KEY === "tulip-admin-2026"` exits 1 with instructions.
The key itself is never echoed by any endpoint — only the boolean `adminKeyIsDefault`.

### Admin products (9,672 rows, used daily)
`web/src/admin/ProductList.tsx`, built on primitives in `web/src/admin/primitives/`:
`DataTable`, `Combobox`, `StatusBadge`, `ConfirmDialog`, `FilterBar`, `Pagination`, `Toast`,
plus `hooks.ts` and `format.ts`. Orders/Customers/Brands/Reviews should adopt these next.

- Filtering, sorting and pagination are **all server-side** — sorting only the current page
  would be a lie at 194 pages. Sorts: name, price, category, brand, status, updated.
  Filters: status, category (department rolls up its children), brand, source, price range,
  has-image, has-variants, has-description, visible-only.
- Every bit of that state lives in the URL, so refresh, back/forward and sharing all work.
- Selection survives paging but resets when a filter changes. Shift+click extends a range.
- `GET /api/admin/catalogue-health` counts are clickable, and each link reproduces exactly
  the query behind its number (that is why `visible=1` and `hasDescription` exist).
- Deleting warns when the product belongs to an importer source, because the next import
  recreates it — Hidden or Discontinued is the real answer.
- All four statuses are first-class. `unavailable` reads as a caution, not an error: in a
  source-to-order business it is a normal answer.

**There is no stock column, field or filter anywhere, and must never be.** `ProductVariant.available`
predates this work and is a per-shade availability flag the storefront uses to disable a
swatch; it is not a quantity. Dropping it would be a destructive migration, so it stays.

### Admin orders
- The 13-status workflow is enforced in `server/src/status.ts` (`nextStatuses`,
  `canTransition`). Before this the API wrote whatever the client sent, so an order could
  jump `received` → `delivered` or climb out of a terminal state. The UI offers only legal
  moves and the server independently rejects the rest.
- `awaiting_customer` has dedicated UI: which line could not be sourced, what was asked, how
  long it has waited, and three one-click resolutions. **Remove-the-item recomputes subtotal,
  delivery, coupon and gift card on the server** — dropping a line can push the order back
  under the free-delivery threshold or below a coupon minimum. New additive Order columns:
  `awaitingItemId`, `awaitingNote`, `awaitingSince`.
- Order detail shows the full money breakdown with the context needed to explain it
  (area fee, whether the free-delivery threshold applied, coupon and gift-card codes).
- WhatsApp actions are **disabled with an explanation** when the store number is missing or a
  placeholder, rather than opening a dead `wa.me` link.

### Indexes
`Product` had only its primary key and the slug unique, so every admin sort and filter was a
sequential scan, and Prisma does not index relation scalars on PostgreSQL. 12 indexes added
(status, categoryId, brandId, source, priceCents, updatedAt, name; ProductImage and
ProductVariant on `(productId, sortOrder)`; Order on status and createdAt). Declared in
`schema.prisma` and applied via `db push`; `server/scripts/2026-07-30-admin-indexes.sql` is
the lock-free `CONCURRENTLY` equivalent for larger tables and is a no-op now.

## Full-site audit (2026-07-30) — read AUDIT.md for the itemised list

Eight phases, all committed. The rules that came out of it and must not be undone:

### Nothing on the storefront may state a fact it cannot check
This is the through-line. Fixed instances, each of which was live:
- The promo band advertised deleted brands at a discount that did not exist → `promo.ts`.
- The announcement bar hardcoded "Free delivery over $60" while the real figure lives in
  `freeDeliveryThresholdCents` → derived, and `checkFreeDeliveryClaim()` refuses a save where
  the two disagree.
- The policy pages promised "2–5 working days" (no courier integration exists) and
  "sourced from official brand channels" (the catalogue comes from three *retail* suppliers,
  not the brands) → settings-driven, and the sentence disappears when unset.
- "Good for" and "Attributes" offered 14 filter options, **all** of which returned zero
  products → both groups are now server facets over what the catalogue actually holds.
- Home/Shop/Brands ignored `useFetch`'s error, so a 500 rendered "Nothing here yet" →
  `ErrorState` with a working retry.

When something can't be verified, build the admin surface that exposes it as missing and
leave it empty. Never write the value.

### Checkout claims promotions, it does not read-then-write them
Gift-card balance and coupon `usedCount` are claimed with a **conditional UPDATE** inside the
same transaction as the order (`balanceCents >= want`, `usedCount < maxUses`). The old
read-then-write gave away 1000c from a 500c card under two concurrent orders — reproduced.
A losing claim doesn't fail the order; it goes through at the real price.

### The `<head>` is rendered on the server
`server/src/seo.ts`. **WhatsApp's link preview crawler does not run JavaScript**, and pasting a
product link into a chat is how products get shared here — client-side meta tags would have
been useless for the one channel that matters. Also: the catch-all route used to answer 200 for
every unknown path, so mistyped URLs were indexable.
- `availability` is `LimitedAvailability`, never `InStock`.
- **Never add `sku` to JSON-LD** — `Product.sku` is the supplier's reorder code. `test-seo.mjs`
  asserts it reaches no public surface.
- Requires `siteUrl` in Settings; behind Render's proxy the request host is internal.

### `/api/site` publishes an allowlist, not the settings table
It returned `settings` verbatim. Nothing sensitive was in there only because SMTP had never
been configured — saving an SMTP password would have published it. `PUBLIC_SETTINGS` fails
closed: a new setting is private until deliberately named.

### Audience (`/men`, `/women`) is a field, not a department
A men's fragrance, shaving cream and shampoo sit in three different departments.
`Product.audience` + `audienceLocked`, where only *changing* the value in admin locks it —
locking on every save would pin a typo-fix to "unisex" forever. `Brand.audience` is an
owner-set default the classifier treats as a stated fact. **The pages are live but empty**: the
classifier is dry-run only and nothing is classified yet, so they say so and the nav links stay
hidden.

### Admin is code-split out of the storefront bundle
556 KB → 433 KB. Twelve admin screens were downloaded by every shopper on a phone. Keep
storefront pages eagerly imported — they are the critical path.

### Tests (all dry-run by default; `--write` creates only its own rows and deletes them)
Listed for what they COVER. Counts are not written down anywhere by hand any more — run
`npm run test:all -- --write` and read the table.
```
node scripts/test-checkout-money.mjs --write   # delivery boundary, coupons, gift cards, races
node scripts/test-password-reset.mjs --write   # token lifecycle, no account enumeration
node scripts/test-seo.mjs                      # head, SKU privacy, 404s, robots, sitemap
```
`test-seo.mjs` needs `web/dist` — in dev Vite serves index.html and no injection runs.

## Retired sections (owner's decision, 30 July 2026) — do not resurrect

`scripts/retire-sections.ts` deactivated three categories and set their products to `hidden`:

| Section | Products | Why |
|---|---|---|
| `electricals` | 158 | Dyson/Braun/Remington dryers, stylers, epilators — not a beauty range |
| ~~`oral-care`~~ | ~~150~~ | **UN-RETIRED 4 Aug — see below** |
| `gift-sets` (Sets & Routines) | 788 | **"my supplier doesn't sell in sets"** |

Catalogue went 9,533 → 8,437 visible. Reversible: `--write --restore`, and
`--only <slug>` restores one section without reversing the others.

### Oral Care came back, 4 Aug 2026

The owner's brand list (`prisma/brands-we-sell.txt`) is a truer statement of what the shop
stocks than a retirement decided before that list existed, and **Listerine and Oral B live only
in Oral Care**. So the section is active again — but only 15 of its 150 products are visible.

That is the brand allowlist doing its job unaided: restoring a section sets **every** hidden
product in it back to `active`, so 150 came back and the allowlist step immediately re-hid the
135 belonging to Colgate, Elgydium, White Glo, Signal, Crest and Kundal — none of which are on
the list. Two rules composing correctly rather than fighting.

**Restoring always returns products as `active`, even ones that were `unavailable` before.**
There is no record of the pre-retirement status, so any of those 15 that the supplier cannot
actually get needs marking unavailable by hand.

**"Electronics" means the `electricals` SUBcategory, not its parent.** Accessories keeps 40
non-electronic items (cotton pads, lenses, shaving, Dali's key charms).

Not deleted, because every row belongs to an importer and the next run would recreate them.
Three guards now stop that:
1. The feel22 importer skips any product whose target category is `active: false`.
2. All three importers stopped forcing `active: true` in the **update** branch of their category
   upserts — they were reactivating whatever they defined. Beesline additionally had
   `REACTIVATE = ["hair", "gift-sets"]`.
3. `gift-sets` is feel22's `FALLBACK_CATEGORY` for unmapped types, so unmapped products now
   land in a retired section and are skipped rather than silently listed. Watch for that if a
   future import reports a lot of skips.

**`/men` and `/women` were removed as sections.** The shelves read "7,123 items" because an
audience page includes unisex. Gone: the routes, both nav links, `pages/Audience.tsx`, the
`/api/audience/:audience` endpoint, `api.audience()`, the SEO entries, and `menCount`/
`womenCount` on `flags`. Both paths 404.

**The `audience` field itself is untouched and still in use** — do not remove it. It drives the
"For him / For her" filter in the shop sidebar, the department dropdowns (per-category counts
on `/api/site`), the `Facets.audience` counts, `Brand.audience`, the admin editor/filter/bulk
action, and `scripts/classify-audience.ts`.

## TulipGlam Rewards (built Aug 2026) — `server/src/loyalty/`

A points programme built around two constraints that kill the usual architecture:
**orders are cash on delivery** (so points cannot be granted at placement — COD orders get
refused at the door), and **Render's free tier spins down** (so there is no reliable cron).

**Off by default.** `LOYALTY_ENABLED` and `LOYALTY_REDEMPTION_ENABLED` are separate flags.

**Delivery is the owner and their family — no third-party courier** (decided Aug 2026). That
settles what `dispatch.ts` was blocking on: the adopted process is the **printed run** from
`/admin/dispatch`, carried on a phone at the door. So the run is built for a phone first —
cards below 640px with the amount set large, table on desktop and paper. Redemption is safe to
enable once `TURNING-ON-POINTS.md` has been walked through; that file is the flip procedure and
names what it does not prove.

### The one rule that shapes everything
**`rules.ts` decides; `ledger.ts` writes.** `computeState` returns the state *and a plan* —
the exact rows `materialise()` must write. `materialise()` executes it and calculates nothing.

This is not stylistic. The two used to both calculate and they drifted: expiry was computed in
one and applied in the other (so expired points stayed spendable forever on a server where the
sweep never runs — which is every server, by design), and the tier multiplier was applied on
write but not on read (so a Bouquet customer's points were worth two-thirds of what they should
be). Both were live; neither was caught, because each file was self-consistent with itself.
**If you are adding a calculation to `ledger.ts`, it belongs in `rules.ts`.**

### Rules worth knowing before touching it
- **The rate you see when you order is the rate you get.** The multiplier is stamped on the earn
  at placement and honoured at maturity, never re-derived. The COD hold is *our* mechanism and a
  tier anniversary falling inside it must not cost the customer points. Runs both ways: an order
  placed at Petal pays Petal even after a promotion.
- **A new tier applies from the next order.** An order can never buy the tier that pays it.
- **Points confirm 7 days after delivery**, from `Order.deliveredAt` — a stored timestamp, so the
  answer is the same whether or not any job has run.
- **A loyalty failure must never cost a sale.** Every hook goes through `safely()` — swallowed,
  logged, 4s timeout. Tested by forcing a real throw on the genuine checkout path.
- **Free delivery is a real perk**, honoured in checkout via `tierDeliveryCents`, composing with
  the store-wide threshold as the *lower* of the two. It was advertised for a while before
  anything honoured it; don't let that recur.
- **`enteredBy` is self-declared and must never be trusted for authorisation.** The moment a
  second person has the admin key, real per-admin identity stops being optional.

### Identity — read this before adding any lookup
Accounts are keyed by **phone (E.164, via `phone.ts`)**. `getOrCreateAccount` once accepted a
`customerId` and bound it to a caller-supplied phone; **1,200 points moved to an attacker's
login in a test against the live database.** Lookup no longer binds anything.

- `GET /api/loyalty/me` takes **no parameter at all** and resolves the account from the JWT.
  There is deliberately **no endpoint anywhere that answers "does this phone have an account"**.
- `autoLinkOnFirstRead` links only when the phone has **no existing account and no delivered
  orders** — provably nothing to steal. Everything with history goes to the admin queue.
- `linkCustomerToAccount` is admin-only and explicit.

### Surfaces
| | |
|---|---|
| `rules.ts` | all arithmetic, pure, no I/O |
| `ledger.ts` | the only module that writes entries |
| `present.ts` | customer-facing shaping — **no internal vocabulary ever leaves here** |
| `admin.ts` | the operator view — raw types, ids and reasons, deliberately |
| `hooks.ts` | order-pipeline hooks + `safely()` + the delivery perk |
| `sweep.ts` | `POST /api/internal/loyalty-sweep`, bounded, shared-secret |

`/rewards` (customer) · `/admin/loyalty` (operator). `/api/site` carries `flags.loyalty`, so
nothing is advertised while the programme is off.

**The sweep is a cache refresh, not a cron.** Skip it forever and every customer-visible number
stays correct — `sweepChangesNothing` asserts exactly that against the database.

### Tests — `npm run test:all -- --write`
**20 suites, 1,041 checks.** Do not copy counts out of this file into a commit message; run the
command and read the table. Three of the counts written here by hand had drifted at once (one
suite had grown by twelve, one by one, one had shrunk), and a wrong number in the source of
truth is how the next session learns to discount a green suite — at which point a suite that has
quietly stopped running looks exactly like one that has. `scripts/test-all.mjs` shells out to the
same standalone scripts, counts from each suite's own summary line, and treats *no summary* as a
failure rather than a zero.

Suites needing `--write` are **skipped, not silently reduced**, and `test-seo.mjs` is skipped
unless `web/dist` exists — without a build it reads a page production never serves.

**The API server on :4230 must be RUNNING.** `test-seo`, `test-checkout-money` and
`test-password-reset` connect to it over HTTP; without it they die with ECONNREFUSED and report
no summary. This contradicts nothing above — the rule is "no OTHER process holding a Prisma
pool", not "no server at all", and confusing the two costs a diagnosis.

**`test-redemption.mjs` is flaky back-to-back.** It failed 3 checks on one full run and passed
27 on the next, and passes standalone every time. Suspected cause is Neon's free-tier connection
ceiling under sequential suites, not the code under test. **A single failing run of that suite is
not yet evidence of a bug — re-run it alone before chasing it.** Nothing else has ever flaked.

`test-verdicts.mjs` covers the seven findings an adversarial review raised and could not
verify — all seven were real. Each section quotes the sentence stating the requirement, above
the assertion checking it. Two of them I first marked *clean* with a regex that matched the
word "claim" in a comment and a `.slice(0, 6)` in unrelated code; reading the code settled all
seven. **A check written to confirm what you already believe will confirm it.**

### The order transaction retries, and never loses the sale
`withSerialisationRetry` (in `ledger.ts`, exported and tested) wraps the checkout transaction:
three attempts on a serialisation conflict, then **the order is placed again with points
switched off**. A missing points entry is recoverable from the admin ledger in seconds; a lost
checkout is not recoverable at all. A non-conflict error is rethrown immediately — a retry loop
that swallows real errors turns one loud failure into several quiet ones. It lives in `ledger.ts`
rather than inline in the handler because the original omission survived review precisely by
being five lines in a 2,400-line file with no way to exercise them.

### Every email goes through the outbox
`index.ts` does **not** import `sendMail`, and that absence is the guard. Password reset was the
last direct caller — the one message that cannot be re-sent was the only one leaving no record.
Rows are **claimed** with a conditional update before sending (two flushes used to both send),
and attempts are capped at 5 so one permanently failing message cannot hold the head of an
oldest-first queue forever.

### Still open
- Registration still answers 200/400 by whether an email exists — the cheap paths are closed
  and the endpoint is rate-limited, but the full fix needs SMTP. Flagged in the test output.
- A real 7-day earn has never been exercised end-to-end on the live site, because it takes a
  week. Everything else about redemption has.

## Boot guards — the server refuses to start when
- `JWT_SECRET` is missing, under 24 chars, equal to `ADMIN_KEY`, or the old repo constant.
  **Unconditional** — every ownership check rests on it. (`assertAuthConfig`)
- `COMING_SOON=true` and `PREVIEW_KEY` is missing or weak. (`assertComingSoonConfig`)
- `LOYALTY_ENABLED=true` and `LOYALTY_SWEEP_SECRET` is missing or weak. (`assertLoyaltyConfig`)
- `NODE_ENV=production` and `ADMIN_KEY` is still the dev default.

The last three are enforced **only while their feature is on**, so a missing value cannot take
production down over something switched off. The first one is not, because auth is never off.

## Phase 3 ideas (not started)
Automated WhatsApp Business API notifications, richer promo/hero management UI (multiple banners),
per-product New-Arrivals date overrides, product bundles.

## Hosting — currently Render, MOVING TO HETZNER BEFORE LAUNCH

Owner's decision (Aug 2026). The migration happens **before the gate comes down**, so treat
Render specifics as temporary and do not add more of them.

### The one that will silently break security: `trust proxy`
`index.ts` sets `app.set("trust proxy", 1)` — correct for Render, which puts **exactly one**
proxy in front. `req.ip` is what the whole rate limiter keys on (`rateLimit.ts`), and that
limiter was built CGNAT-aware because a large share of Lebanese mobile traffic shares egress IPs.

On Hetzner the count changes with the stack: **1** behind a single Caddy/nginx, **2** behind
Cloudflare *and* nginx. Get it too low and every request reports the proxy's own IP, so one
visitor's traffic rate-limits the entire country. Get it too high and a client can spoof
`X-Forwarded-For` and never be limited. **Neither fails loudly.** Verify after the move by
logging `req.ip` from two different networks and confirming they differ.

### DECIDED: Postgres runs on the box. See MIGRATION.md

Neon is withdrawn — the constraint is **two vendors, total**: Cloudflare and Hetzner. The
un-delete property Neon was providing is now ours to build, and it is a CONDITION of cutover:
hourly `pg_dump` to R2, a 60-minute maximum data-loss window, backup age surfaced on
`/admin/pulse` and red past 2 hours, and the restore drill green against real `pg_restore`
before anything is pointed at the box.

### Superseded — kept only for why the region mattered
Neon is **us-east-2 (Ohio)**. Hetzner is Germany or Finland. Keeping both means every query
crosses the Atlantic, and several run per page — that is a straight regression for Lebanese
customers who are currently much closer to Ohio than the app would be. Two honest options:

- **Neon, EU region (Frankfurt)** — a connection-string change, keeps managed backups and PITR,
  and is *closer to Lebanon than Ohio is*. Lower risk. Recommended unless cost forces the other.
- **Postgres on the Hetzner box** — cheapest and fastest, and it removes the free-tier connection
  ceiling that is behind three separate accommodations in this codebase: the sweep's `BATCH = 40`,
  `runSweep` materialising sequentially rather than in parallel, and the `test-redemption.mjs`
  flake. But backups become yours, and `BACKUP.md` currently assumes Neon.

### What gets easier — remove the workaround, don't keep it
- **No spin-down.** The sweep becomes a real cron/systemd timer hitting `127.0.0.1`, so the
  shared secret stops crossing the network and the cold-start timeout advice becomes noise.
- **The disk persists.** `server/uploads/` is ephemeral on Render, which is why product images
  live in `web/public/`. `UPLOAD_DIR` is already env-driven, so this needs no code change.
- **`pg_dump` exists.** `BACKUP.md`'s JSON path was written because it wasn't available, and the
  two bugs the restore drill caught — JSON has no date type, and a column parser splitting
  `numeric(4,2)` on the comma — both stop mattering with a real dump.

### Expect the boot guards to stop you, and let them
`JWT_SECRET`, `PREVIEW_KEY`, `LOYALTY_SWEEP_SECRET` and `ADMIN_KEY` all refuse to boot when
missing or weak. Moving from Render's Environment tab to a unit file or a `0600` `.env` is
exactly where one gets dropped, and the server refusing to start is the migration working.

Also still open from the original plan: self-host the Google Fonts (done), set a strong
`ADMIN_KEY`, real `whatsappNumber`/`instagramUrl` in Settings, and a deploy mechanism to replace
`git push` → Render auto-deploy.

## Search — `src/search.ts`, `src/cards.ts`, `SEARCH.md`

Typo-tolerant search over a stored, normalised `Product.searchText` column, matched with
`pg_trgm`. **13 of 48 realistic misspellings found before → 46 of 48 after.** The full
before/after table, the tuning evidence and the revert instructions are in **`SEARCH.md`**,
regenerated by `scripts/search-report.mjs`.

- **`contains` on Postgres is `LIKE` — case sensitive.** Before any question of typos, "nivea"
  did not find "Nivea". That one fact accounts for most of the zeros in the before column.
- **One stored column, not six compared columns.** "nivea cream" has to match a Nivea product
  called *Soft Cream*, where neither field holds both words. `searchText` folds name + brand +
  category + parent + tags, plus a **space-stripped copy** so "lipliner" finds "Lip Liner". An
  expression index cannot reach across a join, so this is also what makes the trigram index
  possible.
- **Accents are folded in TypeScript, not by `unaccent`.** The extension was available and was
  deliberately not used: one fewer extension to exist on two machines, and no chance of the
  database and the application disagreeing about what "é" means.
- **Two floors, not one.** Every token must match at `word_similarity >= 0.42`; if that returns
  *nothing at all*, the query retries once at `0.30`. Measured: worst real typo (`granier` →
  Garnier) scores 0.375, best keyboard mash scores 0.333, everything else ≤ 0.20. The fallback
  only fires on an otherwise-empty page, so a good result set can never be flooded.
- **`searchProductIds` has no default for `statuses`.** Every caller must state what may be
  found. `test-search.mjs` proves the hidden case **both ways** — a hidden product with a real
  `searchText` is unfindable as a customer, and findable when `["hidden"]` is passed — so the
  check cannot pass for the wrong reason if search silently breaks.
- **`refreshSearchText` runs at the end of every import**, because all three importers delete
  and recreate their rows, which would otherwise leave `searchText` empty — a product invisible
  to search while looking perfectly fine everywhere else. Batched at 500 rows per statement;
  per-row updates took 27 minutes against Neon, the same lesson the Feel22 importer taught.

### The ranking existed and never reached the customer
`searchProductIds` ranked correctly all along. `/api/products` then pushed the ids into a
`where` clause and re-sorted everything by status/best-seller/recency, so searching `shampo`
put a **Maybelline lipstick sixth**. Testing the search module alone passed the entire time.
Relevance is now the default sort when `q` is present, and `test-search.mjs` asserts against
the **HTTP endpoint**, because that is the layer the defect lived in.

### `include` does not join — use `loadCards`
Prisma issues **one query per relation**. `include: { brand, category, images }` was four
sequential round trips to Ohio: 696 ms for six product cards, against a 145 ms latency floor.
`loadCards` (`src/cards.ts`) is one `LEFT JOIN` + `LATERAL` returning the same data in **152 ms**,
shaped so the existing `cardOf` serialiser is unchanged — a second card serialiser would be the
`rules.ts`/`ledger.ts` split all over again. `cardInclude` is still used by home and related.

### Settings were read from the database on every request
`getSettings()` was an uncached `findMany` — 13 rows, 143 ms, on nearly every endpoint including
search. Now cached with a **5-second** TTL plus explicit invalidation on save. Five seconds and
not five minutes **because settings carry money**: the free-delivery threshold and default
delivery fee are read from here at checkout, so a stale value is a wrong price.

### The remaining latency is Neon's, and it dies with Stage C
`scripts/search-perf.mjs` reports it split apart, because one wall-clock number would hide which
half moves. Postgres executes the search in **29 ms**; the round trip to Neon is **145 ms** and
the path makes three sequential ones. A bare `SELECT 1` is stable at 151 ms, but six concurrent
queries reach 2 s at the max — the endpoint's occasional 2–10 s spikes are the pooled endpoint
under concurrency, not search code. **It is not instant yet and will not be until Stage C.**
Do not tune further against Neon's latency profile; that is how a Neon-shaped interim gets built.

The same script verifies every capability actually runs off Neon (`pg_trgm` is contrib,
`LATERAL` is core since 9.3) and greps the three search modules for Neon-specific APIs.

## Prisma's 5-second transaction default was losing checkouts — `src/tx.ts`

**Found 5 Aug 2026, in `/admin/errors`, recorded against `/api/orders` on four separate days:**

```
Transaction already closed: A query cannot be executed on an expired
transaction. The timeout for this transaction was 5000 ms
```

Neither `placeOrder` nor `redeem` passed transaction options, so both ran on Prisma's defaults —
`maxWait` 2 s, `timeout` 5 s. A customer who hits it sees **"Something went wrong."** and loses
their checkout. `withSerialisationRetry` exists precisely so a conflict never loses a sale; a
clock was doing the same thing by default, one layer down.

**Why here and not on a normal stack.** The transaction is a dozen sequential round trips —
claim coupon, claim gift card, re-price every line, create order, create items, write the
ledger. At Neon's measured **145 ms** per trip the floor is already ~2 s, and the pooled
endpoint's tail reaches **2 s for a single trivial statement** under concurrency. Two bad trips
and the budget is gone. 5 s is a local-database number applied across an ocean.

Now `TX_OPTIONS` (20 s timeout, 10 s maxWait) on both, with the arithmetic in `tx.ts`. Leave it
set after Stage C: it costs nothing at 20 ms and removing it re-arms the trap for the next person
who runs against a remote database.

**This is also the answer to a flake that looked like a code regression.** `test-loyalty-ledger`
began failing in full-suite runs while passing standalone. It was the same 5-second expiry inside
`redeem()`, not the suite's own logic.

### A `finally` that is a bare sequence of awaits is not cleanup
The same run stranded **11 orders and 10 loyalty accounts** while printing *"cleaned up 3
accounts and 2 orders"*. The ids were tracked correctly — one `deleteMany` threw inside the
`finally`, and every step after it was skipped silently, because a throw there is swallowed by
the process exiting on the original error. Those leftovers then poisoned the next runs, which is
how two full-suite runs got spent chasing a phantom regression.

Teardown in `test-loyalty-ledger.mjs` now runs each step independently, sweeps by the run's
unique `TAG` prefix (catching rows created but never recorded), and **counts what is actually
left** rather than printing its own intent. The rule generalises: *a cleanup message must report
the outcome, not the plan.*

## The homepage rail — `src/picks.ts` names it, nothing else may

The rail read **"Best sellers"** under **"Loved by everyone"**, linked to `/bestsellers`, and its
server-rendered `<head>` said *"The most-ordered products"*. Four claims about customer
behaviour, all fed by `Product.isBestSeller` — an admin checkbox. No order was ever counted, no
review was ever counted, and **no product has ever carried the flag**, so the rail has never
rendered. False and invisible simultaneously, which is why it survived an audit.

- **`picks.ts` is the only thing that decides the label, the link and the contents.** Homepage,
  `/api/site`, the shop heading, nav, footer, `<head>` and the sitemap all ask it. The client
  holds no copy of the wording — same rule as `promo`, and for the same reason: a label and its
  data have to move together or someone changes one and not the other.
- **Today it is "Our Picks" / "Chosen by us"**, because that is checkable. The owner flags
  products in admin — per-product checkbox, or the **Add to Our Picks** bulk action in the
  product list, which exists because choosing 8 of 1,178 through a form gets abandoned half-done.
- **It upgrades itself.** When `RAIL_SIZE` (8) products have each been delivered
  `BEST_SELLER_MIN_UNITS` (10) times, the rail recomputes from delivered orders and becomes
  "Best Sellers". No setting, no migration, nothing to remember — `resolveRail` asks the orders
  table and the words change when the claim becomes true.
- **Per-product units, not a count of orders.** "Best seller" is a claim about *that product*. A
  shop could take 500 delivered orders concentrated in three products and still have nothing
  honest to say about slots four to eight. Requiring 8 to clear the bar implies an 80-unit
  site-wide floor anyway.
- **Delivered means delivered.** Counted only from `delivered` / `completed`. The SQL names the
  two states it accepts rather than listing what to skip, so a status added later is excluded by
  default instead of silently counted as a sale. A refused parcel is not a sale — asserted.
- **`isBestSeller` keeps its name**; renaming a column is a destructive migration. It has only
  ever meant "the owner flagged this", which is exactly what a pick is. What it must never do is
  speak for customers.
- **The product-card badge says "Our Pick" and deliberately does NOT follow the rail's mode.**
  After the upgrade, a product the owner picked is still a pick. Two claims, both checkable,
  neither borrowing the other's authority.
- **The rail hides when empty** — `Home.tsx` guards on length, so an unpicked rail is absent
  rather than an empty row. That guard predates this work and is why nobody noticed the flag was
  never set.

`/our-picks` and `/bestsellers` both route to the same shelf; the sitemap lists only the live
one, and `/bestsellers` stays alive so an indexed URL never 404s when the rail upgrades.

## Sibling-hunt: a fix is not done until you have looked for the same shape elsewhere

**Owner's standing rule, 2 Aug 2026.** Every fixed bug ends with a search for the same shape in
the rest of the codebase, and the result of that search goes in the report — including "none
found", which is information.

Learned twice, the same way:

- **`earnOrderId`** got a check-then-act guard while five other mutations kept the identical
  hole.
- **The orphan grid.** A fixed-column grid drawn with `gap-px` over a `bg-line` background
  renders its empty cells as visible grey panels. Fixed it in the homepage trust bar, did not
  look further, and featured brands had exactly the same flaw — found a day later by opening a
  desktop screenshot.

The hunt is a real search, not a glance. For the orphan grid it meant separating the two
conditions that produce the defect — shared-hairline styling **and** a variable-length list —
because grids that satisfy only one are fine: an orphan in a product grid is just a list
continuing, and a row of self-bordered cards leaves whitespace rather than a grey box. That
distinction is what made "no further instances" a finding instead of a shrug.

### The same discipline, applied to data

`Proactive Strength Duo`'s only photograph was AI-generated. Deleting the row would have been
undone by the next `npm run import:beesline` — the importer-owned-rows lesson this file already
records. The durable fix was `prisma/generated-images.ts`, wired into **all three** importers at
once, so the rule survives every re-import and catches the next supplier's generated image
automatically.

**An AI image must never stand in for a real product a customer will physically receive.** This
is cash on delivery; the doorstep is where an invented photograph surfaces, with the goods in
the buyer's hand. Decorative art — the hero, category headers — is a different thing and is
fine. The catalogue JSON is left untouched on purpose: it is an honest record of what the
supplier published, and the filtering belongs in code.

## An ignored gate is worse than none, because it still looks like a control

**Owner's rule, 3 Aug 2026.** Before adding a check that blocks a person, ask honestly whether
they will still be obeying it in a month. A gate that gets clicked through is not a weaker
control than no gate — it is a *negative* one, because everyone downstream now believes the
thing was checked.

Where this landed: the import contact sheet is **not** approval-gated. An approval step on a
9,373-product catalogue would be dismissed within two runs. So the import proceeds and the sheet
is guaranteed to exist, which buys a smaller promise that is actually kept — *an invented photo
survives at most one import cycle instead of forever.*

The companion rule is the opposite case: **where a check CAN be enforced without a human in the
loop, enforce it structurally.** `verify-sources.mjs` runs as the first step of `npm run build`
and exits 1 if any product-image source changed outside an import, so a modified source cannot
become a deploy. That one costs nobody any patience — it is 2.3 seconds and it only ever speaks
when something is wrong.

Choosing between them is the judgement: **gate machines, inform people.**

### Why sources get that treatment specifically

A test of mine tried to rewrite a real source image to simulate a supplier change. It failed —
because Windows happened to have the file open. Luck wearing a uniform.

Product-image sources are the one thing here that cannot be regenerated: derivatives, the
database and the whole site are rebuilt *from* them. So the rule stopped being "scripts should
not write there" and became a hash check the build runs, using the manifest the import review
already maintains. Integrity and review are the same question asked twice; they share one answer
rather than drifting into two.

The legitimate path is unchanged: importer runs → `image-review.mjs` rebaselines and shows a
contact sheet → build passes. Nothing else reproduces that, which is the point.

## Standing approvals die with their premises

**Owner's rule, 3 Aug 2026.** An approval is granted for a reason. When the reason turns out to
be false — or only half true — the approval does not survive it. Read the justifications, not
the permission.

The case that produced it. A pre-approval said: *ceiling confirmed → `BATCH = 40` and the
sequential `materialise` loop go.* The verdict came back positive (20/20 on local Postgres), so
the permission was live. But the premise was that both were **Neon** accommodations, and reading
them showed three justifications between them, of which the experiment killed exactly one:

| | |
|---|---|
| `BATCH = 40` — "inside a cold-start request budget" | **Render**, not Neon. Untouched by the verdict. |
| sequential, reason 1 — Neon's small connection pool | **Dead.** Struck. |
| sequential, reason 2 — keeps serialisation pressure off `redeem()` | **Alive on every host.** |

The experiment measured the sweep in *isolation*. It never measured a sweep racing a checkout,
which is what reason 2 protects. So the dead justification was struck and the code did not
change — a customer's checkout latency is not worth trading for freshness nobody is waiting on.

**The test:** before executing a conditional approval, name the premise out loud and check it
still holds. If the condition was met but the premise was not, you have permission to do the
wrong thing.

### Its companion, from the same day

**A count is not a verdict until you have read what failed.** The same experiment first returned
*20 of 20 failed* — which would have "confirmed" the opposite conclusion and licensed the
deletions for entirely the wrong reason. Reading the failures showed every run dying on
`no product to order`: the throwaway database had the schema and no data, so nothing ever reached
the code under test.

Same habit caught the bundle report claiming `renderedLength` was post-minification — checking
whether the module sum matched the emitted size, before publishing the table, showed react-dom
reporting more bytes than the entire chunk containing it.

## A sum that does not reconcile is a confession

**Owner's rule, 3 Aug 2026.** Sibling to *a count is not a verdict until you have read what
failed.* When two numbers that describe the same thing disagree, the disagreement is the
finding — stop and resolve it before publishing either.

Three times in two days, and every one would have shipped a wrong conclusion:

| the numbers | what the gap meant |
|---|---|
| react-dom reported 449 KB inside a chunk emitting 438 KB | `renderedLength` was pre-minification, not post. The report's whole premise was wrong. |
| main chunk fell 134 KB; the new route chunks totalled 35 KB | A 92.4 KB shared chunk had appeared that index.html still preloads. The real saving was 7.6%, not 30%. |
| every screenshot came back exactly 844px tall | Real pages are not all the same length — the harness was measuring the viewport, not the document. |

**The test:** if you can write down two figures for the same quantity and they do not add up,
you do not yet have a result. You have a lead.

## The React Router question is ANSWERED, not deferred

**Owner's ruling, 3 Aug 2026.** `react-router` is ~93 KB, roughly 21% of the main chunk and the
second-heaviest thing in the bundle. It is **accepted as part of the framework floor.** Do not
open a router migration on the strength of that number.

The reasoning, so it does not have to be rediscovered:

- A router swap is invasive surgery on the thing every page stands on.
- The infrastructure under the store is being replaced (see MIGRATION.md) and customers are not
  on it yet. Wrong surgery, wrong moment.
- The prize is a *fraction* of 93 KB, against an FCP that has now twice proved it moves for
  other reasons — the images cut payload 95% and moved it none; the lazy-loads bought 150–200 ms
  for 33 KB.

**The revisit trigger — and only this one:** real post-launch data showing script weight hurting
actual customers on actual Lebanese phones. Not an estimate column making anyone itchy, not a
smaller number in a competitor's bundle. Until that fires, the question is closed and
`bundle-report.txt` is a map, not a to-do list.
