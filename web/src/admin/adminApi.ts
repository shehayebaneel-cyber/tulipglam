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

export const adminApi = {
  summary: () => req<AdminSummary>("/summary"),
  /** Everything unconfigured or placeholder-valued, for the Dashboard banner. */
  setup: () => req<{ checks: SetupCheck[]; adminKeyIsDefault: boolean }>("/setup"),
  catalogueHealth: () => req<CatalogueHealth>("/catalogue-health"),
  // products — paginated + filtered + sorted entirely on the server
  products: (p: ProductQuery) => req<ProductPage>(`/products${qs({ ...p })}`),
  bulk: (body: { action: "status" | "category" | "brand" | "delete"; ids: number[]; status?: string; categoryId?: number; brandId?: string }) =>
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
  sort?: string;
  dir?: string;
  page?: number;
  limit?: number;
};
export type ProductPage = { products: AdminProduct[]; total: number; page: number; pages: number; limit: number };

export type AdminProduct = {
  id: number; name: string; slug: string; sku: string; status: string; source: string;
  priceCents: number; saleCents: number | null; isBestSeller: boolean; glyph: string; tint: string;
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
  categoryId: number; brandId: number | null;
  variants: AdminVariant[]; images: AdminImage[];
};
export type AdminCategory = { id: number; slug: string; name: string; blurb: string; glyph: string; tint: string; sortOrder: number; active: boolean; parentId: number | null; _count: { products: number } };
export type AdminBrand = { id: number; slug: string; name: string; blurb: string; featured: boolean; sortOrder: number; active: boolean; _count: { products: number } };
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
