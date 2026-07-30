import { useEffect, useId, useRef } from "react";
import { CloseIcon } from "../../components/ui";

/**
 * Modal for anything irreversible. Traps focus, closes on Escape and on backdrop click,
 * and returns focus to whatever opened it. Destructive confirms are red; everything else
 * uses ink, so the colour itself signals the stakes.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
  busy = false,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  busy?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
      if (e.key !== "Tab") return;
      // cycle focus inside the panel
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes?.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      restoreTo.current?.focus?.();
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center px-4">
      <div className="absolute inset-0 bg-ink/45" onClick={onCancel} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-pop"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="serif text-lg font-medium text-ink">{title}</h2>
          <button type="button" onClick={onCancel} aria-label="Close" className="focus-ring -mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-strong hover:bg-soft hover:text-ink">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2.5 space-y-2 text-[13px] leading-relaxed text-ink/80">{children}</div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost focus-ring px-5 py-2.5">Cancel</button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`btn focus-ring px-5 py-2.5 text-white ${destructive ? "bg-sale hover:brightness-95" : "btn-ink"}`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
