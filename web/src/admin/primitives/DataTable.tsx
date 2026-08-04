import { useRef } from "react";
import { ChevronDown } from "../../components/ui";

export type SortDir = "asc" | "desc";

export type Column<T> = {
  key: string;
  header: string;
  /** Set to make the header sortable. The value is passed back to onSort for the server. */
  sortKey?: string;
  align?: "left" | "right";
  /** Width / padding classes applied to both the th and the td so they cannot drift apart. */
  cellClass?: string;
  /**
   * Pin this column to the right edge so it survives horizontal scrolling.
   *
   * The products table is wider than most laptop screens. Measured across five viewports, the
   * Edit button sat off-screen at 1100, 1280, 1440 AND 1600 — only visible at 1920 — so on an
   * ordinary laptop the only way to edit a product was to notice a horizontal scrollbar and
   * drag the table sideways. The feature worked; it was unreachable, which is the same thing to
   * whoever is trying to use it.
   *
   * Sticky rather than narrower columns: the data genuinely needs the width, and an action a
   * person takes on every row should not be the thing that scrolls away.
   */
  stickyRight?: boolean;
  /** Hide on narrow screens — the product column always stays. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  cell: (row: T) => React.ReactNode;
  /** Skeleton shown in this cell while loading. Defaults to a short grey bar. */
  skeleton?: React.ReactNode;
};

const HIDE: Record<string, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
};

/**
 * The admin's table. Products is the first consumer; Orders, Customers, Brands and Reviews
 * can take it next.
 *
 * Deliberate choices:
 *  - Sorting is reported upward, never done here. The caller sorts on the server so it
 *    covers the whole result set rather than the 50 rows on screen.
 *  - The header is sticky to the page on lg+. Below that the table scrolls sideways, and a
 *    horizontal scroll container cannot also stick vertically, so the header only sticks
 *    where there is room for it.
 *  - Skeletons occupy the real row height, so nothing jumps when data lands.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  loading = false,
  error = "",
  onRetry,
  emptyTitle = "Nothing here yet",
  emptyBody,
  noResultsTitle = "No matches",
  noResultsBody,
  isFiltered = false,
  onClearFilters,
  sort,
  dir = "desc",
  onSort,
  selectedIds,
  onSelectionChange,
  skeletonRows = 10,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => number;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyBody?: React.ReactNode;
  noResultsTitle?: string;
  noResultsBody?: React.ReactNode;
  isFiltered?: boolean;
  onClearFilters?: () => void;
  sort?: string;
  dir?: SortDir;
  onSort?: (sortKey: string, dir: SortDir) => void;
  selectedIds?: Set<number>;
  onSelectionChange?: (next: Set<number>) => void;
  skeletonRows?: number;
}) {
  const lastClicked = useRef<number | null>(null);
  const selectable = !!selectedIds && !!onSelectionChange;
  const pageIds = rows.map(rowKey);
  const allOnPage = selectable && pageIds.length > 0 && pageIds.every((id) => selectedIds!.has(id));
  const someOnPage = selectable && pageIds.some((id) => selectedIds!.has(id));
  const colCount = columns.length + (selectable ? 1 : 0);

  const toggleAllOnPage = () => {
    if (!selectable) return;
    const next = new Set(selectedIds);
    if (allOnPage) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    onSelectionChange!(next);
  };

  const toggleRow = (index: number, shiftKey: boolean) => {
    if (!selectable) return;
    const next = new Set(selectedIds);
    const id = pageIds[index];
    // Shift+click extends from the previous click, matching every file manager.
    if (shiftKey && lastClicked.current !== null) {
      const [from, to] = [lastClicked.current, index].sort((a, b) => a - b);
      const turnOn = !selectedIds!.has(id);
      for (let i = from; i <= to; i++) {
        if (turnOn) next.add(pageIds[i]);
        else next.delete(pageIds[i]);
      }
    } else {
      if (next.has(id)) next.delete(id); else next.add(id);
    }
    lastClicked.current = index;
    onSelectionChange!(next);
  };

  const headerCell = (c: Column<T>) => {
    // The pinned cell needs its own opaque background, or the scrolling columns show
    // through it. Header and body differ, which is why this is not just a cellClass.
    const sticky = c.stickyRight ? "sticky right-0 z-20 bg-soft shadow-[-8px_0_8px_-8px_rgba(26,26,30,0.12)]" : "";
    const base = `th-label px-3 py-2.5 ${c.align === "right" ? "text-right" : "text-left"} ${sticky} ${c.cellClass ?? ""} ${c.hideBelow ? HIDE[c.hideBelow] : ""}`;
    if (!c.sortKey || !onSort) return <th key={c.key} scope="col" className={base}>{c.header}</th>;

    const isActive = sort === c.sortKey;
    const nextDir: SortDir = isActive && dir === "asc" ? "desc" : "asc";
    return (
      <th
        key={c.key}
        scope="col"
        aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}
        className={`${base} p-0`}
      >
        <button
          type="button"
          onClick={() => onSort(c.sortKey!, nextDir)}
          aria-label={`${c.header}, sort ${nextDir === "asc" ? "ascending" : "descending"}`}
          className={`focus-ring group inline-flex w-full items-center gap-1 px-3 py-2.5 hover:text-ink ${c.align === "right" ? "justify-end" : ""} ${isActive ? "text-plum" : ""}`}
        >
          <span className="th-label" style={isActive ? { color: "inherit" } : undefined}>{c.header}</span>
          {/* the inactive arrow only appears on hover, so eight columns don't all shout at once */}
          <ChevronDown className={`h-3 w-3 shrink-0 transition-all ${isActive ? (dir === "asc" ? "rotate-180" : "") : "opacity-0 group-hover:opacity-45 group-focus-visible:opacity-45"}`} />
        </button>
      </th>
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="overflow-x-auto lg:overflow-x-visible">
        <table className="w-full border-collapse text-left text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 border-b border-line bg-soft/85 backdrop-blur">
            <tr>
              {selectable && (
                <th scope="col" className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allOnPage}
                    ref={(el) => { if (el) el.indeterminate = !allOnPage && someOnPage; }}
                    onChange={toggleAllOnPage}
                    disabled={rows.length === 0}
                    aria-label={allOnPage ? "Clear selection on this page" : "Select all rows on this page"}
                    className="focus-ring h-4 w-4 accent-plum"
                  />
                </th>
              )}
              {columns.map(headerCell)}
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {loading &&
              Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`sk-${i}`} aria-hidden="true">
                  {selectable && <td className="px-3 py-3"><span className="skeleton block h-4 w-4" /></td>}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-3 ${c.stickyRight ? "sticky right-0 z-10 bg-surface" : ""} ${c.cellClass ?? ""} ${c.hideBelow ? HIDE[c.hideBelow] : ""}`}
                    >
                      {c.skeleton ?? <span className="skeleton block h-4 w-full max-w-[9rem]" />}
                    </td>
                  ))}
                </tr>
              ))}

            {!loading && error && (
              <tr>
                <td colSpan={colCount} className="px-4 py-14 text-center">
                  <p className="text-[14px] font-semibold text-ink">Could not load this list</p>
                  <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-strong">{error}</p>
                  {onRetry && <button type="button" onClick={onRetry} className="btn btn-ghost focus-ring mt-4 px-5 py-2.5">Try again</button>}
                </td>
              </tr>
            )}

            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-16 text-center">
                  <p className="serif text-xl text-ink">{isFiltered ? noResultsTitle : emptyTitle}</p>
                  <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted-strong">
                    {isFiltered ? noResultsBody : emptyBody}
                  </p>
                  {isFiltered && onClearFilters && (
                    <button type="button" onClick={onClearFilters} className="btn btn-ghost focus-ring mt-4 px-5 py-2.5">Clear filters</button>
                  )}
                </td>
              </tr>
            )}

            {!loading && !error &&
              rows.map((row, i) => {
                const id = rowKey(row);
                const isSel = selectable && selectedIds!.has(id);
                return (
                  <tr key={id} className={`group transition-colors ${isSel ? "bg-plum-soft/45" : "hover:bg-soft/55"}`}>
                    {selectable && (
                      <td className="px-3 py-3 align-middle">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => { /* click handler carries the shift key */ }}
                          onClick={(e) => toggleRow(i, (e as React.MouseEvent).shiftKey)}
                          aria-label={`Select row ${i + 1}`}
                          className="focus-ring h-4 w-4 accent-plum"
                        />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-3 py-3 align-middle ${c.align === "right" ? "text-right" : ""} ${
                          // A pinned cell needs its own opaque background, or the scrolling
                          // columns show through it — and that background has to follow the
                          // row's state, since selected rows are tinted and hovered rows shade.
                          // A flat white pin would sit on the row like a sticker.
                          c.stickyRight
                            ? `sticky right-0 z-10 shadow-[-8px_0_8px_-8px_rgba(26,26,30,0.12)] ${
                                isSel ? "bg-[#faf1f6]" : "bg-surface group-hover:bg-[#f7f5f8]"
                              }`
                            : ""
                        } ${c.cellClass ?? ""} ${c.hideBelow ? HIDE[c.hideBelow] : ""}`}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
