import { useState } from "react";
import { Link } from "react-router-dom";
import { usd, priceOf, type Card } from "../lib/api";
import { useStore, lineFromCard } from "../lib/store";
import { ProductGlyph } from "./ProductGlyph";
import { HeartIcon, HeartFill } from "./ui";

export function ProductCard({ p }: { p: Card }) {
  const { addToCart, toggleWish, inWish } = useStore();
  // If the photo 404s or fails to decode, fall back to the line-art glyph rather than
  // leaving the browser to render raw alt text over the tint.
  const [imgFailed, setImgFailed] = useState(false);
  const off = p.onSale && p.saleCents != null ? Math.round((1 - p.saleCents / p.priceCents) * 100) : 0;
  const wished = inWish(p.slug);
  // Not orderable. Named for the status rather than "sold out" — nothing here is stocked,
  // so it is an availability answer, not a quantity.
  const soldOut = p.status === "unavailable" || p.status === "discontinued";
  const hasVariants = false; // cards add the base product; variant choice happens on the product page

  return (
    <Link to={`/product/${p.slug}`} className="group flex flex-col">
      {/* image bed */}
      {/* Neutral bed and `object-contain` with padding: supplier photos arrive at wildly
          different shapes — a wide Babyliss airbrush next to a tall narrow bottle — and
          `object-cover` cropped some to fill while others floated tiny. Containing every
          image in an identical frame makes the grid read as one shelf. */}
      <div className="relative overflow-hidden rounded-2xl bg-soft">
        <div className="aspect-[4/5] w-full p-3">
          {p.image && !imgFailed ? (
            <img
              src={p.image}
              alt={`${p.brand?.name ? `${p.brand.name} ` : ""}${p.name}`}
              loading="lazy"
              decoding="async"
              onError={() => setImgFailed(true)}
              className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.04]"
            />
          ) : (
            <ProductGlyph kind={p.glyph} className="h-full w-full p-8 text-plum/45 transition-transform duration-300 group-hover:scale-[1.04]" />
          )}
        </div>
        {/* badges */}
        <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1">
          {off > 0 && <span className="rounded-full bg-sale px-2 py-0.5 text-[10px] font-bold tracking-wide text-white">-{off}%</span>}
          {p.isNew && off === 0 && <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-paper">New</span>}
          {p.isBestSeller && off === 0 && !p.isNew && <span className="rounded-full bg-plum px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white">Bestseller</span>}
        </div>
        {/* Was a heavy dark bar across the whole image with text long enough to look clipped.
            Now a compact badge in the same corner language as the other flags. Discontinued
            gets its own treatment — it is permanent, not a "check back later". */}
        {p.status === "unavailable" && (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warn ring-1 ring-inset ring-warn-line">
            Unavailable
          </span>
        )}
        {p.status === "discontinued" && (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted ring-1 ring-inset ring-line-strong">
            Discontinued
          </span>
        )}
        {/* wishlist */}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); toggleWish(p); }}
          aria-label={wished ? "Remove from wishlist" : "Add to wishlist"}
          aria-pressed={wished}
          className="absolute right-2.5 top-2.5 grid h-9 w-9 place-items-center rounded-full bg-surface/85 text-ink backdrop-blur transition-colors hover:text-plum"
        >
          {wished ? <HeartFill className="h-[18px] w-[18px] text-plum" /> : <HeartIcon className="h-[18px] w-[18px]" />}
        </button>
      </div>

      {/* info */}
      <div className="mt-3 flex flex-1 flex-col">
        {p.brand && <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{p.brand.name}</span>}
        <h3 className="mt-0.5 line-clamp-2 text-[14px] font-medium leading-snug text-ink">{p.name}</h3>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="serif text-[17px] font-medium text-ink tabular">{usd(priceOf(p))}</span>
          {p.onSale && <span className="serif text-[13px] text-muted line-through tabular">{usd(p.priceCents)}</span>}
        </div>
        <button
          type="button"
          disabled={soldOut}
          onClick={(e) => { e.preventDefault(); if (!hasVariants) addToCart(lineFromCard(p)); }}
          className="btn btn-ghost mt-3 w-full py-2.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {soldOut ? "Unavailable" : "Add to bag"}
        </button>
      </div>
    </Link>
  );
}
