import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, priceOf, setToken, clearToken, getToken, type Card, type SiteData, type Glyph, type Customer } from "./api";

// ------------------------------------------------------------------ cart
export type CartLine = {
  productId: number; slug: string; name: string; brand: string;
  variantId?: number; variantLabel?: string;
  glyph: Glyph; tint: string; image: string;
  priceCents: number; qty: number;
};
const lineKey = (l: Pick<CartLine, "productId" | "variantId">) => `${l.productId}:${l.variantId ?? ""}`;

// ------------------------------------------------------------------ wishlist
type WishItem = Card;

type Store = {
  site: SiteData | null;
  cart: CartLine[];
  addToCart: (line: CartLine) => void;
  setQty: (key: string, qty: number) => void;
  removeLine: (key: string) => void;
  clearCart: () => void;
  cartCount: number;
  cartSubtotal: number;
  wishlist: WishItem[];
  toggleWish: (c: Card) => void;
  inWish: (slug: string) => boolean;
  customer: Customer | null;
  authReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (body: { fullName: string; email: string; password: string; phone?: string }) => Promise<void>;
  logout: () => void;
  setCustomer: (c: Customer) => void;
};

const Ctx = createContext<Store | null>(null);

function usePersist<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [val, setVal] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ } }, [key, val]);
  return [val, setVal];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteData | null>(null);
  const [cart, setCart] = usePersist<CartLine[]>("tg_cart", []);
  const [wishlist, setWishlist] = usePersist<WishItem[]>("tg_wish", []);
  const [customer, setCustomerState] = useState<Customer | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => { api.site().then(setSite).catch(() => {}); }, []);

  // restore session from stored token
  useEffect(() => {
    if (!getToken()) { setAuthReady(true); return; }
    api.me().then((r) => setCustomerState(r.customer)).catch(() => clearToken()).finally(() => setAuthReady(true));
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api.login({ email, password });
    setToken(r.token); setCustomerState(r.customer);
  };
  const register = async (body: { fullName: string; email: string; password: string; phone?: string }) => {
    const r = await api.register(body);
    setToken(r.token); setCustomerState(r.customer);
  };
  const logout = () => { clearToken(); setCustomerState(null); };
  const setCustomer = (c: Customer) => setCustomerState(c);

  const addToCart = (line: CartLine) =>
    setCart((prev) => {
      const k = lineKey(line);
      const existing = prev.find((l) => lineKey(l) === k);
      if (existing) return prev.map((l) => (lineKey(l) === k ? { ...l, qty: Math.min(99, l.qty + line.qty) } : l));
      return [...prev, line];
    });
  const setQty = (key: string, qty: number) =>
    setCart((prev) => prev.map((l) => (lineKey(l) === key ? { ...l, qty: Math.max(1, Math.min(99, qty)) } : l)));
  const removeLine = (key: string) => setCart((prev) => prev.filter((l) => lineKey(l) !== key));
  const clearCart = () => setCart([]);

  const toggleWish = (c: Card) =>
    setWishlist((prev) => (prev.some((w) => w.slug === c.slug) ? prev.filter((w) => w.slug !== c.slug) : [c, ...prev]));
  const inWish = (slug: string) => wishlist.some((w) => w.slug === slug);

  const cartCount = useMemo(() => cart.reduce((n, l) => n + l.qty, 0), [cart]);
  const cartSubtotal = useMemo(() => cart.reduce((n, l) => n + l.priceCents * l.qty, 0), [cart]);

  const value: Store = { site, cart, addToCart, setQty, removeLine, clearCart, cartCount, cartSubtotal, wishlist, toggleWish, inWish, customer, authReady, login, register, logout, setCustomer };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

// convenience: build a cart line from a product card + optional variant
export function lineFromCard(c: Card, variant?: { id: number; label: string; priceCents: number | null }): CartLine {
  return {
    productId: c.id, slug: c.slug, name: c.name, brand: c.brand?.name ?? "",
    variantId: variant?.id, variantLabel: variant?.label,
    glyph: c.glyph, tint: c.tint, image: c.image,
    priceCents: variant?.priceCents ?? priceOf(c), qty: 1,
  };
}
export { lineKey };
