import { Link } from "react-router-dom";
import { TulipMark } from "./ui";

/**
 * The states where cheap shops look cheap.
 *
 * An empty bag, a search with no matches, a wishlist nobody has filled yet — these are not
 * error conditions and they are not edge cases. They are the first thing a lot of visitors see,
 * because arriving at a shop and searching for something it does not carry is an ordinary way
 * to arrive. Each one used to be a centred serif line and a button, assembled slightly
 * differently on each page.
 *
 * ── THE RULES THIS ENCODES ─────────────────────────────────────────────────────────
 *
 * **Say what is true, not what is wrong.** "Your bag is empty" is a fact about the bag, not a
 * failure by the reader. Nothing here apologises.
 *
 * **Always offer the next step**, and make it the thing a person in that state actually wants:
 * from an empty bag, the way back is the shop; from a search with no results, it is a different
 * search, not the homepage.
 *
 * **The mark, quietly.** A blank screen with one line of text reads as a broken page. The house
 * tulip at low contrast makes the emptiness look composed rather than missing — the same trick
 * the coming-soon page uses, which is the taste this storefront is being brought up to.
 */
export function EmptyState({
  title,
  body,
  action,
  secondary,
  children,
}: {
  title: string;
  body?: string;
  action?: { label: string; to: string };
  secondary?: { label: string; to: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center sm:py-24">
      {/* Decorative: the sentence below carries the meaning, so this is hidden from readers
          who are being read to rather than repeated as "tulip". */}
      <TulipMark className="h-9 w-9 text-plum/25" aria-hidden="true" />
      <h1 className="t-title mt-5 text-ink">{title}</h1>
      {body && <p className="t-body measure mt-2 text-muted">{body}</p>}
      {children}
      {(action || secondary) && (
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          {action && (
            <Link to={action.to} className="btn btn-primary btn-cta px-7 py-3.5">
              {action.label}
            </Link>
          )}
          {secondary && (
            <Link to={secondary.to} className="btn btn-ghost px-6 py-3.5 text-[13px]">
              {secondary.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The grid's own skeleton.
 *
 * A spinner in the middle of a category page tells a reader that something is happening but not
 * what is coming, and the page jumps when the products land. These are the real card shape at
 * the real size, so the layout is already correct before any data arrives and nothing moves
 * when it does.
 *
 * `count` should match the page size the grid is about to request, not a round number.
 */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col">
          {/* Square, matching ProductImage — a skeleton in the wrong aspect ratio reintroduces
              exactly the jump it exists to prevent. */}
          <div className="skeleton aspect-square w-full rounded-2xl" />
          <div className="skeleton mt-3 h-2.5 w-1/3 rounded-full" />
          <div className="skeleton mt-2 h-3 w-4/5 rounded-full" />
          <div className="skeleton mt-2.5 h-4 w-1/4 rounded-full" />
          <div className="skeleton mt-3 h-9 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}
