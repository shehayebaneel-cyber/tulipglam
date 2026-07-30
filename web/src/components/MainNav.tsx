import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { ChevronDown, ChevronRight } from "./ui";
import type { SiteData } from "../lib/api";

type Cat = SiteData["categories"][number];

/**
 * Top-level navigation.
 *
 * The old bar put 15 departments in one row. Several wrapped mid-label — "Bath &/Body",
 * "Sun/Care", "Kids &/Baby" — which read as unfinished, and at 390px it was unusable.
 *
 * Departments are grouped into 6 headings, each opening a panel listing the departments in
 * that group and their children. Group labels never wrap. Everything is derived from the
 * database, so a nav label and a category card can no longer disagree.
 */

/** Which departments sit under which heading. Slugs, so renaming a category can't break it. */
const GROUPS: { label: string; slugs: string[] }[] = [
  { label: "Makeup", slugs: ["makeup", "nails"] },
  { label: "Skincare", slugs: ["skincare", "sun-care"] },
  { label: "Hair", slugs: ["hair"] },
  { label: "Body & Bath", slugs: ["bath-body", "deodorant", "oral-care"] },
  { label: "Fragrance", slugs: ["fragrance"] },
  { label: "More", slugs: ["kids-baby", "wellness", "gift-sets", "accessories"] },
];

export function MainNav({ site }: { site: SiteData | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const cats = site?.categories ?? [];
  const byslug = new Map(cats.map((c) => [c.slug, c]));

  const groups = GROUPS
    .map((g) => ({ label: g.label, cats: g.slugs.map((s) => byslug.get(s)).filter((c): c is Cat => !!c) }))
    .filter((g) => g.cats.length > 0);

  // Anything the grouping missed still gets a home, so adding a department cannot make it
  // silently unreachable.
  const grouped = new Set(GROUPS.flatMap((g) => g.slugs));
  const ungrouped = cats.filter((c) => !grouped.has(c.slug));
  if (ungrouped.length) {
    const more = groups.find((g) => g.label === "More");
    if (more) more.cats.push(...ungrouped);
    else groups.push({ label: "More", cats: ungrouped });
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!navRef.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const showMen = (site?.flags?.menCount ?? 0) > 0;
  const showWomen = (site?.flags?.womenCount ?? 0) > 0;

  return (
    <nav ref={navRef} aria-label="Departments" className="hidden items-center justify-center gap-1 pb-2 lg:flex">
      {groups.map((g) => (
        <GroupMenu key={g.label} label={g.label} cats={g.cats} open={open === g.label} onOpen={() => setOpen(g.label)} onClose={() => setOpen(null)} />
      ))}

      {/* Audience routes suppress themselves until the classifier has been run — an empty
          Men's section is worse than no Men's link, same rule as Sale. */}
      {showMen && <TopLink to="/men">Men</TopLink>}
      {showWomen && <TopLink to="/women">Women</TopLink>}
      <TopLink to="/brands">Brands</TopLink>
      {site?.flags?.hasSale && (
        <NavLink to="/sale" className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-semibold tracking-wide text-sale transition-colors hover:bg-plum-soft ${isActive ? "bg-plum-soft" : ""}`}>Sale</NavLink>
      )}
    </nav>
  );
}

function TopLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium tracking-wide transition-colors hover:bg-plum-soft hover:text-plum ${isActive ? "text-plum" : "text-ink/80"}`}
    >
      {children}
    </NavLink>
  );
}

function GroupMenu({ label, cats, open, onOpen, onClose }: {
  label: string; cats: Cat[]; open: boolean; onOpen: () => void; onClose: () => void;
}) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      className="relative"
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
    >
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="true"
        onClick={() => (open ? onClose() : onOpen())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
        }}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium tracking-wide transition-colors hover:bg-plum-soft hover:text-plum ${open ? "bg-plum-soft text-plum" : "text-ink/80"}`}
      >
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          id={id}
          className="absolute left-1/2 top-full z-50 w-max max-w-[38rem] -translate-x-1/2 pt-1"
        >
          <div className="grid grid-flow-col gap-x-8 gap-y-1 rounded-2xl border border-line bg-surface p-5 shadow-pop" style={{ gridTemplateRows: `repeat(${Math.max(...cats.map((c) => c.children.length + 2), 4)}, min-content)` }}>
            {cats.map((dept) => (
              <div key={dept.slug} className="row-span-full">
                <Link
                  to={`/category/${dept.slug}`}
                  onClick={onClose}
                  className="block whitespace-nowrap text-[13px] font-semibold text-ink hover:text-plum"
                >
                  {dept.name}
                  <span className="ml-1.5 text-[11px] font-normal text-muted">{dept._count.products}</span>
                </Link>
                <ul className="mt-1.5 space-y-0.5">
                  {dept.children.map((child) => (
                    <li key={child.slug}>
                      <Link
                        to={`/category/${child.slug}`}
                        onClick={onClose}
                        className="block whitespace-nowrap py-0.5 text-[12.5px] text-ink/75 hover:text-plum"
                      >
                        {child.name}
                      </Link>
                    </li>
                  ))}
                  {dept.children.length === 0 && (
                    <li>
                      <Link to={`/category/${dept.slug}`} onClick={onClose} className="inline-flex items-center gap-0.5 whitespace-nowrap py-0.5 text-[12.5px] text-plum hover:gap-1">
                        Shop all <ChevronRight className="h-3 w-3" />
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Mobile drawer contents: the same grouping as an accordion. */
export function MobileNav({ site, onNavigate }: { site: SiteData | null; onNavigate: () => void }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const cats = site?.categories ?? [];
  const byslug = new Map(cats.map((c) => [c.slug, c]));

  const groups = GROUPS
    .map((g) => ({ label: g.label, cats: g.slugs.map((s) => byslug.get(s)).filter((c): c is Cat => !!c) }))
    .filter((g) => g.cats.length > 0);
  const grouped = new Set(GROUPS.flatMap((g) => g.slugs));
  const ungrouped = cats.filter((c) => !grouped.has(c.slug));
  if (ungrouped.length) {
    const more = groups.find((g) => g.label === "More");
    if (more) more.cats.push(...ungrouped); else groups.push({ label: "More", cats: ungrouped });
  }

  const row = "flex w-full items-center justify-between rounded-xl px-3 py-3 text-[15px] font-medium text-ink hover:bg-soft";

  return (
    <>
      <Link to="/shop" onClick={onNavigate} className={row}>Shop all</Link>

      {groups.map((g) => {
        const isOpen = openGroup === g.label;
        return (
          <div key={g.label}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenGroup(isOpen ? null : g.label)}
              className={row}
            >
              <span className="whitespace-nowrap">{g.label}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>
            {isOpen && (
              <div className="mb-1 ml-3 border-l border-line pl-3">
                {g.cats.map((dept) => (
                  <div key={dept.slug} className="py-1">
                    <Link to={`/category/${dept.slug}`} onClick={onNavigate} className="block py-1.5 text-[14px] font-semibold text-ink hover:text-plum">
                      {dept.name} <span className="text-[11px] font-normal text-muted">{dept._count.products}</span>
                    </Link>
                    {dept.children.map((child) => (
                      <Link key={child.slug} to={`/category/${child.slug}`} onClick={onNavigate} className="block py-1.5 pl-3 text-[13.5px] text-ink/75 hover:text-plum">
                        {child.name}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <hr className="my-2 border-line" />
      {(site?.flags?.menCount ?? 0) > 0 && <Link to="/men" onClick={onNavigate} className={row}>Men</Link>}
      {(site?.flags?.womenCount ?? 0) > 0 && <Link to="/women" onClick={onNavigate} className={row}>Women</Link>}
      {([
        ["/new", "New Arrivals"],
        ["/bestsellers", "Best Sellers"],
        ...(site?.flags?.hasSale ? [["/sale", "Sale"]] : []),
        ["/brands", "Brands"],
        ["/gift-cards", "Gift Cards"],
        ["/track", "Order Tracking"],
        ["/contact", "Contact"],
      ] as [string, string][]).map(([to, label]) => (
        <Link key={to} to={to} onClick={onNavigate} className={row}>{label}</Link>
      ))}
    </>
  );
}
