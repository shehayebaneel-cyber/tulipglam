import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDown } from "../../components/ui";

/**
 * All four product statuses are first-class. `unavailable` is not an error state — in a
 * source-to-order business it is a normal, temporary answer, so it reads as a caution
 * rather than a failure. `discontinued` is the only one that gets the sale red, because it
 * is the only permanent one.
 */
export const PRODUCT_STATUSES = [
  { value: "active", label: "Active", help: "On the storefront and orderable." },
  { value: "unavailable", label: "Unavailable", help: "Visible but not orderable — shown as temporarily unavailable." },
  { value: "hidden", label: "Hidden", help: "Not on the storefront at all. Reachable only here." },
  { value: "discontinued", label: "Discontinued", help: "Gone for good. Hidden from the storefront." },
] as const;

const TONE: Record<string, string> = {
  active: "bg-ok/12 text-ok ring-ok/25",
  unavailable: "bg-[#fdf1dd] text-[#8a5f0c] ring-[#e5c890]",
  hidden: "bg-soft text-muted-strong ring-line-strong",
  discontinued: "bg-sale/10 text-sale ring-sale/25",
};

export const statusLabel = (v: string) => PRODUCT_STATUSES.find((s) => s.value === v)?.label ?? v;

/** Read-only pill. */
export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE[status] ?? TONE.hidden} ${className}`}>
      {statusLabel(status)}
    </span>
  );
}

/**
 * The same pill, but it opens a small menu on click. A permanent <select> in all 200 rows
 * was visual noise and made the table hard to scan; this stays a badge until you use it.
 */
export function StatusBadgeEditable({
  status,
  onChange,
  busy = false,
  name,
}: {
  status: string;
  onChange: (next: string) => void;
  busy?: boolean;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status of ${name}: ${statusLabel(status)}. Change status.`}
        className={`focus-ring inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset transition-opacity hover:opacity-80 disabled:opacity-50 ${TONE[status] ?? TONE.hidden}`}
      >
        {statusLabel(status)}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div role="menu" aria-label={`Set status for ${name}`} className="absolute left-0 z-40 mt-1 w-60 overflow-hidden rounded-xl border border-line-strong bg-surface py-1 shadow-pop">
          {PRODUCT_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); if (s.value !== status) onChange(s.value); }}
              className="focus-ring flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-plum-soft"
            >
              <span className="mt-0.5 h-4 w-4 shrink-0 text-plum">{s.value === status && <CheckIcon className="h-4 w-4" />}</span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink">{s.label}</span>
                <span className="block text-[11px] leading-snug text-muted-strong">{s.help}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
