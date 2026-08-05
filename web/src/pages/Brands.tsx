import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Brand } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { Spinner, SearchIcon, CloseIcon } from "../components/ui";
import { ErrorState } from "../components/ErrorState";

/**
 * Which letter a brand files under.
 *
 * Leading punctuation and articles are stripped first — the same key the server sorts by — so
 * "L'Oréal" files under L and "The Aloelab" under A, matching where a shopper would look.
 * Anything not starting with a Latin letter goes to "#" rather than inventing a section.
 */
function letterOf(name: string): string {
  const c = name.trim().replace(/^(the|a|an)\s+/i, "").replace(/^[^\p{L}\p{N}]+/u, "")[0] ?? "";
  // Strip diacritics so Ürban files under U, not into its own one-brand section.
  const base = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  return /^[A-Z]$/.test(base) ? base : "#";
}

export function Brands() {
  const { data, loading, error, reload } = useFetch(() => api.brands(), []);
  const brands = useMemo(() => data?.brands ?? [], [data]);

  const [term, setTerm] = useState("");
  const t = term.trim().toLowerCase();
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // A letter heading has to clear the site header *and* this page's own sticky search bar.
  // Both are measured rather than guessed: the header height changes between mobile and
  // desktop, and the bar loses its letter strip while searching.
  const barRef = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBarH(el.getBoundingClientRect().height));
    ro.observe(el);
    setBarH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [loading]);
  const anchorOffset = { scrollMarginTop: `calc(var(--header-h) + ${Math.round(barH)}px + 1rem)` };

  // The full list is one 73 KB payload the page already holds, so searching in the browser is
  // instant and a round trip per keystroke would only be slower.
  const matches = useMemo(
    () => (t ? brands.filter((b) => b.name.toLowerCase().includes(t)) : brands),
    [brands, t],
  );

  // Server-sorted, so grouping in order gives sections in order.
  const sections = useMemo(() => {
    const map = new Map<string, Brand[]>();
    for (const b of matches) {
      const l = letterOf(b.name);
      const list = map.get(l);
      if (list) list.push(b); else map.set(l, [b]);
    }
    // "#" last: it is a catch-all, not a letter.
    return [...map.entries()].sort((a, b) => (a[0] === "#" ? 1 : b[0] === "#" ? -1 : a[0] < b[0] ? -1 : 1));
  }, [matches]);

  const present = new Set(sections.map(([l]) => l));
  const alphabet = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

  // `scroll-margin-top` on the sections carries the offset (see index.css), so the browser
  // handles it and the header height is never hardcoded here.
  const jump = (l: string) => sectionRefs.current[l]?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="wrap py-6 sm:py-8">
      <h1 className="serif text-3xl font-medium text-ink sm:text-4xl">Our brands</h1>
      <p className="mt-1 max-w-lg text-sm text-muted">
        {loading ? "The lines we carry, sourced to order and delivered across Lebanon."
          : `${brands.length} brands, sourced to order and delivered across Lebanon.`}
      </p>

      {loading ? (
        <div className="grid place-items-center py-24 text-plum"><Spinner /></div>
      ) : error ? (
        <div className="mt-8"><ErrorState title="We couldn’t load the brand list" detail={error} onRetry={reload} /></div>
      ) : (
        <>
          {/* 405 brands in an unsearchable grid meant scrolling past four hundred cards to
              find one. Search first, then a letter to jump to. */}
          <div ref={barRef} className="under-header sticky z-20 -mx-4 mt-6 bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="relative max-w-sm">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={term} onChange={(e) => setTerm(e.target.value)} type="search" placeholder="Search brands"
                aria-label="Search brands"
                className="focus-ring w-full rounded-full border border-line bg-surface py-2.5 pl-10 pr-9 text-[14px] text-ink outline-none placeholder:text-muted"
              />
              {term && (
                <button onClick={() => setTerm("")} aria-label="Clear search"
                  className="focus-ring absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink">
                  <CloseIcon className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Letters with nothing behind them are shown disabled rather than hidden, so the
                strip keeps a stable shape while typing narrows the list. */}
            {!t && (
              <nav aria-label="Jump to letter" className="scroll-x mt-3 flex gap-0.5">
                {alphabet.map((l) => (
                  <button key={l} onClick={() => jump(l)} disabled={!present.has(l)}
                    className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-ink transition-colors hover:bg-plum-soft hover:text-plum disabled:text-muted/40 disabled:hover:bg-transparent">
                    {l}
                  </button>
                ))}
              </nav>
            )}
          </div>

          {matches.length === 0 ? (
            <div className="mt-8 grid place-items-center rounded-2xl border border-dashed border-line-strong py-16 text-center">
              <div>
                <p className="serif text-2xl text-ink">No brand matches “{term}”</p>
                <p className="mt-2 text-sm text-muted">Try a shorter spelling, or search the whole catalogue instead.</p>
                <Link to={`/search?q=${encodeURIComponent(term)}`} className="btn btn-ink mt-5 px-6 py-2.5">Search products</Link>
              </div>
            </div>
          ) : (
            <>
              {t && <p className="mt-5 text-[13px] text-muted">{matches.length} brand{matches.length === 1 ? "" : "s"} matching “{term}”</p>}
              <div className="mt-4 space-y-8">
                {sections.map(([letter, list]) => (
                  <section key={letter} ref={(el) => { sectionRefs.current[letter] = el; }} style={anchorOffset} aria-labelledby={`brand-letter-${letter}`}>
                    <h2 id={`brand-letter-${letter}`} className="serif border-b border-line pb-2 text-2xl font-medium text-ink">{letter}</h2>
                    {/* Dense rows, not cards. Only 2 of 405 brands have a blurb, so a card
                        layout left a large empty gap on 403 of them. */}
                    <ul className="mt-2 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
                      {list.map((b) => (
                        <li key={b.slug}>
                          {/*
                            `available=0` — the shelf shows temporarily-unavailable stock too.

                            This directory counts a brand's products as active OR unavailable, so
                            five allowlisted brands (Clipp, Cosmaline, Gillette, Hamlet, Tabac)
                            were listed here while every one of their products is out of stock at
                            the supplier. The shop defaults to active-only, so clicking any of
                            them landed on an EMPTY SHELF — the directory promising something the
                            next page denied.

                            Carrying the parameter in the link, rather than defaulting it on the
                            server, keeps the URL honest: the "Include temporarily unavailable"
                            checkbox reads `available=0`, so it shows ticked and the customer can
                            untick it. A hidden server default would have shown unavailable items
                            beside an unticked box — the same class of lie, one layer down.

                            It also makes the number on this row equal the number on the shelf.
                            For a shop that sources per order, "we carry it, currently out, ask
                            us" beats silence — and the Request a Product flow is already there
                            to catch it.
                          */}
                          <Link to={`/shop?brand=${b.slug}&available=0`}
                            className="focus-ring group flex items-baseline justify-between gap-3 rounded-lg border-b border-line/60 py-2.5 pr-1 transition-colors hover:border-plum/40">
                            <span className="min-w-0 flex-1">
                              <span className="cell-truncate block text-[14px] font-medium text-ink group-hover:text-plum">{b.name}</span>
                              {b.blurb && <span className="cell-truncate block text-[11px] text-muted">{b.blurb}</span>}
                            </span>
                            {b.featured && (
                              <span className="shrink-0 rounded-full bg-plum-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-plum">Featured</span>
                            )}
                            {/* The count is the honest signal about a thin brand: "1 product"
                                sets the expectation that hiding it never could. */}
                            <span className="num-tabular shrink-0 text-[12px] text-muted">{b._count?.products ?? 0}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
