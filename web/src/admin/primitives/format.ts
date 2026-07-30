/**
 * Money in table cells. The storefront's usd() drops ".00" so a column reads
 * "$68" next to "$18.78" and the decimal points do not line up. Admin tables always show
 * two decimals; pair with `.num-tabular` and right alignment.
 */
export const money = (cents: number) => "$" + (cents / 100).toFixed(2);

/** "3 days ago" / "in 2 hours" — short relative time for last-updated and waiting-since. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const secs = Math.round((now - then) / 1000);
  const abs = Math.abs(secs);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"], [3600, "minute"], [86400, "hour"], [604800, "day"], [2629800, "week"], [31557600, "month"],
  ];
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
  if (abs < 45) return "just now";
  for (const [limit, unit] of units) {
    if (abs < limit) {
      const div = unit === "second" ? 1 : unit === "minute" ? 60 : unit === "hour" ? 3600 : unit === "day" ? 86400 : unit === "week" ? 604800 : 2629800;
      return fmt.format(-Math.round(secs / div), unit);
    }
  }
  return fmt.format(-Math.round(secs / 31557600), "year");
}

/** Whole hours/days a thing has been waiting — used by the awaiting_customer panel. */
export function waitedFor(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}
