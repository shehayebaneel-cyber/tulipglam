import { CloseIcon } from "../../components/ui";

export type Chip = { key: string; label: string; value: string; onClear: () => void };

/**
 * Active filters, each individually dismissable. Without these it is impossible to tell why
 * a 9,672-product list is showing 12 rows.
 */
export function FilterChips({ chips, onClearAll }: { chips: Chip[]; onClearAll: () => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="th-label mr-0.5">Filtered by</span>
      {chips.map((c) => (
        <span key={c.key} className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-plum/25 bg-plum-soft py-1 pl-2.5 pr-1 text-[12px] text-plum">
          <span className="cell-truncate">
            <span className="opacity-70">{c.label}:</span> <span className="font-semibold">{c.value}</span>
          </span>
          <button
            type="button"
            onClick={c.onClear}
            aria-label={`Remove ${c.label} filter`}
            className="focus-ring grid h-4 w-4 shrink-0 place-items-center rounded-full hover:bg-plum/15"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={onClearAll} className="focus-ring rounded-full px-2 py-1 text-[12px] font-semibold text-muted-strong underline-offset-2 hover:text-ink hover:underline">
          Clear all
        </button>
      )}
    </div>
  );
}

/** Row of filter controls. Wraps on narrow screens rather than scrolling sideways. */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}
