import type { StatusMeta } from "../lib/api";

const toneClasses: Record<string, string> = {
  good: "bg-ok/10 text-ok",
  info: "bg-plum-soft text-plum",
  warn: "bg-[#fdf1dd] text-[#8a5f0c]",
  bad: "bg-sale/10 text-sale",
};

/**
 * Order status pill. Tones come from the shared ORDER_STATUSES table so the admin and the
 * customer-facing tracker always agree.
 *
 * Product statuses live in primitives/StatusBadge.tsx — they need an editable variant and
 * their own four-way tone scale.
 */
export function StatusPill({ status, statuses }: { status: string; statuses: StatusMeta[] }) {
  const meta = statuses.find((s) => s.key === status);
  const tone = meta?.tone ?? "info";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${toneClasses[tone] ?? toneClasses.info}`}>
      {meta?.label ?? status}
    </span>
  );
}
