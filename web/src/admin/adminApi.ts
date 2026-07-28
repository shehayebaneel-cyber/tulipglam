// Admin API client — sends the admin key (stored in localStorage) on every call.
const KEY = "tg_admin_key";
export const getKey = () => localStorage.getItem(KEY) ?? "";
export const setKey = (k: string) => localStorage.setItem(KEY, k);
export const clearKey = () => localStorage.removeItem(KEY);

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-admin-key": getKey(), ...(init?.headers ?? {}) },
  });
  if (res.status === 401) { const e = new Error("Unauthorized"); (e as Error & { code?: number }).code = 401; throw e; }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body as T;
}

export const adminApi = {
  summary: () => req<AdminSummary>("/summary"),
  // products
  products: (q: string, status: string) => req<{ products: AdminProduct[] }>(`/products?q=${encodeURIComponent(q)}&status=${status}`),
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
  orders: (q: string, status: string) => req<{ orders: AdminOrder[] }>(`/orders?q=${encodeURIComponent(q)}&status=${status}`),
  order: (id: number) => req<AdminOrder>(`/orders/${id}`),
  setOrderStatus: (id: number, status: string, note: string) => req<{ ok: boolean; status: string }>(`/orders/${id}/status`, { method: "PUT", body: JSON.stringify({ status, note }) }),
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
export type AdminProduct = { id: number; name: string; slug: string; status: string; priceCents: number; saleCents: number | null; isBestSeller: boolean; glyph: string; tint: string; brand: { name: string } | null; category: { name: string }; images: { url: string }[]; _count: { variants: number } };
export type AdminVariant = { id?: number; type: string; label: string; hex: string; priceCents: number | null; available: boolean };
export type AdminImage = { id?: number; url: string; alt: string };
export type AdminProductFull = AdminProduct & { shortDesc: string; description: string; howToUse: string; ingredients: string; isNewMode: string; concerns: string; attributes: string; videoUrl: string; categoryId: number; brandId: number | null; variants: AdminVariant[]; images: AdminImage[] };
export type AdminCategory = { id: number; slug: string; name: string; blurb: string; glyph: string; tint: string; sortOrder: number; active: boolean; parentId: number | null; _count: { products: number } };
export type AdminBrand = { id: number; slug: string; name: string; blurb: string; featured: boolean; sortOrder: number; active: boolean; _count: { products: number } };
export type AdminOrderItem = { id: number; name: string; brandName: string; variantLabel: string; glyph: string; tint: string; imageUrl: string; priceCents: number; qty: number };
export type AdminOrderEvent = { id: number; status: string; note: string; createdAt: string };
export type AdminOrder = { id: number; number: string; status: string; fullName: string; phone: string; whatsapp: string; email: string; area: string; city: string; address: string; notes: string; subtotalCents: number; deliveryCents: number; totalCents: number; createdAt: string; items: AdminOrderItem[]; events?: AdminOrderEvent[] };
export type AdminReview = { id: number; author: string; rating: number; title: string; text: string; approved: boolean; createdAt: string; product: { name: string; slug: string } };
export type AdminArea = { id: number; name: string; feeCents: number; active: boolean; sortOrder: number };
export type AdminCoupon = { id: number; code: string; type: string; value: number; minOrderCents: number; maxUses: number | null; usedCount: number; expiresAt: string | null; active: boolean };
export type AdminGiftCard = { id: number; code: string; initialCents: number; balanceCents: number; recipientName: string; senderName: string; message: string; active: boolean; createdAt: string };
export type AdminCustomer = { id: number; email: string; fullName: string; phone: string; createdAt: string; orderCount: number; spentCents: number };
