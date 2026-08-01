// TulipGlam API client. Dev proxies /api + /uploads to the server (vite.config).
export type Glyph = "bottle" | "dropper" | "jar" | "tube" | "lipstick" | "compact" | "mist";

export type Card = {
  id: number; slug: string; name: string; status: string;
  priceCents: number; saleCents: number | null; onSale: boolean;
  glyph: Glyph; tint: string; image: string;
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string };
  isBestSeller: boolean; isNew: boolean;
};

// imageUrl = this shade's own photo. When present the swatch shows the photo
// instead of `hex`, and picking the shade swaps the gallery hero to it.
export type Variant = { id: number; type: "shade" | "size"; label: string; hex: string; imageUrl: string; priceCents: number | null; available: boolean };
export type Review = { id: number; author: string; rating: number; title: string; text: string; product?: string; createdAt?: string };
/** Server-resolved homepage promo. `discountText` is "" unless something in scope is on sale. */
export type ResolvedPromo = { title: string; text: string; discountText: string; href: string; ctaLabel: string };

export type ProductFull = Card & {
  shortDesc: string; description: string; howToUse: string; ingredients: string;
  videoUrl: string; concerns: string[]; attributes: string[];
  images: { url: string; alt: string }[]; variants: Variant[];
  reviews: Review[]; ratingAvg: number; reviewCount: number; related: Card[];
};

export type Category = {
  id: number; slug: string; name: string; blurb: string; glyph: Glyph; tint: string; sortOrder: number;
  _count?: { products: number };
  /**
   * How many products in this category are marked men's / women's, children rolled up.
   * Lets a department that holds its products directly offer "For him / For her" in the nav
   * without inventing subcategories to hold them.
   */
  audience?: { men: number; women: number };
};
export type Brand = { id: number; slug: string; name: string; blurb: string; featured: boolean; _count?: { products: number } };
export type Area = { id: number; name: string; feeCents: number; active: boolean };
export type StatusMeta = { key: string; label: string; hint: string; tone: string; terminal?: boolean };

/** One trust-bar claim. Settings-driven so an unsupportable one can be removed without a deploy. */
export type TrustItem = { title: string; body: string };

/**
 * Feature flags resolved on the server. The client uses these to avoid advertising a section
 * that would come back empty — a "Sale" link leading to nothing is worse than no link.
 *
 * The men's/women's counts that used to live here went with the /men and /women shelves. The
 * `audience` field itself is very much alive: it drives the "For him / For her" filter, the
 * department dropdowns, and the admin tooling.
 */
export type SiteFlags = { hasSale: boolean; loyalty: boolean };

export type SiteData = {
  settings: Record<string, string>;
  /** Two-level tree. `name` is the single source of truth for every label in the UI. */
  categories: (Category & { _count: { products: number }; children: (Category & { _count: { products: number } })[] })[];
  brands: Brand[];
  /** Curated in admin, or by catalogue depth — never insertion order. */
  featuredBrands: Brand[];
  areas: Area[]; statuses: StatusMeta[];
  flags: SiteFlags;
  trust: TrustItem[];
};

/**
 * Filter options for the current result set, computed on the server with `?facets=1`.
 *
 * Every entry is backed by real rows, and each facet is counted against the query *minus its
 * own filter*, so the numbers stay meaningful while a filter is applied. An option missing
 * here means nothing matches it — the UI must not offer it.
 */
export type Facets = {
  brands: { id: number; slug: string; name: string; count: number }[];
  price: { minCents: number; maxCents: number };
  concerns: { value: string; count: number }[];
  attributes: { value: string; count: number }[];
  /** Products per audience in the current selection, e.g. { unisex: 123, men: 78, women: 29 }. */
  audience: Record<string, number>;
};

export type OrderItem = { id: number; name: string; brandName: string; variantLabel: string; glyph: Glyph; tint: string; imageUrl: string; priceCents: number; qty: number };
export type OrderEvent = { id: number; status: string; note: string; createdAt: string };
export type Order = {
  id: number; number: string; status: string; fullName: string; phone: string; whatsapp: string; email: string;
  area: string; city: string; address: string; notes: string;
  subtotalCents: number; deliveryCents: number; totalCents: number; paymentMethod: string;
  items: OrderItem[]; events: OrderEvent[]; createdAt: string;
};

// ---- customer auth token (stored in localStorage) ----
const TOKEN_KEY = "tg_token";
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } };
export const setToken = (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* noop */ } };
export const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ } };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

/**
 * The rewards page, as the server computed it.
 *
 * EVERY number and EVERY sentence here is server-derived, including the progress percentage and
 * the "confirms 14 Aug" note. Nothing on the page may recompute any of it — a threshold divided
 * by a spend figure in JSX is `tierForSpend` reimplemented, and it goes stale silently the first
 * time a rate changes. If the page needs a number that is not on this type, add it to
 * `server/src/loyalty/present.ts`, not to the component.
 */
export type RewardsFact = { key: string; title: string; body: string };
export type RewardsHistoryEntry = {
  id: number; title: string; detail: string;
  points: number; pointsLabel: string;
  at: string; atLabel: string;
  tone: "credit" | "debit" | "waiting";
};
export type RewardsTier = { key: string; label: string; multiplier: number; multiplierLabel: string; perks: string[] };
export type Rewards = {
  enabled: boolean;
  /** When false the page says NOTHING about spending points. No disabled panel, no "soon". */
  redemptionEnabled: boolean;
  linked: boolean;
  available: number; availableLabel: string;
  pending: number; pendingLabel: string; pendingNote: string;
  tier: RewardsTier;
  next: { key: string; label: string; toGoCents: number; toGoLabel: string; percent: number; multiplierLabel: string } | null;
  spendLabel: string;
  expiresAtLabel: string;
  history: RewardsHistoryEntry[];
  historyTruncated: boolean;
  facts: RewardsFact[];
  earnRateLabel: string;
};

export type Customer = { id: number; email: string; fullName: string; phone: string };
export type Address = { id: number; label: string; fullName: string; phone: string; area: string; city: string; address: string; isDefault: boolean };

export const api = {
  site: () => req<SiteData>("/site"),
  // `promo` is resolved on the server against real brands/categories and real sale prices.
  // null means render nothing — the client must not substitute copy of its own.
  home: () => req<{ promo: ResolvedPromo | null; bestSellers: Card[]; newArrivals: Card[]; reviews: Review[] }>("/home"),
  products: (q: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== "") as [string, string][]).toString();
    // paginated — `total` is the count across all pages, `pages` the page count
    return req<{ products: Card[]; facets?: Facets; total: number; page: number; pages: number; limit: number }>(`/products${qs ? `?${qs}` : ""}`);
  },
  product: (slug: string) => req<ProductFull>(`/products/${slug}`),
  search: (q: string) => req<{ products: Card[] }>(`/search?q=${encodeURIComponent(q)}`),
  brands: () => req<{ brands: Brand[] }>("/brands"),
  createOrder: (body: unknown) => req<{ number: string; totalCents: number; subtotalCents: number; discountCents: number; giftCardCents: number; deliveryCents: number; whatsappNumber: string }>("/orders", { method: "POST", body: JSON.stringify(body) }),
  trackOrder: (number: string) => req<Order>(`/orders/${number}`),
  submitReview: (slug: string, body: unknown) => req<{ ok: boolean; message: string }>(`/products/${slug}/reviews`, { method: "POST", body: JSON.stringify(body) }),
  // promotions
  validateCoupon: (code: string, subtotalCents: number) => req<{ ok: boolean; discountCents: number }>("/coupons/validate", { method: "POST", body: JSON.stringify({ code, subtotalCents }) }),
  checkGiftCard: (code: string) => req<{ ok: boolean; code: string; balanceCents: number }>(`/gift-cards/${encodeURIComponent(code)}`),
  // auth
  register: (body: unknown) => req<{ token: string; customer: Customer }>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: unknown) => req<{ token: string; customer: Customer }>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  // Answers identically whether or not the address is registered — anything else would let
  // this endpoint be used to test which addresses have accounts. 503 means the store cannot
  // send email at all, which the UI checks for up front via `settings.emailConfigured`.
  forgotPassword: (email: string) => req<{ ok: boolean }>("/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    req<{ token: string; customer: Customer }>("/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
  me: () => req<{ customer: Customer; addresses: Address[] }>("/auth/me"),
  updateMe: (body: unknown) => req<{ customer: Customer }>("/auth/me", { method: "PUT", body: JSON.stringify(body) }),
  myOrders: () => req<{ orders: Order[] }>("/auth/orders"),
  addresses: () => req<{ addresses: Address[] }>("/auth/addresses"),
  addAddress: (body: unknown) => req<{ id: number }>("/auth/addresses", { method: "POST", body: JSON.stringify(body) }),
  updateAddress: (id: number, body: unknown) => req<{ ok: boolean }>(`/auth/addresses/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAddress: (id: number) => req<{ ok: boolean }>(`/auth/addresses/${id}`, { method: "DELETE" }),
  // Takes no arguments, and that is the design. The account is resolved from the bearer token
  // server-side; there is no phone, id or email to pass, so there is nothing here that a caller
  // could point at somebody else's account.
  rewards: () => req<Rewards>("/loyalty/me"),
};

export const usd = (cents: number) => "$" + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
export const priceOf = (c: { priceCents: number; saleCents: number | null }) => c.saleCents ?? c.priceCents;
export const waLink = (number: string, text: string) => `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

/**
 * Is the store's WhatsApp number usable?
 *
 * Checkout, gift cards, contact and every order conversation run through WhatsApp, so a
 * placeholder number means orders silently go nowhere. Mirrors the server's validation
 * (server/src/setup.ts) so the UI can disable a CTA instead of rendering a dead wa.me link.
 * The server remains the authority — this only decides what to render.
 */
export function waUsable(raw: string | undefined | null): boolean {
  const v = (raw ?? "").trim();
  if (!v || /[a-z]/i.test(v)) return false;
  const d = v.replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return false;
  if (/(\d)\1{4,}/.test(d)) return false;                       // 9613000000
  for (let i = 1, asc = 1, desc = 1; i < d.length; i++) {        // 1234567
    const delta = d.charCodeAt(i) - d.charCodeAt(i - 1);
    asc = delta === 1 ? asc + 1 : 1;
    desc = delta === -1 ? desc + 1 : 1;
    if (asc >= 6 || desc >= 6) return false;
  }
  return true;
}

/** Explanation shown on a disabled WhatsApp control. */
export const WA_UNSET_HELP =
  "WhatsApp isn't set up yet — the store's number is missing or a placeholder. Add a real number in Settings.";

/** `waLink` when the number is usable, otherwise "" so buttons render inert. */
export const waHref = (number: string | undefined | null, text: string) =>
  waUsable(number) ? waLink(String(number), text) : "";
