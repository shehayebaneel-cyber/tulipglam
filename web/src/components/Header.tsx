import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Wordmark, SearchIcon, HeartIcon, BagIcon, MenuIcon, CloseIcon, UserIcon } from "./ui";
import { useStore } from "../lib/store";
import { usd } from "../lib/api";
import { MainNav, MobileNav } from "./MainNav";

export function Header() {
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { site, cartCount, wishlist, customer } = useStore();

  // The fallback used to be the literal string "Free delivery over $60", which stops being
  // true the moment the threshold changes in Settings. Derived from the real figure now, and
  // if there is no threshold set the claim is dropped rather than guessed.
  const threshold = Number(site?.settings.freeDeliveryThresholdCents ?? "");
  const fallback = [
    Number.isFinite(threshold) && threshold > 0 ? `Free delivery over ${usd(threshold)}` : "",
    "Cash on delivery across Lebanon",
  ].filter(Boolean).join(" · ");
  const announcement = site?.settings.announcement ?? fallback;

  // Published as a CSS variable so anything that has to sit below the header — sticky
  // sub-bars, anchor scroll offsets — uses the real height. It differs between mobile and
  // desktop (the nav row) and changes with the announcement, so a hardcoded value drifts.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty("--header-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setSearch(false); setMenu(false);
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      {/* announcement — hidden entirely when there is nothing true to say */}
      {announcement && (
        <div className="bg-plum text-center text-[11px] font-medium tracking-[0.08em] text-white">
          <p className="wrap py-1.5">{announcement}</p>
        </div>
      )}

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
        {/* 15 flat items wrapped mid-label ("Bath &/Body", "Kids &/Baby"); now 6 grouped
            headings with dropdown panels, all derived from the database. */}
        <MainNav site={site ?? null} />
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
            {/* Accordion: at 390px a flat list of 15 departments plus their children is
                unusable, so groups collapse and only one opens at a time. */}
            <nav aria-label="Departments" className="flex-1 overflow-y-auto p-3">
              <MobileNav site={site ?? null} onNavigate={() => setMenu(false)} />
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
