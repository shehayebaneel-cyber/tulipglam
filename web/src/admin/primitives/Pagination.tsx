import { Combobox } from "./Combobox";

const PAGE_SIZES = [25, 50, 100, 200];

/**
 * "Showing 51–100 of 9,672" plus page numbers, first/last jumps and rows-per-page.
 * 194 pages is too many to list, so the strip shows the ends and a window around the
 * current page.
 */
export function Pagination({
  page,
  pages,
  total,
  pageSize,
  onPage,
  onPageSize,
  label,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (n: number) => void;
  onPageSize: (n: number) => void;
  label: string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const window: number[] = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) window.push(i);
  if (window[0] > 1) window.unshift(1);
  if (window[window.length - 1] < pages) window.push(pages);

  const btn = "focus-ring grid h-8 min-w-8 place-items-center rounded-lg px-2.5 text-[12.5px] font-medium transition-colors";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2.5">
      <p className="text-[12.5px] text-muted-strong">
        Showing <span className="num-tabular font-semibold text-ink">{from.toLocaleString()}–{to.toLocaleString()}</span> of{" "}
        <span className="num-tabular font-semibold text-ink">{total.toLocaleString()}</span> {label}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <label htmlFor="rows-per-page" className="th-label">Rows</label>
          <Combobox
            value={String(pageSize)}
            onChange={(v) => onPageSize(Number(v))}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            ariaLabel="Rows per page"
            className="w-[5.25rem]"
          />
        </div>

        {pages > 1 && (
          <nav aria-label="Pagination" className="flex items-center gap-1">
            <button type="button" onClick={() => onPage(1)} disabled={page <= 1} aria-label="First page" className={`${btn} border border-line text-ink disabled:opacity-35`}>«</button>
            <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page" className={`${btn} border border-line text-ink disabled:opacity-35`}>‹</button>
            {window.map((n, i) => (
              <span key={n} className="flex items-center gap-1">
                {i > 0 && n - window[i - 1] > 1 && <span className="px-0.5 text-muted-strong">…</span>}
                <button
                  type="button"
                  onClick={() => onPage(n)}
                  aria-label={`Page ${n}`}
                  aria-current={n === page ? "page" : undefined}
                  className={`${btn} num-tabular ${n === page ? "bg-plum text-white" : "border border-line text-ink hover:border-ink"}`}
                >
                  {n}
                </button>
              </span>
            ))}
            <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page" className={`${btn} border border-line text-ink disabled:opacity-35`}>›</button>
            <button type="button" onClick={() => onPage(pages)} disabled={page >= pages} aria-label="Last page" className={`${btn} border border-line text-ink disabled:opacity-35`}>»</button>
          </nav>
        )}
      </div>
    </div>
  );
}
