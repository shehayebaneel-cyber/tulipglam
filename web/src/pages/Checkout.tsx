import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, usd, waHref, type Address } from "../lib/api";
import { Button } from "../components/Button";
import { useStore } from "../lib/store";
import { Field } from "../components/Field";
import { ProductGlyph } from "../components/ProductGlyph";
import { TruckIcon, ChevronDown, WhatsAppIcon, CheckIcon, CloseIcon } from "../components/ui";

export function Checkout() {
  const navigate = useNavigate();
  const { cart, cartSubtotal, clearCart, site, customer } = useStore();
  const areas = site?.areas ?? [];
  const threshold = Number(site?.settings.freeDeliveryThresholdCents ?? 6000);
  const defaultFee = Number(site?.settings.defaultDeliveryCents ?? 300);

  const [form, setForm] = useState({ fullName: "", phone: "", whatsapp: "", email: "", areaId: "", city: "", address: "", notes: "" });
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // coupon + gift card
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<{ code: string; discountCents: number } | null>(null);
  const [couponErr, setCouponErr] = useState("");
  const [giftInput, setGiftInput] = useState("");
  const [gift, setGift] = useState<{ code: string; balanceCents: number } | null>(null);
  const [giftErr, setGiftErr] = useState("");

  useEffect(() => { if (cart.length === 0 && !busy) navigate("/cart", { replace: true }); }, [cart.length, busy, navigate]);

  // prefill for logged-in customers
  useEffect(() => {
    if (!customer) return;
    setForm((f) => ({ ...f, fullName: f.fullName || customer.fullName, phone: f.phone || customer.phone, email: f.email || customer.email }));
    api.addresses().then((r) => {
      setAddresses(r.addresses);
      const def = r.addresses.find((a) => a.isDefault) ?? r.addresses[0];
      if (def) applyAddress(def);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer]);

  const applyAddress = (a: Address) => {
    const area = areas.find((ar) => ar.name === a.area);
    setForm((f) => ({ ...f, fullName: a.fullName || f.fullName, phone: a.phone || f.phone, areaId: area ? String(area.id) : f.areaId, city: a.city, address: a.address }));
  };

  const area = areas.find((a) => String(a.id) === form.areaId);
  const freeShip = cartSubtotal >= threshold;
  const delivery = freeShip ? 0 : area?.feeCents ?? defaultFee;
  const discount = coupon?.discountCents ?? 0;
  const beforeGift = cartSubtotal - discount + delivery;
  const giftUsed = gift ? Math.min(gift.balanceCents, beforeGift) : 0;
  const total = beforeGift - giftUsed;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const applyCoupon = async () => {
    setCouponErr("");
    try { const r = await api.validateCoupon(couponInput.trim(), cartSubtotal); setCoupon({ code: couponInput.trim().toUpperCase(), discountCents: r.discountCents }); }
    catch (e) { setCoupon(null); setCouponErr((e as Error).message); }
  };
  const applyGift = async () => {
    setGiftErr("");
    try { const r = await api.checkGiftCard(giftInput.trim()); setGift({ code: r.code, balanceCents: r.balanceCents }); }
    catch (e) { setGift(null); setGiftErr((e as Error).message); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.fullName.trim() || !form.phone.trim() || !form.address.trim() || !form.areaId) {
      setError("Please fill in your name, phone, delivery area and address."); return;
    }
    setBusy(true);
    try {
      const res = await api.createOrder({
        ...form, areaId: Number(form.areaId),
        couponCode: coupon?.code ?? "", giftCardCode: gift?.code ?? "",
        items: cart.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })),
      });
      const lines = cart.map((l) => `• ${l.qty}× ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ""}`).join("\n");
      const text = `Hi TulipGlam! I placed order ${res.number}.\n\n${lines}\n\nTotal: ${usd(res.totalCents)} (COD)\nName: ${form.fullName}\nArea: ${area?.name ?? ""}\nAddress: ${form.address}`;
      // "" when unusable, so the confirmation screen degrades instead of linking nowhere.
      const wa = waHref(res.whatsappNumber, text);
      clearCart();
      navigate(`/order/${res.number}`, { state: { wa, total: res.totalCents } });
    } catch (err) {
      setError((err as Error).message); setBusy(false);
    }
  };

  if (cart.length === 0) return null;

  return (
    <div className="wrap py-6 sm:py-8">
      <h1 className="serif text-3xl font-medium text-ink sm:text-4xl">Checkout</h1>
      <p className="mt-1 text-sm text-muted">Cash on delivery — no card needed. We confirm every order on WhatsApp.</p>
      {!customer && <p className="mt-2 text-[13px] text-muted"><Link to="/login" state={{ from: "/checkout" }} className="font-semibold text-plum hover:underline">Sign in</Link> for faster checkout, or continue as a guest below.</p>}

      <form onSubmit={submit} className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          {customer && addresses.length > 0 && (
            <fieldset>
              <legend className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Saved addresses</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {addresses.map((a) => (
                  <button type="button" key={a.id} onClick={() => applyAddress(a)} className="rounded-full border border-line-strong px-4 py-2 text-[13px] font-medium hover:border-plum hover:text-plum">
                    {a.label} · {a.area}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Contact</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Full name">
                  <input required value={form.fullName} onChange={set("fullName")} autoComplete="name" className="field focus-ring w-full" />
                </Field>
              </div>
              <Field label="Phone number" hint="We confirm every order on this number">
                <input required value={form.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" className="field focus-ring w-full" />
              </Field>
              <Field label="WhatsApp" hint="Only if it differs from the number above">
                <input value={form.whatsapp} onChange={set("whatsapp")} inputMode="tel" autoComplete="tel" className="field focus-ring w-full" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Email" hint="Optional — for an emailed confirmation">
                  <input value={form.email} onChange={set("email")} type="email" autoComplete="email" className="field focus-ring w-full" />
                </Field>
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Delivery</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="tg-area" className="mb-1 block text-[12px] font-semibold text-ink">Delivery area</label>
                <div className="relative">
                  <select id="tg-area" required value={form.areaId} onChange={set("areaId")} className="field focus-ring w-full appearance-none pr-9">
                    <option value="" disabled>Select area…</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.feeCents === 0 ? "Free" : usd(a.feeCents)}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                </div>
              </div>
              <Field label="City or town">
                <input value={form.city} onChange={set("city")} autoComplete="address-level2" className="field focus-ring w-full" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Full address" hint="Building, street, floor and a landmark — this is what the driver reads">
                  <textarea required value={form.address} onChange={set("address")} rows={3} autoComplete="street-address" className="field focus-ring w-full resize-none" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Order notes" hint="Optional — anything we should know">
                  <textarea value={form.notes} onChange={set("notes")} rows={2} className="field focus-ring w-full resize-none" />
                </Field>
              </div>
            </div>
          </fieldset>

          <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-plum-soft text-plum"><TruckIcon className="h-5 w-5" /></span>
            <div className="text-[13px] leading-relaxed text-ink/80">
              <p className="font-semibold text-ink">Cash on delivery</p>
              <p>Pay the courier when your order arrives. <strong>Orders are subject to product availability</strong> — if an item is unavailable we’ll contact you before dispatch.</p>
            </div>
          </div>
        </div>

        {/* summary */}
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Your order</h2>
            <ul className="mt-4 space-y-3">
              {cart.map((l, i) => (
                <li key={i} className="flex gap-3">
                  <span className="relative grid h-14 w-12 shrink-0 place-items-center overflow-hidden rounded-lg" style={{ background: l.tint }}>
                    {l.image ? <img src={l.image} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <ProductGlyph kind={l.glyph} className="h-full w-full p-2 text-plum/45" />}
                    <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1 text-[10px] font-bold text-paper">{l.qty}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-[13px] font-medium text-ink">{l.name}</p>
                    {l.variantLabel && <p className="text-[11px] text-muted">{l.variantLabel}</p>}
                  </div>
                  <span className="serif text-[14px] tabular">{usd(l.priceCents * l.qty)}</span>
                </li>
              ))}
            </ul>

            {/* coupon */}
            <div className="mt-4 border-t border-line pt-4">
              {coupon ? (
                <div className="flex items-center justify-between rounded-lg bg-plum-soft px-3 py-2 text-[13px]">
                  <span className="font-semibold text-plum">{coupon.code} applied</span>
                  <button type="button" onClick={() => { setCoupon(null); setCouponInput(""); }} className="text-plum hover:text-plum-dark"><CloseIcon className="h-4 w-4" /></button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Coupon code" aria-label="Coupon code" className="field focus-ring flex-1 py-2.5 uppercase" />
                  <button type="button" onClick={applyCoupon} disabled={!couponInput.trim()} className="btn btn-ghost px-4 py-2.5 text-[13px] disabled:opacity-40">Apply</button>
                </div>
              )}
              {couponErr && <p className="mt-1.5 text-[12px] text-sale">{couponErr}</p>}
            </div>

            {/* gift card */}
            <div className="mt-2.5">
              {gift ? (
                <div className="flex items-center justify-between rounded-lg bg-plum-soft px-3 py-2 text-[13px]">
                  <span className="font-semibold text-plum">Gift card · {usd(gift.balanceCents)} available</span>
                  <button type="button" onClick={() => { setGift(null); setGiftInput(""); }} className="text-plum hover:text-plum-dark"><CloseIcon className="h-4 w-4" /></button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input value={giftInput} onChange={(e) => setGiftInput(e.target.value)} placeholder="Gift card code" aria-label="Gift card code" className="field focus-ring flex-1 py-2.5 uppercase" />
                  <button type="button" onClick={applyGift} disabled={!giftInput.trim()} className="btn btn-ghost px-4 py-2.5 text-[13px] disabled:opacity-40">Apply</button>
                </div>
              )}
              {giftErr && <p className="mt-1.5 text-[12px] text-sale">{giftErr}</p>}
            </div>

            <dl className="mt-4 space-y-2 border-t border-line pt-4 text-[14px]">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="tabular">{usd(cartSubtotal)}</dd></div>
              {discount > 0 && <div className="flex justify-between text-plum"><dt>Discount</dt><dd className="tabular">−{usd(discount)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">Delivery{!area && !freeShip ? " (est.)" : ""}</dt><dd className="tabular">{freeShip ? <span className="text-ok">Free</span> : usd(delivery)}</dd></div>
              {giftUsed > 0 && <div className="flex justify-between text-plum"><dt>Gift card</dt><dd className="tabular">−{usd(giftUsed)}</dd></div>}
            </dl>
            <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-[14px] font-semibold text-ink">Total</span>
              <span className="serif text-2xl font-medium text-ink tabular">{usd(total)}</span>
            </div>
            {error && <p className="mt-3 rounded-lg bg-sale/10 px-3 py-2 text-[12px] text-sale">{error}</p>}
            {/* Plum, not WhatsApp green. The order is recorded server-side regardless; the
                WhatsApp hand-off happens on the confirmation screen. */}
            <Button type="submit" disabled={busy} variant="primary" size="lg" full uppercase className="mt-5">
              <WhatsAppIcon className="h-5 w-5" /> {busy ? "Placing order…" : "Place order"}
            </Button>
            {total === 0 && giftUsed > 0 && <p className="mt-2 flex items-center justify-center gap-1 text-center text-[12px] text-ok"><CheckIcon className="h-3.5 w-3.5" /> Fully covered by your gift card</p>}
            <p className="mt-3 text-center text-[11px] text-muted">By placing your order you agree to our <Link to="/terms" className="underline hover:text-plum">Terms</Link>.</p>
          </div>
        </aside>
      </form>
    </div>
  );
}
