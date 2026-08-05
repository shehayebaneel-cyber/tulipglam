import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, usd } from "../lib/api";
import { useStore } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { ProductCard } from "../components/ProductCard";
import { ErrorState } from "../components/ErrorState";
import { ButtonLink } from "../components/Button";
import { CategoryList } from "../components/CategoryList";
import { TulipMark, Stars, ArrowRight, ChevronRight, Spinner } from "../components/ui";
import type { Card } from "../lib/api";

// Hero image — swap this path to change the photo (files live in web/public/hero/):
//   hero-tulipglam.webp (blush) · hero-tulipglam-lilac.webp (purple)
const HERO_IMG = "/hero/hero-tulipglam-lilac.webp";

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

// Horizontal scroller at every breakpoint. Card widths still divide into the old
// 3-up / 4-up rhythm, so the row reads like the grid it replaced — it just keeps
// going sideways instead of wrapping. Arrows appear on pointer devices (md+),
// where the scrollbar is hidden and there's nothing to swipe.
function Row({ items }: { items: Card[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const sync = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setMore({ left: el.scrollLeft > 8, right: el.scrollLeft < max - 8 });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sync, items.length]);

  const nudge = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div className="relative">
      {/* Below md the track bleeds to the screen edge so a partial next card signals
          swipeability. From md up the bleed is removed: the arrows sit in the gutter at
          -left-3/-right-3, and with the bleed they were painted over the first and last
          cards, which is what made the row look clipped. Card widths divide the track
          exactly (3 up at sm, 4 at lg) so snapping lands on clean boundaries. */}
      <div
        ref={track}
        onScroll={sync}
        role="region"
        aria-label="Product carousel — scroll horizontally"
        tabIndex={0}
        className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3.5 overflow-x-auto scroll-px-5 px-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum sm:gap-5 md:mx-0 md:scroll-px-0 md:px-0"
      >
        {items.map((p) => (
          <div
            key={p.id}
            className="w-[46%] shrink-0 snap-start sm:w-[calc((100%_-_2_*_1.25rem)_/_3)] lg:w-[calc((100%_-_3_*_1.25rem)_/_4)]"
          >
            <ProductCard p={p} />
          </div>
        ))}
      </div>

      {([["left", -1], ["right", 1]] as const).map(([side, dir]) => (
        more[side] && (
          <button
            key={side}
            type="button"
            onClick={() => nudge(dir)}
            aria-label={side === "left" ? "Scroll back" : "Scroll forward"}
            className={`absolute top-[37%] z-10 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/95 text-ink shadow-pop backdrop-blur transition-colors hover:border-plum/40 hover:text-plum md:grid ${side === "left" ? "-left-3" : "-right-3"}`}
          >
            <ChevronRight className={`h-4 w-4 ${side === "left" ? "rotate-180" : ""}`} />
          </button>
        )
      ))}
    </div>
  );
}

export function Home() {
  const { site } = useStore();
  const { data, loading, error, reload } = useFetch(() => api.home(), []);
  const categories = site?.categories ?? [];
  const featured = site?.featuredBrands ?? [];
  const promo = data?.promo ?? null;
  const trust = site?.trust ?? [];

  // Hero copy and image, all Settings-driven (heroHeading, heroSub, heroCtaLabel, …).
  // The defaults are the current wording; the image intentionally has no default beyond the
  // shipped file, which is AI-generated and flagged for replacement in AUDIT.md.
  const s = site?.settings ?? {};
  const hero = {
    eyebrow: s.heroEyebrow ?? "Premium beauty · Delivered across Lebanon",
    heading: s.heroHeading ?? "Where Tulips Bloom, Glam Begins.",
    sub: s.heroSub ?? "Premium makeup, skincare, haircare and fragrance from the world’s favourite beauty brands.",
    ctaLabel: s.heroCtaLabel ?? "Shop now",
    ctaHref: s.heroCtaHref ?? "/shop",
    altLabel: s.heroAltLabel ?? "New arrivals",
    altHref: s.heroAltHref ?? "/new",
    footnote: s.heroFootnote ?? "USD pricing · Delivery across Lebanon · Cash on delivery",
    image: s.heroImage ?? HERO_IMG,
  };

  return (
    <div className="pb-6">
      {/* ---------------- HERO ---------------- */}
      <section className="wrap pt-4 sm:pt-6">
        <div
          // Flat plum-soft bed. The previous three-stop gradient introduced #f4e1eb, #faf3ef
          // and #f1e9e4 — none in the palette — and the system is explicitly gradient-free.
          className="grid items-center gap-7 overflow-hidden rounded-[24px] border border-line bg-plum-soft p-6 sm:p-8 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:p-11"
        >
          {/* text — every string Settings-driven so the hero can be rewritten without a deploy */}
          <div className="order-2 lg:order-1">
            {hero.eyebrow && <p className="eyebrow">{hero.eyebrow}</p>}
            <h1 className="serif mt-3 text-[2rem] font-medium leading-[1.07] tracking-[-0.01em] text-ink sm:text-[2.5rem] lg:text-[2.85rem]">
              {hero.heading}
            </h1>
            {hero.sub && <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink/70">{hero.sub}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <ButtonLink to={hero.ctaHref} variant="primary" size="lg" uppercase>{hero.ctaLabel}</ButtonLink>
              {hero.altLabel && (
                <Link to={hero.altHref} className="inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink hover:text-plum">
                  {hero.altLabel} <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
            {hero.footnote && <p className="mt-6 text-[12px] text-muted">{hero.footnote}</p>}
          </div>
          {/* image — see HERO_IMG: the shipped file is AI-generated and needs replacing */}
          <div className="order-1 lg:order-2">
            {hero.image ? (
              <div className="overflow-hidden rounded-[18px] shadow-pop">
                <img
                  src={hero.image}
                  /**
                   * The hero is the homepage's Largest Contentful Paint element — the image
                   * that decides when the store LOOKS loaded. The full file is 1536px and
                   * 229 KB, going to phones that show it 390 CSS pixels across.
                   *
                   * The sized variants come from server/scripts/resize-hero.mjs. `srcset` is
                   * built from the base filename rather than configured, so a hero swapped in
                   * Settings still works — it just gets no variants until the script is run
                   * for it, which is the safe way round.
                   */
                  srcSet={/\.webp$/.test(hero.image)
                    ? [780, 1200].map((w) => `${hero.image.replace(/\.webp$/, `-${w}.webp`)} ${w}w`).join(", ") + `, ${hero.image} 1536w`
                    : undefined}
                  // On phones the image is the full content width; from lg it shares the row.
                  sizes="(max-width: 1023px) 100vw, 50vw"
                  alt=""
                  loading="eager"
                  // The homepage's Largest Contentful Paint element. Without an explicit
                  // priority the browser finds it only once the CSS resolves and it queues
                  // behind the bundle; width/height reserve its box so nothing shifts.
                  fetchPriority="high"
                  decoding="sync"
                  width={860}
                  height={640}
                  className="h-[240px] w-full object-cover object-center sm:h-[340px] lg:h-[430px]"
                />
              </div>
            ) : (
              <div className="grid h-[240px] w-full place-items-center rounded-[18px] border border-dashed border-plum/25 bg-surface/60 sm:h-[340px] lg:h-[430px]">
                <TulipMark className="h-16 w-16 text-plum/30" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------------- TRUST STRIP ----------------
          Settings-driven (`trustItems`, one "Headline | supporting text" per line) so a claim
          that turns out to be unsupportable can be removed without a deploy. The old hardcoded
          copy promised "fast, tracked dispatch" — there is no tracking system, only a status
          timeline updated by hand — and "100% authentic", which nothing in the data evidences. */}
      {trust.length > 0 && (
        <section className="wrap mt-4" aria-label="What to expect">
          {/*
            The column count follows the ITEM count, and an odd last item spans the row.

            This was a fixed `grid-cols-2 sm:grid-cols-4` holding three settings-driven items,
            so the third sat alone beside an empty cell — and because the grid draws its
            hairlines with `gap-px` over a `bg-line` background, the empty cell rendered as a
            visible grey box rather than as nothing. Three claims about the shop, one blank
            panel, first thing under the hero.

            The list is editable in Settings and can be two, three or four long, so the fix has
            to hold for any of them rather than for three.
          */}
          <div
            className={`grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line text-center ${
              trust.length >= 4 ? "sm:grid-cols-4" : trust.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"
            }`}
          >
            {trust.map((t, i) => (
              <div
                key={t.title}
                className={`bg-surface px-3 py-4 ${
                  // Only at the two-column width, and only when an odd count would strand it.
                  trust.length % 2 === 1 && i === trust.length - 1 ? "max-sm:col-span-2" : ""
                }`}
              >
                <p className="text-[13px] font-semibold text-ink">{t.title}</p>
                {t.body && <p className="mt-0.5 text-[11px] text-muted">{t.body}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------------- SHOP BY CATEGORY ----------------
          A list, not a card grid — see CategoryList for the whole argument. Sorted by catalogue
          depth here rather than in the component: with no artwork to draw the eye, position is
          the only emphasis a list has, so this is a merchandising decision and it belongs on
          the page that makes it. `sortOrder` still drives the nav, which is a different job. */}
      <section className="wrap mt-14">
        <SectionHead eyebrow="Shop by category" title="Where do you want to glow?" to="/categories" />
        <CategoryList
          categories={[...categories]
            .sort((a, b) => (b._count?.products ?? 0) - (a._count?.products ?? 0))
            .map((c) => ({ slug: c.slug, name: c.name, tint: c.tint, count: c._count?.products }))}
        />
      </section>

      {loading && <div className="wrap mt-14 grid place-items-center py-10 text-plum"><Spinner /></div>}

      {/* The hero and the category grid come from /api/site and survive this failing; the
          collections below do not. Saying so beats a homepage that silently ends early. */}
      {error && (
        <div className="wrap mt-14">
          <ErrorState title="We couldn’t load this week’s picks" detail={error} onRetry={reload} compact />
        </div>
      )}

      {/*
        Optional chaining on the ARRAY, not only on `data`.

        `data?.reviews.length` guards `data` being null and does nothing about `reviews` being
        absent, so a /api/home response missing one field threw through React and white-screened
        the whole homepage — stack trace and all, at every viewport. Found by screenshotting
        home against a payload that omitted `reviews`.

        The server sends all three today, so this is not a live bug; it is a blast radius. One
        missing field should hide one section. This codebase already decided that a failed
        request must not render "Nothing here yet" — a blank page with a stack trace on it is
        worse than either.
      */}
      {/* ---------------- OUR PICKS / BEST SELLERS ----------------
        Every word here comes from the server. It used to read "Best sellers" under the eyebrow
        "Loved by everyone", linking to /bestsellers — three claims about what customers had
        bought and felt, all fed by a checkbox in admin that no product has ever carried.

        `picks.mode` flips to "bestsellers" on its own once enough delivered orders exist to
        mean it (see server/src/picks.ts). Nothing here needs to change when it does, which is
        the point: the label cannot drift from the data if the client never holds one.

        Still guarded on length, so an unpicked rail is absent rather than an empty row.
      */}
      {!!data?.picks?.products?.length && (
        <section className="wrap mt-14">
          <SectionHead eyebrow={data.picks.eyebrow ?? ""} title={data.picks.label} to={data.picks.href} />
          <Row items={data.picks.products} />
        </section>
      )}

      {/* ---------------- PROMOTION ----------------
          Entirely server-resolved. `promo` is null unless the title is set, the scope points
          at a real brand/category that actually holds products, and — for the discount line
          — something in that scope is genuinely marked down. There are no local fallbacks
          on purpose: hardcoded copy here is how the store came to advertise deleted brands
          at a discount that did not exist. */}
      {promo && (
        <section className="wrap mt-14">
          <div className="relative overflow-hidden rounded-[22px] bg-plum px-7 py-10 text-white sm:px-12 sm:py-14">
            <TulipMark className="pointer-events-none absolute -right-6 -top-6 h-48 w-48 text-white/10" />
            {promo.discountText && (
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">{promo.discountText}</p>
            )}
            <h2 className="serif mt-2 max-w-lg text-3xl font-medium leading-tight sm:text-4xl">{promo.title}</h2>
            {promo.text && <p className="mt-3 max-w-md text-sm text-white/80">{promo.text}</p>}
            <Link to={promo.href} className="btn btn-cta mt-6 bg-white px-7 py-3.5 text-plum hover:bg-white/90">{promo.ctaLabel}</Link>
          </div>
        </section>
      )}

      {/* ---------------- NEW ARRIVALS ---------------- */}
      {!!data?.newArrivals?.length && (
        <section className="wrap mt-14">
          <SectionHead eyebrow="Just landed" title="New arrivals" to="/new" />
          <Row items={data.newArrivals} />
        </section>
      )}

      {/* ---------------- FEATURED BRANDS ----------------
          Server-resolved: admin-curated order when brands are flagged featured, otherwise by
          catalogue depth with a minimum-products floor. Never insertion order, which is how
          a one-product fashion label ended up in a premium beauty store's featured row. */}
      {!!featured.length && (
        <section className="wrap mt-14">
          <SectionHead eyebrow="Featured" title="Brands we love" to="/brands" />
          {/*
            Same orphan bug as the trust bar, and I fixed that one first without looking for
            the others: a fixed 4-up grid drawn with `gap-px` over `bg-line`, holding however
            many brands admin has curated. With two, the remaining cells rendered as a wide
            grey panel — which on the desktop homepage read as a broken image slot rather than
            as empty space.

            Columns follow the count. Admin curates this list, so it can legitimately hold two.
          */}
          <div
            className={`grid gap-px overflow-hidden rounded-2xl border border-line bg-line ${
              featured.length >= 4 ? "grid-cols-2 sm:grid-cols-4"
                : featured.length === 3 ? "grid-cols-3"
                : featured.length === 2 ? "grid-cols-2"
                : "grid-cols-1"
            }`}
          >
            {featured.map((b) => (
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
      {!!data?.reviews?.length && (
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
