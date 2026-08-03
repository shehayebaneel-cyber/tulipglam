import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { adminApi, getKey, setKey, clearKey } from "./adminApi";
import {
  TulipMark, Spinner, CloseIcon, MenuIcon, GaugeIcon, BoxIcon, TagIcon, LayersIcon,
  TicketIcon, GiftIcon, UsersIcon, ChatIcon, UploadIcon, SettingsIcon, ClipboardIcon, ExternalIcon, StarIcon, TruckIcon,
} from "../components/ui";
import { ToastProvider } from "./primitives/Toast";

type Item = { to: string; label: string; icon: (p: { className?: string }) => React.ReactElement; end?: boolean };

/** Grouped so the eleven destinations read as four short lists rather than one long one. */
const NAV: { group: string; items: Item[] }[] = [
  { group: "", items: [
    { to: "/admin", label: "Dashboard", icon: GaugeIcon, end: true },
    { to: "/admin/pulse", label: "What's happening", icon: ChatIcon },
  ] },
  {
    group: "Catalog",
    items: [
      { to: "/admin/products", label: "Products", icon: BoxIcon },
      { to: "/admin/categories", label: "Categories", icon: LayersIcon },
      { to: "/admin/brands", label: "Brands", icon: TagIcon },
    ],
  },
  {
    group: "Sales",
    items: [
      { to: "/admin/orders", label: "Orders", icon: ClipboardIcon },
      { to: "/admin/dispatch", label: "Dispatch", icon: TruckIcon },
      // The catalogue gaps customers named themselves. Under Sales, not Catalogue: each row is
      // a person waiting for a reply, not a data-entry task.
      { to: "/admin/requests", label: "Requests", icon: ClipboardIcon },
      { to: "/admin/coupons", label: "Coupons", icon: TicketIcon },
      { to: "/admin/gift-cards", label: "Gift Cards", icon: GiftIcon },
    ],
  },
  {
    group: "People",
    items: [
      { to: "/admin/customers", label: "Customers", icon: UsersIcon },
      { to: "/admin/loyalty", label: "Rewards", icon: StarIcon },
      { to: "/admin/reviews", label: "Reviews", icon: ChatIcon },
    ],
  },
  {
    group: "System",
    items: [
      { to: "/admin/import", label: "Import", icon: UploadIcon },
      { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

export function AdminLayout() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [key, setInput] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!getKey()) { setAuthed(false); return; }
    adminApi.summary().then(() => setAuthed(true)).catch(() => setAuthed(false));
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    setKey(key);
    try { await adminApi.summary(); setAuthed(true); }
    catch { setErr("Wrong key. Try again."); clearKey(); }
    finally { setBusy(false); }
  };

  if (authed === null) return <div className="grid min-h-screen place-items-center text-plum"><Spinner /></div>;

  if (!authed) return (
    <div className="grid min-h-screen place-items-center bg-soft px-5">
      <form onSubmit={login} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 shadow-card">
        <div className="flex items-center gap-2 text-plum"><TulipMark className="h-7 w-7" /><span className="serif text-xl font-medium text-ink">TulipGlam Admin</span></div>
        <p className="mt-2 text-[13px] text-muted">Enter your admin key to continue.</p>
        <input autoFocus type="password" value={key} onChange={(e) => setInput(e.target.value)} placeholder="Admin key" className="field mt-4" />
        {err && <p className="mt-2 text-[12px] text-sale">{err}</p>}
        <button disabled={busy} className="btn btn-ink mt-4 w-full py-3">{busy ? "Checking…" : "Sign in"}</button>
      </form>
    </div>
  );

  // Active state is a left plum bar plus a soft tint — the old solid plum fill dominated the
  // sidebar and fought the one-accent rule.
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `focus-ring relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${
      isActive
        ? "bg-plum-soft text-plum before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-plum"
        : "text-ink/75 hover:bg-soft hover:text-ink"
    }`;

  const Sidebar = () => (
    <>
      <div className="flex items-center gap-2 px-3 py-4 text-plum">
        <TulipMark className="h-6 w-6" /><span className="serif text-lg font-medium text-ink">TulipGlam</span>
      </div>
      <nav aria-label="Admin sections" className="px-2">
        {NAV.map((section) => (
          <div key={section.group || "root"} className={section.group ? "mt-4" : ""}>
            {section.group && <p className="th-label px-3 pb-1.5">{section.group}</p>}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setDrawer(false)} className={linkCls}>
                  <item.icon className="h-[18px] w-[18px] shrink-0" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-auto space-y-0.5 px-2 pb-4 pt-6">
        <button onClick={() => navigate("/")} className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-muted-strong hover:bg-soft hover:text-ink">
          <ExternalIcon className="h-[18px] w-[18px] shrink-0" /> View store
        </button>
        <button onClick={() => { clearKey(); setAuthed(false); }} className="focus-ring flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-sale hover:bg-sale/10">
          <CloseIcon className="h-[18px] w-[18px] shrink-0" /> Sign out
        </button>
      </div>
    </>
  );

  return (
    <ToastProvider>
    <div className="min-h-screen bg-soft">
      <div className="mx-auto flex max-w-[1400px]">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-surface lg:flex">
          <Sidebar />
        </aside>

        <div className="min-w-0 flex-1">
          {/* mobile topbar */}
          <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
            <button onClick={() => setDrawer(true)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-soft"><MenuIcon /></button>
            <span className="serif text-lg font-medium text-ink">TulipGlam Admin</span>
          </div>
          <main className="p-4 sm:p-6 lg:p-8">
            <Outlet />
          </main>
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col overflow-y-auto bg-surface shadow-pop">
            <button onClick={() => setDrawer(false)} aria-label="Close menu" className="focus-ring absolute right-3 top-4 grid h-9 w-9 place-items-center rounded-full hover:bg-soft"><CloseIcon /></button>
            <Sidebar />
          </aside>
        </div>
      )}
    </div>
    </ToastProvider>
  );
}
