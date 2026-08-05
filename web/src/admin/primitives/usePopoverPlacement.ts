import { useLayoutEffect, useRef, useState } from "react";

/**
 * Open downward, unless there isn't room — then open upward, and only take the height that exists.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────
 *
 * Every popover in admin was `absolute mt-1` — always below its trigger, always as tall as its
 * content wanted. The bulk action bar in the product list is `fixed bottom-4`, so all four of its
 * comboboxes had roughly sixteen pixels of space underneath: their menus rendered off the bottom
 * of the screen and behind the taskbar. From the operator's side that reads as *"the dropdown
 * does not open"*, which is exactly how it was reported.
 *
 * The per-row status chips had the same defect for any row near the bottom of a long table — a
 * different component, identical shape, found by looking for it after fixing the first one.
 *
 * ── WHY A HOOK RATHER THAN THE SAME TEN LINES TWICE ────────────────────────────────
 *
 * Two copies of a measurement is two things to keep in step, and this codebase has already paid
 * for that once — `rules.ts` and `ledger.ts` each computed expiry, stayed self-consistent, and
 * drifted. One implementation, two callers.
 *
 * ── IT MEASURES, IT DOES NOT ASSUME ────────────────────────────────────────────────
 *
 * A rule like "flip up inside the bulk bar" would fix the reported case and leave every other
 * popover to hit the same wall at the bottom of a scrolled page. This asks the viewport instead,
 * and flips only when below is genuinely too small AND above is actually better — so a short
 * menu near the bottom does not flip for no reason.
 *
 * Re-measured on scroll and resize while open, because the trigger moves under it. Scroll is
 * captured, since the scrolling element is usually an ancestor rather than the window.
 */

/** Space the menu would like, before it starts scrolling internally. */
const WANTED = 220;
/** Never squash a menu below this — a two-line list is worse than a scrollbar. */
const MIN_HEIGHT = 140;
/** Nor stretch one past this, however much room there is. */
const MAX_HEIGHT = 320;
/** Breathing room from the viewport edge. */
const GAP = 12;

export type Placement = { dir: "up" | "down"; maxH: number };

export function usePopoverPlacement(open: boolean) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [place, setPlace] = useState<Placement>({ dir: "down", maxH: MAX_HEIGHT });

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - GAP;
      const above = r.top - GAP;
      const dir = below < WANTED && above > below ? "up" : "down";
      setPlace({ dir, maxH: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, dir === "up" ? above : below)) });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  /** Tailwind classes placing the panel relative to its trigger. */
  const posClass = place.dir === "up" ? "bottom-full mb-1" : "top-full mt-1";

  return { anchorRef, place, posClass };
}
