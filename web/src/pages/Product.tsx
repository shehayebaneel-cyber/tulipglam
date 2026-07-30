import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api, usd, priceOf, type Variant } from "../lib/api";
import { useStore } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { ProductGlyph } from "../components/ProductGlyph";
import { ProductCard } from "../components/ProductCard";
import { Stars, HeartIcon, HeartFill, PlusIcon, MinusIcon, CheckIcon, TruckIcon, PlayIcon, ChevronRight, Spinner } from "../components/ui";

export function Product() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { addToCart, toggleWish, inWish } = useStore();
  const { data: p, loading, error } = useFetch(() => api.product(slug), [slug]);

  const [imgIdx, setImgIdx] = useState(0);
  // When a shade with its own photo is picked, that photo takes over the hero.
  // Clicking a thumbnail hands control back to the gallery.
  const [showShadeImg, setShowShadeImg] = useState(true);
  // Photos that failed to load, tracked per URL so one bad shade photo doesn't hide
  // the hero for every other shade. Falls back to the glyph instead of raw alt text.
  const [failedImgs, setFailedImgs] = useState<ReadonlySet<string>>(new Set());
  const [variant, setVariant] = useState<Variant | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [tab, setTab] = useState<"desc" | "how" | "ing">("desc");

  if (loading) return <div className="grid min-h-[60vh] place-items-center text-plum"><Spinner /></div>;
  if (error || !p) return (
    <div className="wrap grid min-h-[52vh] place-items-center py-20 text-center">
      <div><h1 className="serif text-3xl text-ink">Product not found</h1><p className="mt-2 text-sm text-muted">{error}</p><Link to="/shop" className="btn btn-ghost mt-6 px-6 py-3">Back to shop</Link></div>
    </div>
  );

  const shades = p.variants.filter((v) => v.type === "shade");
  const sizes = p.variants.filter((v) => v.type === "size");
  const needsChoice = p.variants.length > 0;
  const chosen = variant ?? (needsChoice ? null : null);
  const unavailable = p.status === "unavailable";
  const price = chosen?.priceCents ?? priceOf(p);
  const wished = inWish(p.slug);
  const gallery = p.images.length ? p.images : null;

  const shadeImg = chosen?.type === "shade" ? chosen.imageUrl : "";
  const heroUrl = (showShadeImg && shadeImg) || (gallery ? gallery[imgIdx].url : "");
  const heroAlt = showShadeImg && shadeImg ? `${p.name} — ${chosen!.label}` : gallery ? gallery[imgIdx].alt || p.name : p.name;

  const pickShade = (v: Variant) => { setVariant(v); setShowShadeImg(true); };

  const canAdd = !unavailable && (!needsChoice || !!chosen) && (!chosen || chosen.available);

  const add = () => {
    if (!canAdd) return;
    addToCart({
      productId: p.id, slug: p.slug, name: p.name, brand: p.brand?.name ?? "",
      variantId: chosen?.id, variantLabel: chosen?.label, glyph: p.glyph, tint: p.tint,
      image: shadeImg || p.images[0]?.url || "", priceCents: price, qty,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  };

  return (
    <div className="wrap py-6 sm:py-8">
      {/* breadcrumb */}
      <nav className="mb-4 flex flex-wrap items-center gap-1 text-[12px] text-muted">
        <Link to="/" className="hover:text-plum">Home</Link><ChevronRight className="h-3.5 w-3.5" />
        <Link to={`/category/${p.category.slug}`} className="hover:text-plum">{p.category.name}</Link><ChevronRight className="h-3.5 w-3.5" />
        <span className="text-ink/70">{p.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        {/* ---------- gallery ---------- */}
        <div className="lg:sticky lg:top-28 lg:self-start">
          <div className="relative overflow-hidden rounded-3xl" style={{ background: p.tint }}>
            <div className="aspect-square w-full">
              {heroUrl && !failedImgs.has(heroUrl) ? (
                <img src={heroUrl} alt={heroAlt} onError={() => setFailedImgs((s) => new Set(s).add(heroUrl))} className="h-full w-full object-cover" />
              ) : (
                <ProductGlyph kind={p.glyph} className="h-full w-full p-16 text-plum/45" />
              )}
            </div>
            {(p.onSale || p.isNew) && (
              <div className="absolute left-4 top-4 flex gap-2">
                {p.onSale && <span className="rounded-full bg-sale px-2.5 py-1 text-[11px] font-bold text-white">Sale</span>}
                {p.isNew && !p.onSale && <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-paper">New</span>}
              </div>
            )}
          </div>
          {/* thumbnails */}
          {gallery && gallery.length > 1 && (
            <div className="mt-3 flex gap-2.5">
              {gallery.map((im, i) => (
                <button key={i} onClick={() => { setImgIdx(i); setShowShadeImg(false); }}
                  className={`h-16 w-16 overflow-hidden rounded-xl border-2 ${i === imgIdx && !(showShadeImg && shadeImg) ? "border-plum" : "border-transparent"}`}>
                  <img src={im.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          {/* video */}
          {p.videoUrl && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-line">
              <video src={p.videoUrl} controls playsInline preload="metadata" className="w-full" />
            </div>
          )}
          {!gallery && p.videoUrl && (
            <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-muted"><PlayIcon className="h-3.5 w-3.5" /> Product video</p>
          )}
        </div>

        {/* ---------- info ---------- */}
        <div>
          {p.brand && <Link to={`/shop?brand=${p.brand.slug}`} className="text-[12px] font-semibold uppercase tracking-[0.16em] text-muted hover:text-plum">{p.brand.name}</Link>}
          <h1 className="serif mt-1.5 text-3xl font-medium leading-tight text-ink sm:text-4xl">{p.name}</h1>
          {p.reviewCount > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <Stars rating={p.ratingAvg} />
              <span className="text-[13px] text-muted">{p.ratingAvg.toFixed(1)} · {p.reviewCount} review{p.reviewCount === 1 ? "" : "s"}</span>
            </div>
          )}
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{p.shortDesc}</p>

          {/* price */}
          <div className="mt-5 flex items-baseline gap-3">
            <span className="serif text-3xl font-medium text-ink tabular">{usd(price)}</span>
            {p.onSale && <span className="serif text-lg text-muted line-through tabular">{usd(p.priceCents)}</span>}
            {p.onSale && <span className="rounded-full bg-plum-soft px-2 py-0.5 text-[12px] font-semibold text-plum">Save {usd(p.priceCents - (p.saleCents ?? 0))}</span>}
          </div>

          {unavailable && (
            <div className="mt-4 rounded-xl border border-line-strong bg-soft px-4 py-3 text-[13px] text-ink/80">
              This item is <strong>temporarily unavailable</strong>. Add it to your wishlist and we’ll help you find it.
            </div>
          )}

          {/* attributes */}
          {p.attributes.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {p.attributes.map((a) => <span key={a} className="rounded-full border border-line bg-surface px-3 py-1 text-[12px] capitalize text-ink/75">{a.replace("-", " ")}</span>)}
            </div>
          )}

          {/* shades */}
          {shades.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">Shade{chosen && chosen.type === "shade" ? `: ${chosen.label}` : ""}</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2.5">
                {shades.map((v) => (
                  <button key={v.id} onClick={() => pickShade(v)} disabled={!v.available} title={v.label}
                    className={`relative h-10 w-10 overflow-hidden rounded-full ring-offset-2 transition disabled:opacity-30 ${chosen?.id === v.id ? "ring-2 ring-plum" : "ring-1 ring-line-strong"}`}
                    style={v.hex ? { background: v.hex } : undefined} aria-label={v.label} aria-pressed={chosen?.id === v.id}>
                    {/* hex when we have a true shade colour; otherwise the shade's own photo */}
                    {!v.hex && v.imageUrl && <img src={v.imageUrl} alt="" className="h-full w-full scale-150 object-cover" />}
                    {!v.hex && !v.imageUrl && <span className="block h-full w-full bg-soft" />}
                    {chosen?.id === v.id && <CheckIcon className="absolute inset-0 m-auto h-4 w-4 text-white mix-blend-difference" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* sizes */}
          {sizes.length > 0 && (
            <div className="mt-6">
              <span className="text-[13px] font-semibold text-ink">Size</span>
              <div className="mt-2.5 flex flex-wrap gap-2.5">
                {sizes.map((v) => (
                  <button key={v.id} onClick={() => setVariant(v)} disabled={!v.available}
                    className={`rounded-full border px-4 py-2 text-[13px] font-medium transition disabled:opacity-30 ${chosen?.id === v.id ? "border-plum bg-plum-soft text-plum" : "border-line-strong text-ink/80 hover:border-ink"}`}>
                    {v.label}{v.priceCents ? ` · ${usd(v.priceCents)}` : ""}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* qty + add */}
          <div className="mt-7 flex items-stretch gap-3">
            <div className="flex items-center rounded-full border border-line-strong">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="grid h-12 w-12 place-items-center text-ink hover:text-plum" aria-label="Decrease"><MinusIcon className="h-4 w-4" /></button>
              <span className="w-8 text-center text-[15px] font-semibold tabular">{qty}</span>
              <button onClick={() => setQty((q) => Math.min(99, q + 1))} className="grid h-12 w-12 place-items-center text-ink hover:text-plum" aria-label="Increase"><PlusIcon className="h-4 w-4" /></button>
            </div>
            <button onClick={add} disabled={!canAdd}
              className="btn btn-ink btn-cta flex-1 text-[15px] disabled:cursor-not-allowed disabled:opacity-45">
              {added ? <span className="inline-flex items-center gap-1.5"><CheckIcon className="h-4 w-4" /> Added</span>
                : unavailable ? "Unavailable"
                : needsChoice && !chosen ? (shades.length ? "Select a shade" : "Select a size")
                : "Add to bag"}
            </button>
            <button onClick={() => toggleWish(p)} aria-label="Wishlist" aria-pressed={wished}
              className="grid w-12 shrink-0 place-items-center rounded-full border border-line-strong text-ink hover:border-plum hover:text-plum">
              {wished ? <HeartFill className="h-5 w-5 text-plum" /> : <HeartIcon className="h-5 w-5" />}
            </button>
          </div>
          {added && <button onClick={() => navigate("/cart")} className="mt-3 text-[13px] font-semibold text-plum hover:underline">View bag →</button>}

          {/* assurances */}
          <div className="mt-6 space-y-2 rounded-2xl border border-line bg-surface p-4 text-[13px] text-ink/80">
            <p className="flex items-center gap-2"><TruckIcon className="h-4 w-4 text-plum" /> Cash on delivery across Lebanon · free over $60</p>
            <p className="flex items-center gap-2"><CheckIcon className="h-4 w-4 text-plum" /> 100% authentic — sourced from official brands</p>
            <p className="text-[12px] text-muted">Orders are subject to product availability. If an item is unavailable, we’ll contact you before dispatch.</p>
          </div>

          {/* tabs */}
          <div className="mt-8">
            <div className="flex gap-1 border-b border-line">
              {([["desc", "Description"], ["how", "How to use"], ["ing", "Ingredients"]] as const)
                .filter(([k]) => k === "desc" || (k === "how" && p.howToUse) || (k === "ing" && p.ingredients))
                .map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-3 py-2.5 text-[13px] font-semibold transition ${tab === k ? "border-plum text-ink" : "border-transparent text-muted hover:text-ink"}`}>{label}</button>
                ))}
            </div>
            <div className="prose-tg pt-4 text-[14px] leading-relaxed text-ink/85">
              {tab === "desc" && <p>{p.description || p.shortDesc}</p>}
              {tab === "how" && <p>{p.howToUse}</p>}
              {tab === "ing" && <p>{p.ingredients}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- reviews ---------- */}
      <Reviews slug={p.slug} reviews={p.reviews} avg={p.ratingAvg} count={p.reviewCount} />

      {/* ---------- related ---------- */}
      {p.related.length > 0 && (
        <section className="mt-16">
          <h2 className="serif mb-5 text-2xl font-medium text-ink sm:text-3xl">You may also like</h2>
          <div className="grid grid-cols-2 gap-x-3.5 gap-y-8 sm:grid-cols-4 sm:gap-5">
            {p.related.map((r) => <ProductCard key={r.id} p={r} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function Reviews({ slug, reviews, avg, count }: { slug: string; reviews: import("../lib/api").Review[]; avg: number; count: number }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ author: "", rating: 5, title: "", text: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api.submitReview(slug, form);
      setMsg(r.message); setForm({ author: "", rating: 5, title: "", text: "" }); setOpen(false);
    } catch (err) { setMsg((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <section className="mt-16 border-t border-line pt-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="serif text-2xl font-medium text-ink sm:text-3xl">Reviews</h2>
          {count > 0 && <div className="mt-1.5 flex items-center gap-2"><Stars rating={avg} /><span className="text-[13px] text-muted">{avg.toFixed(1)} out of 5 · {count} review{count === 1 ? "" : "s"}</span></div>}
        </div>
        <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost px-5 py-2.5 text-[13px]">Write a review</button>
      </div>

      {msg && <div className="mt-4 rounded-xl border border-ok/30 bg-ok/5 px-4 py-3 text-[13px] text-ok">{msg}</div>}

      {open && (
        <form onSubmit={submit} className="mt-5 grid gap-3 rounded-2xl border border-line bg-surface p-5 sm:max-w-lg">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-ink">Rating</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" key={n} onClick={() => setForm((f) => ({ ...f, rating: n }))} className={n <= form.rating ? "text-plum" : "text-line-strong"} aria-label={`${n} stars`}>
                <span className="text-xl">★</span>
              </button>
            ))}
          </div>
          <input required placeholder="Your name" value={form.author} onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))} className="field" />
          <input placeholder="Title (optional)" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="field" />
          <textarea required placeholder="Share your experience…" value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} rows={3} className="field resize-none" />
          <button disabled={busy} className="btn btn-ink py-3">{busy ? "Submitting…" : "Submit review"}</button>
        </form>
      )}

      {count === 0 ? (
        <p className="mt-5 text-sm text-muted">No reviews yet — be the first to share your thoughts.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {reviews.map((r) => (
            <figure key={r.id} className="rounded-2xl border border-line bg-surface p-5">
              <Stars rating={r.rating} />
              {r.title && <p className="mt-2 text-[14px] font-semibold text-ink">{r.title}</p>}
              <blockquote className="mt-1.5 text-[14px] leading-relaxed text-ink/85">“{r.text}”</blockquote>
              <figcaption className="mt-3 text-[13px] font-semibold text-ink">{r.author}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
