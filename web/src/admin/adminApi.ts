// Admin API client — sends the admin key (stored in localStorage) on every call.
const KEY = "tg_admin_key";
export const getKey = () => localStorage.getItem(KEY) ?? "";
export const setKey = (k: string) => localStorage.setItem(KEY, k);
export const clearKey = () => localStorage.removeItem(KEY);

/** Error carrying per-field messages, so Settings can show them inline. */
export class ApiError extends Error {
  code?: number;
  fields?: Record<string, string>;
  constructor(message: string, code?: number, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.fields = fields;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-admin-key": getKey(), ...(init?.headers ?? {}) },
  });
  if (res.status === 401) throw new ApiError("Unauthorized", 401);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { error?: string; errors?: Record<string, string> };
    throw new ApiError(b.error ?? "Request failed", res.status, b.errors);
  }
  return body as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" ) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
};


/**
 * Loyalty admin types.
 *
 * These deliberately carry the RAW ledger vocabulary — `redemptionReversal`, `void`,
 * `dedupeKey`, row ids. The customer-facing `Rewards` type in lib/api.ts carries none of it.
 * Two shapes for two audiences, and the customer one is the one that must never leak machinery.
 */
export type LoyaltyDashboard = {
  outstandingPoints: number; liabilityCents: number; centsPerPoint: number;
  pendingPoints: number; pendingLiabilityCents: number;
  issuedThisMonth: number; redeemedThisMonth: number; expiredThisMonth: number;
  accounts: number; linkedAccounts: number;
  tiers: { key: string; label: string; count: number }[];
  monthLabel: string;
};

export type LoyaltyHit = {
  id: number; phoneE164: string; phoneDisplay: string;
  customerId: number | null; customerName: string; customerEmail: string;
  tier: string; balanceCached: number; createdAt: string;
};

export type LoyaltyClaim = {
  orderId: number; number: string; deliveredAt: string | null;
  merchandiseCents: number; basePoints: number;
  matchedOn: string; customerName: string;
  decision: { decision: string; decidedBy: string; note: string; decidedAt: string } | null;
};

export type LoyaltyLedgerRow = {
  id: number; type: string; status: string; points: number; multiplierApplied: number;
  orderId: number | null; orderNumber: string | null; orderStatus: string | null;
  reason: string; enteredBy: string; dedupeKey: string | null;
  createdAt: string; confirmedAt: string | null;
};

export type LoyaltyAccountDetail = {
  id: number; phoneE164: string; phoneDisplay: string; email: string; createdAt: string;
  customer: { id: number; fullName: string; email: string } | null;
  refusalCount: number; redemptionBlocked: boolean;
  stored: { tier: string; tierEarnedAt: string; balanceCached: number };
  derived: {
    balance: number; pending: number; tier: string; tierEarnedAt: string;
    qualifiesFor: string; windowSpendCents: number;
    expiresAt: string | null; hasLapsed: boolean;
    pendingWrites: { confirm: number; expirePoints: number; tierChange: string | null };
  };
  claims: { guest: LoyaltyClaim[]; signedIn: LoyaltyClaim[] };
  entries: LoyaltyLedgerRow[];
};

/** One order, as a delivery driver needs to see it. `collectCents` is the order total, never recomputed. */
export type DispatchLine = {
  id: number; number: string; status: string; statusLabel: string;
  fullName: string; phone: string; whatsapp: string;
  area: string; city: string; address: string; notes: string;
  itemCount: number; collectCents: number; collectLabel: string;
  whyDifferent: string; createdAt: string;
  items: { name: string; variantLabel: string; qty: number; priceCents: number }[];
};

export type Manifest = {
  generatedAt: string;
  outForDelivery: DispatchLine[];
  preparing: DispatchLine[];
  expectedCashCents: number; expectedCashLabel: string;
  discountedCount: number;
};

/**
 * What is actually in the till, after the round — as distinct from the manifest, which is a
 * forecast made before anyone left. Keeping them apart is what stops a refused parcel reading
 * as missing money.
 */
export type Reconciliation = {
  since: string; until: string;
  collectedCents: number; collectedLabel: string;
  delivered: { number: string; name: string; collectedCents: number; collectedLabel: string; paidWithPointsCents: number }[];
  refused: { number: string; name: string; wouldHaveBeenCents: number; wouldHaveBeenLabel: string; status: string }[];
  refusedCents: number; refusedLabel: string;
  stillOutCents: number; stillOutLabel: string; stillOutCount: number;
  accountedForCents: number; accountedForLabel: string;
  paidWithPointsCents: number; paidWithPointsLabel: string;
};

/** The launch list, for the coming-soon email capture. */
export type LaunchList = {
  total: number; subscribed: number; unsubscribed: number; notified: number;
  today: number; last7: number;
  recent: { id: number; email: string; source: string; createdAt: string; notifiedAt: string | null; unsubscribedAt: string | null }[];
};

export type Pulse = {
  ordersToday: number; ordersWeek: number; revenueTodayCents: number;
  signupsToday: number; signupsTotal: number;
  openErrors: number;
  newestError: { message: string; path: string; count: number; lastSeen: string } | null;
  outboxWaiting: number;
  traffic: { since: string; pageViews: number; apiCalls: number; topPaths: { path: string; hits: number }[] };
};

export type ErrorRow = {
  id: number; fingerprint: string; method: string; path: string; status: number;
  message: string; stack: string; count: number;
  firstSeen: string; lastSeen: string; resolvedAt: string | null;
};

export type OutboxStatus = {
  configured: boolean; waiting: number; sent: number; expired: number; failed: number;
  byKind: { kind: string; waiting: number }[];
  oldestWaiting: string | null;
};

export const adminApi = {
  summary: () => req<AdminSummary>("/summary"),
  // what's happening — all measured server-side, no tracker on the storefront
  pulse: () => req<Pulse>("/pulse"),
  errors: () => req<{ errors: ErrorRow[] }>("/errors"),
  resolveError: (id: number) => req<{ ok: boolean }>(`/errors/${id}/resolve`, { method: "POST" }),
  outbox: () => req<OutboxStatus>("/outbox"),
  flushOutbox: () => req<{ configured: boolean; sent: number; failed: number; expired: number; remaining: number }>("/outbox/flush", { method: "POST" }),
  /**
   * The launch list as a file.
   *
   * Fetched with the admin key in a HEADER and handed back as a blob, rather than linked with
   * the key in a query string — a link would put the key in Render's access logs, the browser
   * history and any Referer.
   */
  launchListCsv: async (): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch("/api/admin/launch-signups.csv", { headers: { "x-admin-key": getKey() } });
    if (!res.ok) throw new ApiError(res.status === 401 ? "Unauthorized" : "Could not export the list", res.status);
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename="([^"]+)"/);
    return { blob: await res.blob(), filename: match?.[1] ?? "tulipglam-launch-list.csv" };
  },
  // dispatch — what the driver collects
  dispatch: () => req<Manifest>("/dispatch"),
  dispatchOne: (id: number) => req<DispatchLine & { courierMessage: string }>(`/dispatch/${id}`),
  dispatchReconcile: () => req<Reconciliation>("/dispatch/reconcile"),
  // launch list
  launchList: () => req<LaunchList>("/launch-signups"),
  // loyalty — behind the same x-admin-key gate as everything else here
  loyaltyDashboard: () => req<LoyaltyDashboard>("/loyalty/dashboard"),
  loyaltyAccounts: (q: string) => req<{ accounts: LoyaltyHit[] }>(`/loyalty/accounts${qs({ q })}`),
  loyaltyAccount: (id: number) => req<LoyaltyAccountDetail>(`/loyalty/accounts/${id}`),
  loyaltyAdjust: (id: number, body: { points: number; reason: string; enteredBy: string; orderId?: number }) =>
    req<{ ok: boolean; id: number }>(`/loyalty/accounts/${id}/adjust`, { method: "POST", body: JSON.stringify(body) }),
  loyaltyDecideClaim: (id: number, orderId: number, body: { decision: "approved" | "rejected"; decidedBy: string; note: string }) =>
    req<{ ok: boolean; granted: number }>(`/loyalty/accounts/${id}/claims/${orderId}`, { method: "POST", body: JSON.stringify(body) }),
  loyaltyLink: (id: number, body: { customerId: number; approvedBy: string }) =>
    req<{ ok: boolean; linked: boolean }>(`/loyalty/accounts/${id}/link`, { method: "POST", body: JSON.stringify(body) }),
  loyaltyMaterialise: (id: number) =>
    req<{ confirmed: number; expiredPoints: number; tierChanged: boolean; balance: number }>(`/loyalty/accounts/${id}/materialise`, { method: "POST" }),
  /** Everything unconfigured or placeholder-valued, for the Dashboard banner. */
  setup: () => req<{ checks: SetupCheck[]; adminKeyIsDefault: boolean }>("/setup"),
  catalogueHealth: () => req<CatalogueHealth>("/catalogue-health"),
  // products — paginated + filtered + sorted entirely on the server
  products: (p: ProductQuery) => req<ProductPage>(`/products${qs({ ...p })}`),
  bulk: (body: { action: "status" | "category" | "brand" | "audience" | "delete"; ids: number[]; status?: string; categoryId?: number; brandId?: string; audience?: string }) =>
    req<{ ok: boolean; count: number }>("/products/bulk", { method: "POST", body: JSON.stringify(body) }),
  product: (id: number) => req<AdminProductFull>(`/products/${id}`),
  createProduct: (b: unknown) => req<{ id: number }>("/products", { method: "POST", body: JSON.stringify(b) }),
  updateProduct: (id: number, b: unknown) => req<{ ok: boolean }>(`/products/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteProduct: (id: number) => req<{ ok: boolean }>(`/products/${id}`, { method: "DELETE" }),
  setStatus: (id: number, status: string) => req<{ ok: boolean }>(`/products/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  upload: (data: string) => req<{ url: string }>("/upload", { method: "POST", body: JSON.stringify({ data }) }),
  // taxonomy
  categories: () => req<{ categories: AdminCategory[] }>("/categories"),
  createCategory: (b: unknown) => req<{ id: number }>("/categories", { method: "POST", body: JSON.stringify(b) }),
  updateCategory: (id: number, b: unknown) => req<{ ok: boolean }>(`/categories/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteCategory: (id: number) => req<{ ok: boolean }>(`/categories/${id}`, { method: "DELETE" }),
  brands: () => req<{ brands: AdminBrand[] }>("/brands"),
  createBrand: (b: unknown) => req<{ id: number }>("/brands", { method: "POST", body: JSON.stringify(b) }),
  updateBrand: (id: number, b: unknown) => req<{ ok: boolean }>(`/brands/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteBrand: (id: number) => req<{ ok: boolean }>(`/brands/${id}`, { method: "DELETE" }),
  // orders
  orders: (q: string, status: string, page = 1) =>
    req<{ orders: AdminOrder[]; total: number; page: number; pages: number; limit: number }>(`/orders${qs({ q, status, page })}`),
  order: (id: number) => req<AdminOrderFull>(`/orders/${id}`),
  setOrderStatus: (id: number, status: string, note: string) => req<{ ok: boolean; status: string }>(`/orders/${id}/status`, { method: "PUT", body: JSON.stringify({ status, note }) }),
  /** Record which line could not be sourced and move the order to awaiting_customer. */
  askCustomer: (id: number, itemId: number, note: string) => req<{ ok: boolean }>(`/orders/${id}/awaiting`, { method: "POST", body: JSON.stringify({ itemId, note }) }),
  /** One-click resolution of awaiting_customer. `remove` recomputes the order server-side. */
  resolveOrder: (id: number, action: "accept" | "remove" | "cancel", note: string) =>
    req<{ ok: boolean }>(`/orders/${id}/resolve`, { method: "POST", body: JSON.stringify({ action, note }) }),
  // reviews
  reviews: (pending: boolean) => req<{ reviews: AdminReview[] }>(`/reviews${pending ? "?pending=1" : ""}`),
  approveReview: (id: number, approved: boolean) => req<{ ok: boolean }>(`/reviews/${id}`, { method: "PATCH", body: JSON.stringify({ approved }) }),
  deleteReview: (id: number) => req<{ ok: boolean }>(`/reviews/${id}`, { method: "DELETE" }),
  // coupons
  coupons: () => req<{ coupons: AdminCoupon[] }>("/coupons"),
  createCoupon: (b: unknown) => req<{ id: number }>("/coupons", { method: "POST", body: JSON.stringify(b) }),
  updateCoupon: (id: number, b: unknown) => req<{ ok: boolean }>(`/coupons/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteCoupon: (id: number) => req<{ ok: boolean }>(`/coupons/${id}`, { method: "DELETE" }),
  // gift cards
  giftCards: () => req<{ giftCards: AdminGiftCard[] }>("/gift-cards"),
  createGiftCard: (b: unknown) => req<{ id: number; code: string }>("/gift-cards", { method: "POST", body: JSON.stringify(b) }),
  updateGiftCard: (id: number, b: unknown) => req<{ ok: boolean }>(`/gift-cards/${id}`, { method: "PUT", body: JSON.stringify(b) }),
  deleteGiftCard: (id: number) => req<{ ok: boolean }>(`/gift-cards/${id}`, { method: "DELETE" }),
  // customers
  customers: (q: string) => req<{ customers: AdminCustomer[] }>(`/customers?q=${encodeURIComponent(q)}`),
  // settings
  settings: () => req<{ settings: Record<string, string>; areas: AdminArea[] }>("/settings"),
  saveSettings: (settings: Record<string, string>) => req<{ ok: boolean }>("/settings", { method: "PUT", body: JSON.stringify({ settings }) }),
  saveAreas: (areas: unknown[]) => req<{ ok: boolean }>("/delivery-areas", { method: "PUT", body: JSON.stringify({ areas }) }),
  // import
  importFile: (data: string) => req<{ created: number; updated: number; errors: string[] }>("/import", { method: "POST", body: JSON.stringify({ data }) }),
};

export type AdminSummary = { products: number; active: number; orders: number; pendingReviews: number; revenueCents: number; byStatus: Record<string, number>; recent: AdminOrder[] };

export type Severity = "missing" | "placeholder" | "unverified";
export type SetupCheck = { key: string; label: string; severity: Severity; message: string; fix: string };
export type CatalogueHealth = {
  total: number;
  issues: { key: string; label: string; count: number; filter: string }[];
  imports: { source: string; count: number; lastAt: string | null }[];
};

/** Query for the admin product list. Every field maps to a URL param the server honours. */
export type ProductQuery = {
  q?: string;
  status?: string;
  categoryId?: number | string;
  brandId?: string;
  source?: string;
  priceMin?: string;
  priceMax?: string;
  hasImage?: string;
  hasVariants?: string;
  /** "unisex" | "men" | "women", or "locked" / "unlocked" to review the classifier. */
  audience?: string;
  sort?: string;
  dir?: string;
  page?: number;
  limit?: number;
};
export type ProductPage = { products: AdminProduct[]; total: number; page: number; pages: number; limit: number };

export type AdminProduct = {
  id: number; name: string; slug: string; sku: string; status: string; source: string;
  priceCents: number; saleCents: number | null; isBestSeller: boolean; glyph: string; tint: string;
  audience: string; audienceLocked: boolean;
  updatedAt: string;
  brand: { id: number; name: string; slug: string } | null;
  category: { id: number; name: string; slug: string };
  images: { url: string }[];
  _count: { variants: number; images: number };
};
// sku = supplier reference (admin-only). imageUrl = this shade's own photo; when hex
// is empty the storefront uses that photo as the swatch, so both must round-trip
// through the editor or a save would wipe them.
export type AdminVariant = { id?: number; type: string; label: string; sku?: string; hex: string; imageUrl?: string; priceCents: number | null; available: boolean };
export type AdminImage = { id?: number; url: string; alt: string };
/**
 * GET /products/:id includes only images + variants, so the relations are scalar ids here.
 * Deliberately not extending AdminProduct, which carries the joined brand/category objects
 * the list needs.
 */
export type AdminProductFull = {
  id: number; name: string; slug: string; sku: string; status: string; source: string;
  priceCents: number; saleCents: number | null; isBestSeller: boolean; glyph: string; tint: string;
  shortDesc: string; description: string; howToUse: string; ingredients: string;
  isNewMode: string; concerns: string; attributes: string; videoUrl: string;
  audience: string; audienceLocked: boolean;
  categoryId: number; brandId: number | null;
  variants: AdminVariant[]; images: AdminImage[];
};
export type AdminCategory = { id: number; slug: string; name: string; blurb: string; glyph: string; tint: string; sortOrder: number; active: boolean; parentId: number | null; _count: { products: number } };
export type AdminBrand = { id: number; slug: string; name: string; blurb: string; featured: boolean; sortOrder: number; active: boolean; audience: string; _count: { products: number } };
export type AdminOrderItem = { id: number; name: string; brandName: string; variantLabel: string; glyph: string; tint: string; imageUrl: string; priceCents: number; qty: number };
export type AdminOrderEvent = { id: number; status: string; note: string; createdAt: string };
export type AdminOrder = {
  id: number; number: string; status: string; fullName: string; phone: string; whatsapp: string; email: string;
  area: string; city: string; address: string; notes: string;
  subtotalCents: number; discountCents: number; giftCardCents: number; couponCode: string; giftCardCode: string;
  deliveryCents: number; totalCents: number; createdAt: string;
  awaitingItemId: number | null; awaitingNote: string; awaitingSince: string | null;
  items: AdminOrderItem[]; events?: AdminOrderEvent[];
};

/** The detail endpoint adds context so the admin can explain the money without recomputing it. */
export type AdminOrderFull = AdminOrder & {
  context: {
    freeDeliveryThresholdCents: number;
    defaultDeliveryCents: number;
    areaFeeCents: number | null;
    freeDeliveryApplied: boolean;
    whatsappConfigured: boolean;
  };
  nextStatuses: string[];
};
export type AdminReview = { id: number; author: string; rating: number; title: string; text: string; approved: boolean; createdAt: string; product: { name: string; slug: string } };
export type AdminArea = { id: number; name: string; feeCents: number; active: boolean; sortOrder: number };
export type AdminCoupon = { id: number; code: string; type: string; value: number; minOrderCents: number; maxUses: number | null; usedCount: number; expiresAt: string | null; active: boolean };
export type AdminGiftCard = { id: number; code: string; initialCents: number; balanceCents: number; recipientName: string; senderName: string; message: string; active: boolean; createdAt: string };
export type AdminCustomer = { id: number; email: string; fullName: string; phone: string; createdAt: string; orderCount: number; spentCents: number };
