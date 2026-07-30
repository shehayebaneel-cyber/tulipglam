import { useEffect, useRef, useState } from "react";

/**
 * Delay a fast-changing value. Search boxes use this so a keystroke never fires a request
 * or blocks the table — the previous results stay on screen, dimmed, until the new ones land.
 */
export function useDebounced<T>(value: T, ms = 300): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return out;
}

/**
 * "/" focuses the search box, Escape clears and blurs it. Ignored while the operator is
 * already typing in a field, so "/" in a product name still works.
 */
export function useSearchHotkeys(ref: React.RefObject<HTMLInputElement | null>, onClear: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
        return;
      }
      if (e.key === "Escape" && el === ref.current) {
        onClear();
        ref.current?.blur();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref, onClear]);
}

/** Previous value of something, for optimistic rollback. */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;
}
