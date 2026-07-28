import { Link } from "react-router-dom";
import { usd } from "../lib/api";
import { useStore, lineKey } from "../lib/store";
import { ProductGlyph } from "../components/ProductGlyph";
import { PlusIcon, MinusIcon, TrashIcon, BagIcon, ChevronRight } from "../components/ui";

export function Cart() {
  const { cart, setQty, removeLine, cartSubtotal, site } = useStore();
  const threshold = Number(site?.settings.freeDeliveryThresholdCents ?? 6000);
  const freeShip = cartSubtotal >= threshold;
  const toFree = Math.max(0, threshold - cartSubtotal);

  if (cart.length === 0) return (
    <div className="wrap grid min-h-[56vh] place-items-center py-16 text-center">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-plum-soft text-plum"><BagIcon className="h-7 w-7" /></div>
        <h1 className="serif mt-5 text-3xl text-ink">Your bag is empty</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted">Discover our best sellers and new arrivals — beautifully sourced for Lebanon.</p>
        <Link to="/shop" className="btn btn-ink mt-6 px-7 py-3.5">Start shopping</Link>
      </div>
    </div>
  );

  return (
    <div className="wrap py-6 sm:py-8">
      <h1 className="serif text-3xl font-medium text-ink sm:text-4xl">Your bag</h1>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* lines */}
        <div>
          {!freeShip && (
            <div className="mb-4 rounded-xl border border-line bg-plum-soft/50 px-4 py-3 text-[13px] text-plum">
              You’re <strong>{usd(toFree)}</strong> away from free delivery.
            </div>
          )}
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {cart.map((l) => {
              const k = lineKey(l);
              return (
                <li key={k} className="flex gap-4 p-4">
                  <Link to={`/product/${l.slug}`} className="grid h-24 w-20 shrink-0 place-items-center overflow-hidden rounded-xl" style={{ background: l.tint }}>
                    {l.image ? <img src={l.image} alt="" className="h-full w-full object-cover" /> : <ProductGlyph kind={l.glyph} className="h-full w-full p-3 text-plum/45" />}
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex justify-between gap-2">
                      <div className="min-w-0">
                        {l.brand && <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{l.brand}</p>}
                        <Link to={`/product/${l.slug}`} className="line-clamp-2 text-[14px] font-medium text-ink hover:text-plum">{l.name}</Link>
                        {l.variantLabel && <p className="mt-0.5 text-[12px] text-muted">{l.variantLabel}</p>}
                      </div>
                      <button onClick={() => removeLine(k)} aria-label="Remove" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-soft hover:text-sale"><TrashIcon className="h-[18px] w-[18px]" /></button>
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <div className="flex items-center rounded-full border border-line-strong">
                        <button onClick={() => setQty(k, l.qty - 1)} className="grid h-9 w-9 place-items-center text-ink hover:text-plum" aria-label="Decrease"><MinusIcon className="h-3.5 w-3.5" /></button>
                        <span className="w-7 text-center text-[14px] font-semibold tabular">{l.qty}</span>
                        <button onClick={() => setQty(k, l.qty + 1)} className="grid h-9 w-9 place-items-center text-ink hover:text-plum" aria-label="Increase"><PlusIcon className="h-3.5 w-3.5" /></button>
                      </div>
                      <span className="serif text-[16px] font-medium text-ink tabular">{usd(l.priceCents * l.qty)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Link to="/shop" className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-plum hover:gap-1.5">Continue shopping <ChevronRight className="h-4 w-4" /></Link>
        </div>

        {/* summary */}
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Order summary</h2>
            <dl className="mt-4 space-y-2.5 text-[14px]">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="font-medium tabular">{usd(cartSubtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd className="font-medium tabular">{freeShip ? <span className="text-ok">Free</span> : "Calculated at checkout"}</dd></div>
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-[14px] font-semibold text-ink">Total</span>
              <span className="serif text-2xl font-medium text-ink tabular">{usd(cartSubtotal)}{!freeShip && <span className="text-[13px] text-muted"> +</span>}</span>
            </div>
            <Link to="/checkout" className="btn btn-ink btn-cta mt-5 w-full py-3.5">Checkout</Link>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-muted">Cash on delivery · confirmed on WhatsApp.<br />Orders are subject to product availability.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
