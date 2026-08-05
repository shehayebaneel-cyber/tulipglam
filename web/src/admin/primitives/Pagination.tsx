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

  /**
   * Two windows: ±2 pages with room, ±1 on a phone.
   *
   * Raising the buttons to 44px for thumbs immediately pushed this pager to 429px inside a 390px
   * screen — a fix for one accessibility problem that created a worse usability one. Seven
   * 44px buttons do not fit, so the phone shows five and the desktop keeps all seven. Rendering
   * both and hiding one with CSS keeps it a pure layout decision, with no viewport guess in JS.
   */
  const windowOf = (span: number) => {
    const w: number[] = [];
    for (let i = Math.max(1, page - span); i <= Math.min(pages, page + span); i++) w.push(i);
    if (w[0] > 1) w.unshift(1);
    if (w[w.length - 1] < pages) w.push(pages);
    return w;
  };
  const window = windowOf(2);
  const windowPhone = windowOf(1);

  // 44px on a phone, 32px from `sm:` up. Paging is a thumb action on a list of 194 pages, and
  // 32px is below every touch guideline there is. Flagged by the admin-phone work as a primitive
  // no call site could fix.
  const btn = "focus-ring grid h-11 min-w-11 place-items-center rounded-lg px-2.5 text-[12.5px] font-medium transition-colors sm:h-8 sm:min-w-8";

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
            {[
              { list: windowPhone, cls: "sm:hidden" },
              { list: window, cls: "hidden sm:flex" },
            ].map(({ list, cls }) => (
              <span key={cls} className={`items-center gap-1 ${cls === "sm:hidden" ? "flex sm:hidden" : cls}`}>
                {list.map((n, i) => (
                  <span key={n} className="flex items-center gap-1">
                    {i > 0 && n - list[i - 1] > 1 && <span className="px-0.5 text-muted-strong">…</span>}
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
