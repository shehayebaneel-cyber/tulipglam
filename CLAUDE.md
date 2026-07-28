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
- Assets: none yet (no products, photos, logos, WhatsApp/IG). Seed realistic placeholders for now.

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
- Seed = 29 products / 8 brands / 6 categories / 9 Lebanon delivery areas. `npm run seed`.
- Order statuses = 13, defined in `src/status.ts` (received→…→delivered/completed + on_hold/cancelled/unavailable).
- Admin auth = `x-admin-key` header (`.env` ADMIN_KEY, currently `tulip-admin-2026`).
- Excel import via `xlsx` (template download + upsert by brand+name). Image upload = base64 → `uploads/`.
- Prices ALWAYS computed server-side at checkout (never trust client).

### Frontend (`web/`, port 5330)
- State: `src/lib/store.tsx` StoreProvider = cart + wishlist (localStorage) + site bootstrap (/api/site).
  `src/lib/api.ts` client + types. `src/lib/hooks.ts` useFetch (loading/error/data).
- Public pages: Home, Shop (one component, mode=all|category|new|bestsellers|sale|search; filters+sort+search),
  Product (shades/sizes, gallery, video, tabs, reviews+submit, related), Cart, Checkout (COD + WhatsApp,
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
