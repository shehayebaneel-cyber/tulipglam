import { useEffect, useState } from "react";
import { Button, ButtonLink } from "../components/Button";
import { Link, useNavigate } from "react-router-dom";
import { api, usd, type Address, type Order } from "../lib/api";
import { productImage } from "../lib/img";
import { useStore } from "../lib/store";
import { ProductGlyph } from "../components/ProductGlyph";
import { UserIcon, BoxIcon, HeartIcon, ChevronRight, PlusIcon, TrashIcon, Spinner, CloseIcon, StarIcon } from "../components/ui";

export function Account() {
  const { customer, authReady, logout, wishlist, setCustomer, site } = useStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"orders" | "addresses" | "profile">("orders");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [addresses, setAddresses] = useState<Address[] | null>(null);

  useEffect(() => { if (authReady && !customer) navigate("/login", { state: { from: "/account" } }); }, [authReady, customer, navigate]);
  useEffect(() => { if (customer) { api.myOrders().then((r) => setOrders(r.orders)); api.addresses().then((r) => setAddresses(r.addresses)); } }, [customer]);

  if (!authReady || !customer) return <div className="grid min-h-[60vh] place-items-center text-plum"><Spinner /></div>;

  const statuses = site?.statuses ?? [];

  return (
    <div className="wrap py-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-plum-soft text-plum"><UserIcon className="h-6 w-6" /></span>
          <div><h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Hi, {customer.fullName.split(" ")[0]}</h1><p className="text-[13px] text-muted">{customer.email}</p></div>
        </div>
        <button onClick={() => { logout(); navigate("/"); }} className="btn btn-ghost px-5 py-2.5 text-[13px]">Sign out</button>
      </div>

      {/* Only when the programme is on. A "Rewards" link that 404s, or that opens a page
          explaining a scheme nobody can join yet, is worse than no link — the same rule the
          Sale link follows. */}
      {site?.flags.loyalty && (
        <Link to="/rewards" className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-plum-soft/50 p-4 transition hover:border-plum/40">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-plum"><StarIcon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">TulipGlam Rewards</p>
            <p className="text-[12px] text-muted">Your points, your tier, and what you’ve earned</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
        </Link>
      )}

      <div className="mt-6 flex gap-1 border-b border-line">
        {([["orders", "Orders"], ["addresses", "Addresses"], ["profile", "Profile"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-4 py-2.5 text-[14px] font-semibold transition ${tab === k ? "border-plum text-ink" : "border-transparent text-muted hover:text-ink"}`}>{l}</button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "orders" && <OrdersTab orders={orders} statuses={statuses} />}
        {tab === "addresses" && <AddressesTab addresses={addresses} reload={() => api.addresses().then((r) => setAddresses(r.addresses))} areas={site?.areas ?? []} />}
        {tab === "profile" && <ProfileTab onSaved={setCustomer} wishCount={wishlist.length} />}
      </div>
    </div>
  );
}

function OrdersTab({ orders, statuses }: { orders: Order[] | null; statuses: { key: string; label: string }[] }) {
  if (!orders) return <div className="grid place-items-center py-16 text-plum"><Spinner /></div>;
  if (orders.length === 0) return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong py-16 text-center">
      <div><BoxIcon className="mx-auto h-8 w-8 text-plum/60" /><p className="serif mt-3 text-xl text-ink">No orders yet</p><ButtonLink to="/shop" variant="primary" className="mt-5">Start shopping</ButtonLink></div>
    </div>
  );
  return (
    <div className="space-y-3">
      {orders.map((o) => (
        <Link key={o.id} to={`/track/${o.number}`} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 hover:border-plum/40">
          <div className="flex -space-x-3">
            {o.items.slice(0, 3).map((it) => (
              <span key={it.id} className="grid h-11 w-10 place-items-center overflow-hidden rounded-lg border-2 border-surface" style={{ background: it.tint }}>
                {it.imageUrl ? <img src={productImage(it.imageUrl, "thumb")} alt="" width={200} height={200} loading="lazy" decoding="async" className="h-full w-full object-contain" /> : <ProductGlyph kind={it.glyph as never} className="h-full w-full p-1.5 text-plum/45" />}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">{o.number}</p>
            <p className="text-[12px] text-muted">{new Date(o.createdAt).toLocaleDateString()} · {o.items.length} item{o.items.length === 1 ? "" : "s"} · {statuses.find((s) => s.key === o.status)?.label ?? o.status}</p>
          </div>
          <span className="serif text-[15px] tabular">{usd(o.totalCents)}</span>
          <ChevronRight className="h-4 w-4 text-muted" />
        </Link>
      ))}
    </div>
  );
}

function AddressesTab({ addresses, reload, areas }: { addresses: Address[] | null; reload: () => void; areas: { id: number; name: string }[] }) {
  const blank: Address = { id: 0, label: "Home", fullName: "", phone: "", area: "", city: "", address: "", isDefault: false };
  const [edit, setEdit] = useState<Address | null>(null);
  if (!addresses) return <div className="grid place-items-center py-16 text-plum"><Spinner /></div>;

  const save = async () => {
    if (!edit) return;
    if (edit.id) await api.updateAddress(edit.id, edit); else await api.addAddress(edit);
    setEdit(null); reload();
  };
  const remove = async (a: Address) => { if (confirm("Delete this address?")) { await api.deleteAddress(a.id); reload(); } };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {addresses.map((a) => (
          <div key={a.id} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-ink">{a.label} {a.isDefault && <span className="ml-1 rounded-full bg-plum-soft px-2 py-0.5 text-[10px] font-semibold text-plum">Default</span>}</p>
              <div className="flex gap-1"><button onClick={() => setEdit(a)} className="rounded-md px-2 py-1 text-[12px] font-semibold text-plum hover:bg-plum-soft">Edit</button><button onClick={() => remove(a)} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:text-sale"><TrashIcon className="h-4 w-4" /></button></div>
            </div>
            <p className="mt-1 text-[13px] text-ink/80">{a.fullName} · {a.phone}</p>
            <p className="text-[13px] text-muted">{[a.address, a.city, a.area].filter(Boolean).join(", ")}</p>
          </div>
        ))}
        <button onClick={() => setEdit(blank)} className="grid min-h-[7rem] place-items-center rounded-2xl border border-dashed border-line-strong text-muted hover:border-plum hover:text-plum">
          <span className="flex flex-col items-center gap-1 text-[13px] font-semibold"><PlusIcon /> Add address</span>
        </button>
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setEdit(null)} />
          <div className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl bg-paper p-6 shadow-pop">
            <div className="mb-4 flex items-center justify-between"><h2 className="serif text-xl text-ink">{edit.id ? "Edit address" : "New address"}</h2><button onClick={() => setEdit(null)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-soft"><CloseIcon /></button></div>
            <div className="space-y-3">
              <input placeholder="Label (Home, Work…)" aria-label="Address label" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} className="field focus-ring" />
              <input placeholder="Recipient name" aria-label="Recipient name" autoComplete="name" value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} className="field focus-ring" />
              <input placeholder="Phone" aria-label="Phone" inputMode="tel" autoComplete="tel" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} className="field focus-ring" />
              <select value={edit.area} onChange={(e) => setEdit({ ...edit, area: e.target.value })} className="field w-full"><option value="">Select area…</option>{areas.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}</select>
              <input placeholder="City / town" aria-label="City or town" autoComplete="address-level2" value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} className="field focus-ring" />
              <textarea placeholder="Full address" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} rows={2} className="field resize-none" />
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={edit.isDefault} onChange={(e) => setEdit({ ...edit, isDefault: e.target.checked })} className="accent-plum" /> Set as default</label>
              <div className="flex gap-2 pt-1"><Button onClick={save} variant="primary" className="flex-1">Save</Button><Button onClick={() => setEdit(null)} variant="tertiary">Cancel</Button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileTab({ onSaved, wishCount }: { onSaved: (c: import("../lib/api").Customer) => void; wishCount: number }) {
  const { customer } = useStore();
  const [f, setF] = useState({ fullName: customer?.fullName ?? "", phone: customer?.phone ?? "" });
  const [msg, setMsg] = useState("");
  const save = async () => { const r = await api.updateMe(f); onSaved(r.customer); setMsg("Saved"); setTimeout(() => setMsg(""), 2000); };

  return (
    <div className="grid gap-4 sm:max-w-md">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Your details</h2>
        <div className="mt-3 space-y-3">
          <input placeholder="Full name" aria-label="Full name" autoComplete="name" value={f.fullName} onChange={(e) => setF((s) => ({ ...s, fullName: e.target.value }))} className="field focus-ring" />
          <input placeholder="Phone" aria-label="Phone" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} className="field focus-ring" />
          <input value={customer?.email ?? ""} disabled aria-label="Email address (cannot be changed)" className="field opacity-60" />
          <Button onClick={save} variant="primary">Save changes</Button>
          {msg && <span className="ml-3 text-[13px] text-ok">{msg}</span>}
        </div>
      </div>
      <Link to="/wishlist" className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-plum/40">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-plum-soft text-plum"><HeartIcon className="h-5 w-5" /></span>
        <div className="flex-1"><p className="text-[14px] font-semibold text-ink">Wishlist</p><p className="text-[12px] text-muted">{wishCount} saved item{wishCount === 1 ? "" : "s"}</p></div>
        <ChevronRight className="h-4 w-4 text-muted" />
      </Link>
    </div>
  );
}
