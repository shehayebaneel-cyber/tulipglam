import type { StatusMeta } from "../lib/api";

const toneClasses: Record<string, string> = {
  good: "bg-ok/10 text-ok",
  info: "bg-plum-soft text-plum",
  warn: "bg-[#fdf1dd] text-[#96690f]",
  bad: "bg-sale/10 text-sale",
};

export function StatusPill({ status, statuses }: { status: string; statuses: StatusMeta[] }) {
  const meta = statuses.find((s) => s.key === status);
  const tone = meta?.tone ?? "info";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${toneClasses[tone] ?? toneClasses.info}`}>
      {meta?.label ?? status}
    </span>
  );
}

// Product status → pill
const productTone: Record<string, string> = {
  active: "bg-ok/10 text-ok",
  hidden: "bg-soft text-muted",
  unavailable: "bg-[#fdf1dd] text-[#96690f]",
  discontinued: "bg-sale/10 text-sale",
};
const productLabel: Record<string, string> = {
  active: "Active", hidden: "Hidden", unavailable: "Unavailable", discontinued: "Discontinued",
};
export function ProductStatusPill({ status }: { status: string }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${productTone[status] ?? productTone.active}`}>{productLabel[status] ?? status}</span>;
}
