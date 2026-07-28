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

export type Variant = { id: number; type: "shade" | "size"; label: string; hex: string; priceCents: number | null; available: boolean };
export type Review = { id: number; author: string; rating: number; title: string; text: string; product?: string; createdAt?: string };

export type ProductFull = Card & {
  shortDesc: string; description: string; howToUse: string; ingredients: string;
  videoUrl: string; concerns: string[]; attributes: string[];
  images: { url: string; alt: string }[]; variants: Variant[];
  reviews: Review[]; ratingAvg: number; reviewCount: number; related: Card[];
};

export type Category = { id: number; slug: string; name: string; blurb: string; glyph: Glyph; tint: string; sortOrder: number; _count?: { products: number } };
export type Brand = { id: number; slug: string; name: string; blurb: string; featured: boolean; _count?: { products: number } };
export type Area = { id: number; name: string; feeCents: number; active: boolean };
export type StatusMeta = { key: string; label: string; hint: string; tone: string; terminal?: boolean };

export type SiteData = {
  settings: Record<string, string>;
  categories: (Category & { _count: { products: number } })[];
  brands: Brand[]; areas: Area[]; statuses: StatusMeta[];
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

export type Customer = { id: number; email: string; fullName: string; phone: string };
export type Address = { id: number; label: string; fullName: string; phone: string; area: string; city: string; address: string; isDefault: boolean };

export const api = {
  site: () => req<SiteData>("/site"),
  home: () => req<{ bestSellers: Card[]; newArrivals: Card[]; reviews: Review[] }>("/home"),
  products: (q: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== "") as [string, string][]).toString();
    return req<{ products: Card[]; total: number }>(`/products${qs ? `?${qs}` : ""}`);
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
  me: () => req<{ customer: Customer; addresses: Address[] }>("/auth/me"),
  updateMe: (body: unknown) => req<{ customer: Customer }>("/auth/me", { method: "PUT", body: JSON.stringify(body) }),
  myOrders: () => req<{ orders: Order[] }>("/auth/orders"),
  addresses: () => req<{ addresses: Address[] }>("/auth/addresses"),
  addAddress: (body: unknown) => req<{ id: number }>("/auth/addresses", { method: "POST", body: JSON.stringify(body) }),
  updateAddress: (id: number, body: unknown) => req<{ ok: boolean }>(`/auth/addresses/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAddress: (id: number) => req<{ ok: boolean }>(`/auth/addresses/${id}`, { method: "DELETE" }),
};

export const usd = (cents: number) => "$" + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
export const priceOf = (c: { priceCents: number; saleCents: number | null }) => c.saleCents ?? c.priceCents;
export const waLink = (number: string, text: string) => `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
