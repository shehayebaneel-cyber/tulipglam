import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckIcon, CloseIcon } from "../../components/ui";

type Tone = "ok" | "error";
type Toast = { id: number; tone: Tone; text: string };

const ToastCtx = createContext<{ push: (tone: Tone, text: string) => void }>({ push: () => {} });

/** Feedback for optimistic actions — every bulk edit and inline status change reports here. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((tone: Tone, text: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((a) => [...a, { id, tone, text }]);
    // errors linger — the operator needs time to read what failed and why
    window.setTimeout(() => setItems((a) => a.filter((t) => t.id !== id)), tone === "error" ? 7000 : 3200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/* polite: announced without interrupting whatever the operator is typing */}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] shadow-pop ${
              t.tone === "ok" ? "border-ok/25 bg-surface text-ink" : "border-sale/30 bg-surface text-ink"
            }`}
          >
            <span className={`mt-0.5 shrink-0 ${t.tone === "ok" ? "text-ok" : "text-sale"}`}>
              {t.tone === "ok" ? <CheckIcon className="h-4 w-4" /> : <CloseIcon className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">{t.text}</span>
            <button
              type="button"
              onClick={() => setItems((a) => a.filter((x) => x.id !== t.id))}
              aria-label="Dismiss"
              className="focus-ring shrink-0 text-muted-strong hover:text-ink"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
