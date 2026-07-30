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
- Typecheck: `npx tsc --noEmit` in web/ and server/
- DB: `npx prisma db push`

## Brand
- Name: **TulipGlam** (owner has the name only — I create logo/wordmark + full look).
- Voice: elegant, premium, feminine, trustworthy. Motif to explore: the tulip.
- Direction: **minimal luxury** — final direction chosen from 3 presented moodboards (pending).
- Tokens: web/src/index.css @theme (set after direction is chosen).
- Assets: real product photography now in place (see Catalogue below). Still missing:
  logo/wordmark, hero photography, real WhatsApp number + Instagram URL.

## Catalogue — real products (imported 2026-07-30)
The placeholder catalogue is **gone**. The store carries two real supplier ranges, both
copied with the suppliers' permission: **Dali** and **Beesline**.

**345 products total / 440 sellable SKUs**, 737 images. 302 visible on the storefront,
43 hidden (see Beesline price problems below).

| Brand | Products | Status | Images |
|---|---|---|---|
| Dali | 37 (132 SKUs incl. 116 shades) | all active | 182 |
| Beesline | 308 (single-variant) | 191 active / 74 unavailable / 43 hidden | 555 |

Each brand has its **own importer, scoped to its own brand** — `npm run import:dali` and
`npm run import:beesline`. Both are destructive *within their brand only*: re-running one
rebuilds that brand's products and leaves the other's alone. This scoping matters; an
earlier version of the Dali importer deleted every product in the table.

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

### Taxonomy (now 9 departments, two levels)
Nails (Nail Colours, Nail Care) · Makeup (Face, Lips, Eyes) · Skincare (Cleansers, Serums,
Moisturisers, Masks, Toners, Eye Care) · Deodorant · Sun Care (Sunscreen, Suntan, After
Sun) · Hair (Shampoo, Conditioner, Treatments) · Bath & Body (Shower, Body Care, Intimate
Care) · Sets & Routines · Accessories. **Fragrance** is the only inactive one.

`Sunscreen` moved out of Skincare and under the new Sun Care department, taking Dali's two
sunscreens with it. `Gift Sets` was reactivated and renamed **Sets & Routines** (Beesline's
bundles are routines, not gifts).

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

## Phase 3 ideas (not started)
Automated WhatsApp Business API notifications, richer promo/hero management UI (multiple banners),
per-product New-Arrivals date overrides, product bundles, loyalty/points.

## Deploy (NOT done — ask first)
Single Render web service like the other stores (server serves `web/dist` — fallthrough already in
`src/index.ts`). Before launch: switch Prisma to Postgres/Neon, self-host the Google Fonts, set a strong
ADMIN_KEY, real whatsappNumber/instagramUrl in Settings.
