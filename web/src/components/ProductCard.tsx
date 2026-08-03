import { Link } from "react-router-dom";
import { usd, priceOf, type Card } from "../lib/api";
import { nameWithoutBrand } from "../lib/productName";
import { useStore, lineFromCard } from "../lib/store";
import { ProductImage } from "./ProductImage";
import { HeartIcon, HeartFill } from "./ui";

export function ProductCard({ p }: { p: Card }) {
  const { addToCart, toggleWish, inWish } = useStore();
  // The photo-failed fallback moved into ProductImage, which owns it for every surface —
  // a corrupt source shows the house glyph in the cart and on the order page too, not only here.
  const off = p.onSale && p.saleCents != null ? Math.round((1 - p.saleCents / p.priceCents) * 100) : 0;
  const wished = inWish(p.slug);
  // Not orderable. Named for the status rather than "sold out" — nothing here is stocked,
  // so it is an availability answer, not a quantity.
  const soldOut = p.status === "unavailable" || p.status === "discontinued";
  const hasVariants = false; // cards add the base product; variant choice happens on the product page

  return (
    <Link to={`/product/${p.slug}`} className="group flex h-full flex-col">
      {/*
        The shelf.

        `ProductImage` reserves a square box before the photo arrives and serves the 400/600
        WebP derivative rather than the source PNG — the sources average 84 KB each and the
        card derivatives are a fraction of that, which on a category page is the difference
        between a grid that fills and a grid that trickles.

        Square rather than 4:5 because the catalogue measured 98.2% square: a 4:5 bed
        letterboxed almost every product with dead space above and below, making the goods
        look smaller than the tile they were sitting in.

        `sizes` describes the real layout — two columns with the page gutter and the gap
        removed — so a phone requests the 1x file and only a dense screen pays for 2x.
      */}
      <div className="relative overflow-hidden rounded-2xl">
        <ProductImage
          url={p.image}
          alt={`${p.brand?.name ? `${p.brand.name} ` : ""}${p.name}`}
          glyph={p.glyph}
          slot="card"
          srcSet
          sizes="(min-width: 1024px) 220px, (min-width: 640px) 30vw, 45vw"
          imgClassName="transition-transform duration-300 group-hover:scale-[1.04]"
        />
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
        {/* The brand is already the line above, and 92.3% of names repeat it — see lib/productName.
            The full stored name stays in the title attribute and in the image alt text. */}
        <h3 title={p.name} className="mt-0.5 line-clamp-2 text-[14px] font-medium leading-snug text-ink">{nameWithoutBrand(p.name, p.brand?.name)}</h3>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="serif text-[17px] font-medium text-ink tabular">{usd(priceOf(p))}</span>
          {p.onSale && <span className="serif text-[13px] text-muted line-through tabular">{usd(p.priceCents)}</span>}
        </div>
        {/*
          `mt-auto` pushes the button to the bottom of the card.

          Product names are one line or two depending on the product, so in a row of four the
          buttons sat at four different heights — the shelf read as uneven even though every
          tile was identical, which is the same complaint the square image bed was fixing one
          level up. The image aligns the tops; this aligns the bottoms.
        */}
        <button
          type="button"
          disabled={soldOut}
          onClick={(e) => { e.preventDefault(); if (!hasVariants) addToCart(lineFromCard(p)); }}
          className="btn btn-ghost mt-auto w-full py-2.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {soldOut ? "Unavailable" : "Add to bag"}
        </button>
      </div>
    </Link>
  );
}
