import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Wordmark, SearchIcon, HeartIcon, BagIcon, MenuIcon, CloseIcon, TulipMark, UserIcon } from "./ui";
import { useStore } from "../lib/store";

export function Header() {
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { site, cartCount, wishlist, customer } = useStore();
  const categories = site?.categories ?? [];
  const announcement = site?.settings.announcement ?? "Free delivery over $60 · Cash on delivery across Lebanon";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setSearch(false); setMenu(false);
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  const link = ({ isActive }: { isActive: boolean }) =>
    `text-[13px] font-medium tracking-wide transition-colors hover:text-plum ${isActive ? "text-plum" : "text-ink/80"}`;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      {/* announcement */}
      <div className="bg-plum text-center text-[11px] font-medium tracking-[0.08em] text-white">
        <p className="wrap py-1.5">{announcement}</p>
      </div>

      <div className="wrap">
        <div className="flex h-16 items-center gap-3">
          <button onClick={() => setMenu(true)} aria-label="Open menu" className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-soft lg:hidden"><MenuIcon /></button>

          <Link to="/" aria-label="TulipGlam — home" className="mx-auto lg:mx-0"><Wordmark /></Link>

          {/* desktop search */}
          <form onSubmit={submit} className="ml-6 hidden flex-1 items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 focus-within:border-ink lg:flex">
            <SearchIcon className="h-[18px] w-[18px] text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, brands…" className="w-full bg-transparent text-sm outline-none placeholder:text-muted" />
          </form>

          <nav className="ml-auto flex items-center gap-0.5">
            <button onClick={() => setSearch((s) => !s)} aria-label="Search" className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-soft lg:hidden"><SearchIcon /></button>
            <Link to="/account" aria-label={customer ? "Your account" : "Sign in"} className="hidden h-10 w-10 place-items-center rounded-full text-ink hover:bg-soft lg:grid"><UserIcon /></Link>
            <Link to="/wishlist" aria-label="Wishlist" className="relative grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-soft">
              <HeartIcon />
              {wishlist.length > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-plum px-1 text-[10px] font-bold text-white">{wishlist.length}</span>}
            </Link>
            <Link to="/cart" aria-label="Cart" className="relative grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-soft">
              <BagIcon />
              {cartCount > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-plum px-1 text-[10px] font-bold text-white">{cartCount}</span>}
            </Link>
          </nav>
        </div>

        {/* mobile search bar */}
        {search && (
          <form onSubmit={submit} className="flex items-center gap-2 border-t border-line py-2.5 lg:hidden">
            <SearchIcon className="h-[18px] w-[18px] text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, brands…" className="w-full bg-transparent text-sm outline-none placeholder:text-muted" />
            <button type="button" onClick={() => setSearch(false)} aria-label="Close search" className="text-muted"><CloseIcon className="h-4 w-4" /></button>
          </form>
        )}

        {/* desktop category nav */}
        <nav className="hidden items-center justify-center gap-7 pb-3 lg:flex">
          {categories.map((c) => (
            <NavLink key={c.slug} to={`/category/${c.slug}`} className={link}>{c.name}</NavLink>
          ))}
          <NavLink to="/brands" className={link}>Brands</NavLink>
          {/* Only shown when something is actually reduced. Zero products have a sale price, so
              this link previously led to an empty page — and it was the one element allowed to
              use the sale red, which made the emptiness louder. */}
          {site?.flags?.hasSale && (
            <NavLink to="/sale" className={({ isActive }) => `text-[13px] font-semibold tracking-wide text-sale hover:opacity-80 ${isActive ? "opacity-80" : ""}`}>Sale</NavLink>
          )}
        </nav>
      </div>

      {/* mobile drawer */}
      {menu && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMenu(false)} />
          <div className="absolute left-0 top-0 flex h-full w-[86%] max-w-sm flex-col bg-paper shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-4 py-4">
              <Wordmark />
              <button onClick={() => setMenu(false)} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-soft"><CloseIcon /></button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3">
              <Link to="/shop" onClick={() => setMenu(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 font-semibold hover:bg-soft">Shop all</Link>
              {categories.map((c) => (
                <Link key={c.slug} to={`/category/${c.slug}`} onClick={() => setMenu(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] hover:bg-soft">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: c.tint }}><TulipMark className="h-4 w-4 text-plum" /></span>
                  {c.name}
                </Link>
              ))}
              <hr className="my-2 border-line" />
              {([
                ["/new", "New Arrivals"],
                ["/bestsellers", "Best Sellers"],
                // same rule as desktop: no Sale entry unless something is reduced
                ...(site?.flags?.hasSale ? [["/sale", "Sale"]] : []),
                ["/brands", "Brands"],
                ["/gift-cards", "Gift Cards"],
                ["/track", "Order Tracking"],
                ["/contact", "Contact"],
              ] as [string, string][]).map(([to, label]) => (
                <Link key={to} to={to} onClick={() => setMenu(false)} className="block rounded-xl px-3 py-2.5 text-[15px] hover:bg-soft">{label}</Link>
              ))}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
