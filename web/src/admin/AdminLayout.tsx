import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { adminApi, getKey, setKey, clearKey } from "./adminApi";
import { TulipMark, Spinner, CloseIcon, MenuIcon } from "../components/ui";

const NAV = [
  ["/admin", "Dashboard", true],
  ["/admin/orders", "Orders", false],
  ["/admin/products", "Products", false],
  ["/admin/categories", "Categories", false],
  ["/admin/brands", "Brands", false],
  ["/admin/coupons", "Coupons", false],
  ["/admin/gift-cards", "Gift Cards", false],
  ["/admin/customers", "Customers", false],
  ["/admin/reviews", "Reviews", false],
  ["/admin/import", "Import", false],
  ["/admin/settings", "Settings", false],
] as const;

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

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2 text-[14px] font-medium transition-colors ${isActive ? "bg-plum text-white" : "text-ink/75 hover:bg-soft"}`;

  const Sidebar = () => (
    <>
      <div className="flex items-center gap-2 px-3 py-4 text-plum">
        <TulipMark className="h-6 w-6" /><span className="serif text-lg font-medium text-ink">TulipGlam</span>
      </div>
      <nav className="space-y-1 px-2">
        {NAV.map(([to, label, end]) => (
          <NavLink key={to} to={to} end={end as boolean} onClick={() => setDrawer(false)} className={linkCls}>{label}</NavLink>
        ))}
      </nav>
      <div className="mt-auto space-y-1 px-2 pb-4">
        <button onClick={() => navigate("/")} className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-muted hover:bg-soft">← View store</button>
        <button onClick={() => { clearKey(); setAuthed(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-sale hover:bg-soft">Sign out</button>
      </div>
    </>
  );

  return (
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
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col bg-surface shadow-pop">
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 grid h-9 w-9 place-items-center rounded-full hover:bg-soft"><CloseIcon /></button>
            <Sidebar />
          </aside>
        </div>
      )}
    </div>
  );
}
