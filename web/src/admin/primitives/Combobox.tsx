import { useEffect, useId, useMemo, useRef, useState } from "react";
import { usePopoverPlacement } from "./usePopoverPlacement";
import { ChevronDown, CheckIcon, SearchIcon, CloseIcon } from "../../components/ui";

export type Option = { value: string; label: string; hint?: string; depth?: number };

/**
 * The admin's single dropdown. Replaces every native <select> — the OS-rendered option
 * list could not be styled and looked foreign against Blanc Tulipe.
 *
 * One component, two modes: pass `searchable` for large sets (405 brands) and leave it off
 * for short ones. Written as a proper listbox rather than a styled <select> so the popup is
 * ours, while keeping the keyboard contract people expect from a select:
 *   Enter / Space / ArrowDown / ArrowUp  open
 *   ArrowUp / ArrowDown                  move the active option
 *   Home / End                           first / last
 *   Enter                                choose the active option
 *   Escape                               close without changing anything
 *   Tab                                  close and move on
 *   a-z (unsearchable mode)              jump to the next option starting with that letter
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchable = false,
  searchPlaceholder = "Search…",
  ariaLabel,
  className = "",
  buttonClassName = "",
  disabled = false,
  maxRendered = 300,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  ariaLabel: string;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
  maxRendered?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ buffer: "", at: 0 });
  const listId = useId();

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options.slice(0, maxRendered);
    const q = query.trim().toLowerCase();
    // startsWith first, then contains — typing "cla" should surface Clarins before Estée
    const starts: Option[] = [];
    const has: Option[] = [];
    for (const o of options) {
      const l = o.label.toLowerCase();
      if (l.startsWith(q)) starts.push(o);
      else if (l.includes(q)) has.push(o);
    }
    return [...starts, ...has].slice(0, maxRendered);
  }, [options, query, searchable, maxRendered]);

  // 405 brands is too many to paint at once; say so rather than silently truncating.
  const truncated = filtered.length >= maxRendered && options.length > maxRendered;

  // Open with the current selection active so arrow keys start from the right place.
  useEffect(() => {
    if (!open) return;
    const i = filtered.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : 0);
    if (searchable) searchRef.current?.focus();
    else listRef.current?.focus();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opens upward when there is no room below — see usePopoverPlacement for why, and for the
  // bulk action bar that made it necessary.
  const { anchorRef, place, posClass } = usePopoverPlacement(open);

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) buttonRef.current?.focus();
  };

  const pick = (i: number) => {
    const o = filtered[i];
    if (!o) return;
    onChange(o.value);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") { close(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }
    if (e.key === "Home") { e.preventDefault(); setActive(0); return; }
    if (e.key === "End") { e.preventDefault(); setActive(filtered.length - 1); return; }
    if (e.key === "Enter") { e.preventDefault(); pick(active); return; }

    // type-ahead only matters when there is no search box to type into
    if (!searchable && e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      const t = typeahead.current;
      t.buffer = now - t.at < 600 ? t.buffer + e.key.toLowerCase() : e.key.toLowerCase();
      t.at = now;
      const i = filtered.findIndex((o) => o.label.toLowerCase().startsWith(t.buffer));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={(el) => { buttonRef.current = el; anchorRef.current = el; }}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={`focus-ring flex w-full items-center justify-between gap-2 rounded-xl border border-line-strong bg-surface px-3 py-2 text-left text-[13px] text-ink transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50 ${buttonClassName}`}
      >
        <span className={`cell-truncate ${selected ? "" : "text-muted-strong"}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-strong transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className={`absolute z-50 w-full min-w-[13rem] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-pop ${posClass}`}>
          {searchable && (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <SearchIcon className="h-4 w-4 shrink-0 text-muted-strong" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                aria-label={`${ariaLabel} — search`}
                aria-controls={listId}
                className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-muted-strong"
              />
              {query && (
                <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} aria-label="Clear search" className="focus-ring shrink-0 text-muted-strong hover:text-ink">
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={searchable ? -1 : 0}
            onKeyDown={searchable ? undefined : onKeyDown}
            aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
            // Height comes from the measured space, not a fixed max-h-64 — a menu that fits the
            // gap is scrollable; one that overflows it is invisible.
            style={{ maxHeight: place.maxH - (searchable ? 44 : 0) }}
            className="overflow-y-auto py-1 outline-none"
          >
            {filtered.length === 0 && <li className="px-3 py-3 text-[13px] text-muted-strong">No matches.</li>}
            {filtered.map((o, i) => {
              const isSel = o.value === value;
              return (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] ${i === active ? "bg-plum-soft text-plum" : "text-ink"}`}
                  style={o.depth ? { paddingLeft: `${0.75 + o.depth * 0.85}rem` } : undefined}
                >
                  <span className="min-w-0 flex-1 cell-truncate">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-[11px] text-muted-strong num-tabular">{o.hint}</span>}
                  {isSel && <CheckIcon className="h-4 w-4 shrink-0 text-plum" />}
                </li>
              );
            })}
            {truncated && (
              <li className="border-t border-line px-3 py-2 text-[11px] text-muted-strong">
                Showing the first {maxRendered} of {options.length}. {searchable ? "Keep typing to narrow it down." : ""}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
