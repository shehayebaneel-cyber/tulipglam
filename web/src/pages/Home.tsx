import { Link } from "react-router-dom";
import { api, usd } from "../lib/api";
import { useStore } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { ProductCard } from "../components/ProductCard";
import { ProductGlyph } from "../components/ProductGlyph";
import { TulipMark, Stars, ArrowRight, Spinner } from "../components/ui";
import type { Card } from "../lib/api";

// Hero image — swap this path to change the photo (files live in web/public/hero/):
//   hero-tulipglam.webp (blush) · hero-tulipglam-lilac.webp (purple)
const HERO_IMG = "/hero/hero-tulipglam-lilac.webp";

// Category card photos by slug (files in web/public/category/). Slugs without an
// entry fall back to the line-art glyph.
const CATEGORY_IMG: Record<string, string> = {
  makeup: "/category/makeup.webp",
  skincare: "/category/skincare.webp",
  "bath-body": "/category/bath-body.webp",
  hair: "/category/hair.webp",
  fragrance: "/category/fragrance.webp",
  "gift-sets": "/category/gift-sets.webp",
};

function SectionHead({ eyebrow, title, to }: { eyebrow: string; title: string; to?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="serif mt-1 text-[1.6rem] font-medium leading-none text-ink sm:text-3xl">{title}</h2>
      </div>
      {to && (
        <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-plum hover:gap-1.5">
          View all <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

function Row({ items }: { items: Card[] }) {
  return (
    <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-5 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-4">
      {items.map((p) => (
        <div key={p.id} className="w-[45%] shrink-0 snap-start sm:w-auto">
          <ProductCard p={p} />
        </div>
      ))}
    </div>
  );
}

export function Home() {
  const { site } = useStore();
  const { data, loading } = useFetch(() => api.home(), []);
  const categories = site?.categories ?? [];
  const settings = site?.settings ?? {};
  const brands = site?.brands ?? [];
  const promoOn = settings.promoActive !== "false";

  return (
    <div className="pb-6">
      {/* ---------------- HERO ---------------- */}
      <section className="wrap pt-4 sm:pt-6">
        <div
          className="grid items-center gap-7 overflow-hidden rounded-[24px] border border-line p-6 sm:p-8 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:p-11"
          style={{ background: "linear-gradient(135deg,#f4e1eb 0%,#faf3ef 54%,#f1e9e4 100%)" }}
        >
          {/* text */}
          <div className="order-2 lg:order-1">
            <p className="eyebrow">Premium beauty · Delivered across Lebanon</p>
            <h1 className="serif mt-3 text-[2rem] font-medium leading-[1.07] tracking-[-0.01em] text-ink sm:text-[2.5rem] lg:text-[2.85rem]">
              Where Tulips Bloom, <span className="italic text-plum">Glam Begins.</span>
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink/70">
              Premium makeup, skincare, haircare and fragrance from the world’s favourite beauty brands.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link to="/shop" className="btn btn-primary btn-cta px-8 py-3.5">Shop now</Link>
              <Link to="/new" className="inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink hover:text-plum">
                New arrivals <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <p className="mt-6 text-[12px] text-muted">Authentic products · USD pricing · Delivery across Lebanon</p>
          </div>
          {/* image */}
          <div className="order-1 lg:order-2">
            <div className="overflow-hidden rounded-[18px] shadow-pop">
              <img
                src={HERO_IMG}
                alt="Premium makeup, skincare and fragrance"
                loading="eager"
                className="h-[240px] w-full object-cover object-center sm:h-[340px] lg:h-[430px]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- TRUST STRIP ---------------- */}
      <section className="wrap mt-4">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line text-center sm:grid-cols-4">
          {[
            ["Free delivery", "on orders over $60"],
            ["Cash on delivery", "pay when it arrives"],
            ["100% authentic", "genuine brands only"],
            ["All of Lebanon", "fast, tracked dispatch"],
          ].map(([a, b]) => (
            <div key={a} className="bg-surface px-3 py-4">
              <p className="text-[13px] font-semibold text-ink">{a}</p>
              <p className="mt-0.5 text-[11px] text-muted">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- SHOP BY CATEGORY ---------------- */}
      <section className="wrap mt-14">
        <SectionHead eyebrow="Shop by category" title="Where do you want to glow?" />
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-5">
          {categories.map((c) => (
            <Link key={c.slug} to={`/category/${c.slug}`} className="group block overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-plum/40">
              {CATEGORY_IMG[c.slug] ? (
                // self-contained card image (label + tagline are baked into the artwork)
                <div className="aspect-[3/2] overflow-hidden" style={{ background: c.tint }}>
                  <img src={CATEGORY_IMG[c.slug]} alt={c.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                </div>
              ) : (
                <>
                  <div className="relative grid aspect-[16/10] place-items-center overflow-hidden" style={{ background: c.tint }}>
                    <ProductGlyph kind={c.glyph} className="h-20 w-20 text-plum/45 transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <div className="px-3.5 py-3">
                    <h3 className="text-[15px] font-semibold text-ink">{c.name}</h3>
                    <p className="mt-0.5 text-[11px] text-muted">{c.blurb}</p>
                  </div>
                </>
              )}
            </Link>
          ))}
        </div>
      </section>

      {loading && <div className="wrap mt-14 grid place-items-center py-10 text-plum"><Spinner /></div>}

      {/* ---------------- BEST SELLERS ---------------- */}
      {!!data?.bestSellers.length && (
        <section className="wrap mt-14">
          <SectionHead eyebrow="Loved by everyone" title="Best sellers" to="/bestsellers" />
          <Row items={data.bestSellers} />
        </section>
      )}

      {/* ---------------- PROMOTION ---------------- */}
      {promoOn && (
        <section className="wrap mt-14">
          <div className="relative overflow-hidden rounded-[22px] bg-plum px-7 py-10 text-white sm:px-12 sm:py-14">
            <TulipMark className="pointer-events-none absolute -right-6 -top-6 h-48 w-48 text-white/10" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">Limited time</p>
            <h2 className="serif mt-2 max-w-lg text-3xl font-medium leading-tight sm:text-4xl">{settings.promoTitle ?? "The Skincare Edit — up to 30% off"}</h2>
            <p className="mt-3 max-w-md text-sm text-white/80">{settings.promoText ?? "Serums, moisturisers and masks. While stocks last."}</p>
            <Link to="/sale" className="btn mt-6 bg-white px-7 py-3.5 text-plum btn-cta hover:bg-white/90">Shop the sale</Link>
          </div>
        </section>
      )}

      {/* ---------------- NEW ARRIVALS ---------------- */}
      {!!data?.newArrivals.length && (
        <section className="wrap mt-14">
          <SectionHead eyebrow="Just landed" title="New arrivals" to="/new" />
          <Row items={data.newArrivals} />
        </section>
      )}

      {/* ---------------- FEATURED BRANDS ---------------- */}
      {!!brands.length && (
        <section className="wrap mt-14">
          <SectionHead eyebrow="Featured" title="Brands we love" to="/brands" />
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
            {brands.slice(0, 8).map((b) => (
              <Link key={b.slug} to={`/shop?brand=${b.slug}`} className="grid place-items-center bg-surface px-4 py-8 transition-colors hover:bg-soft">
                <span className="serif text-lg font-medium tracking-tight text-ink/85">{b.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ---------------- GIFT CARDS ---------------- */}
      <section className="wrap mt-14">
        <div className="grid items-center gap-6 overflow-hidden rounded-[22px] border border-line bg-surface p-7 sm:grid-cols-[1.2fr_1fr] sm:p-10">
          <div>
            <p className="eyebrow">Digital gift cards</p>
            <h2 className="serif mt-2 text-3xl font-medium leading-tight text-ink">Give the gift of glow</h2>
            <p className="mt-3 max-w-md text-sm text-muted">Send a TulipGlam gift card by email or WhatsApp — pick an amount, add a message, and let them choose exactly what they love.</p>
            <Link to="/gift-cards" className="btn btn-primary mt-6 px-7 py-3.5 btn-cta">Shop gift cards</Link>
          </div>
          <div className="grid place-items-center">
            <div className="relative w-full max-w-xs rotate-[-3deg] rounded-2xl bg-gradient-to-br from-plum to-plum-dark p-6 text-white shadow-pop">
              <div className="flex items-center justify-between">
                <TulipMark className="h-7 w-7 text-white" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">Gift card</span>
              </div>
              <p className="serif mt-10 text-4xl font-medium tabular">{usd(5000)}</p>
              <p className="mt-1 text-xs text-white/70">TulipGlam · redeemable at checkout</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- REVIEWS ---------------- */}
      {!!data?.reviews.length && (
        <section className="wrap mt-14">
          <SectionHead eyebrow="Kind words" title="What our customers say" />
          <div className="grid gap-4 sm:grid-cols-3">
            {data.reviews.slice(0, 3).map((r) => (
              <figure key={r.id} className="flex flex-col rounded-2xl border border-line bg-surface p-5">
                <Stars rating={r.rating} />
                <blockquote className="mt-3 flex-1 text-[14px] leading-relaxed text-ink/90">“{r.text}”</blockquote>
                <figcaption className="mt-4 text-[13px]">
                  <span className="font-semibold text-ink">{r.author}</span>
                  {r.product && <span className="text-muted"> · {r.product}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
