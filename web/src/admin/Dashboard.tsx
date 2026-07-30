import { Link } from "react-router-dom";
import { adminApi, type SetupCheck } from "./adminApi";
import { useFetch } from "../lib/hooks";
import { useStore } from "../lib/store";
import { Spinner, AlertIcon, ArrowRight, CheckIcon } from "../components/ui";
import { StatusPill } from "./ui";
import { money, relativeTime } from "./primitives/format";

export function Dashboard() {
  const { data, loading } = useFetch(() => adminApi.summary(), []);
  const setup = useFetch(() => adminApi.setup(), []);
  const health = useFetch(() => adminApi.catalogueHealth(), []);
  const { site } = useStore();
  const statuses = site?.statuses ?? [];

  if (loading || !data) return <div className="grid place-items-center py-24 text-plum"><Spinner /></div>;

  const noOrdersYet = data.orders === 0;
  const open = statuses
    .filter((s) => !["delivered", "completed", "cancelled", "unavailable"].includes(s.key))
    .map((s) => ({ ...s, count: data.byStatus[s.key] ?? 0 }))
    .filter((s) => s.count > 0);

  return (
    <div>
      <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-strong">
        {noOrdersYet ? "No orders yet — here is what to finish before you promote the store." : "A quick look at your store."}
      </p>

      {setup.data && setup.data.checks.length > 0 && <SetupBanner checks={setup.data.checks} />}

      {/* ---------------- stats ---------------- */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Orders" value={data.orders.toLocaleString()} />
        <Stat label="Revenue (est.)" value={money(data.revenueCents)} />
        <Stat label="Active products" value={`${data.active.toLocaleString()} / ${data.products.toLocaleString()}`} />
        <Stat label="Reviews to approve" value={String(data.pendingReviews)} to={data.pendingReviews ? "/admin/reviews" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* ---------------- catalogue health ---------------- */}
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Catalogue health</h2>
            <Link to="/admin/products" className="focus-ring text-[13px] font-semibold text-plum hover:underline">All products</Link>
          </div>

          {!health.data ? (
            <div className="mt-4 space-y-2" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <span key={i} className="skeleton block h-7 w-full" />)}
            </div>
          ) : health.data.issues.every((i) => i.count === 0) ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink/80">
              <CheckIcon className="h-4 w-4 text-ok" /> Every visible product has an image, a brand and a price.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {health.data.issues.filter((i) => i.count > 0).map((i) => (
                <li key={i.key}>
                  <Link
                    to={`/admin/products${i.filter ? `?${i.filter}` : ""}`}
                    className="focus-ring group flex items-center justify-between gap-3 py-2.5 text-[13px]"
                  >
                    <span className="text-ink/85 group-hover:text-plum">{i.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="num-tabular rounded-full bg-soft px-2 py-0.5 text-[12px] font-semibold text-ink">{i.count.toLocaleString()}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-strong group-hover:text-plum" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* recent imports, derived from where each product came from */}
          {health.data && health.data.imports.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="th-label">Where the catalogue came from</h3>
              <ul className="mt-2 space-y-1.5">
                {health.data.imports.map((s) => (
                  <li key={s.source} className="flex items-center justify-between gap-3 text-[13px]">
                    <Link to={`/admin/products?source=${s.source === "manual" ? "" : s.source}`} className="focus-ring capitalize text-ink/85 hover:text-plum">
                      {s.source}
                    </Link>
                    <span className="flex items-center gap-2 text-muted-strong">
                      <span className="num-tabular">{s.count.toLocaleString()}</span>
                      <span className="text-[11px]">last {relativeTime(s.lastAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ---------------- orders ---------------- */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-ink">{noOrdersYet ? "Orders" : "Needs attention"}</h2>
              <Link to="/admin/orders" className="focus-ring text-[13px] font-semibold text-plum hover:underline">View all</Link>
            </div>
            {noOrdersYet ? (
              <p className="mt-3 text-[13px] leading-relaxed text-muted-strong">
                Nothing has been ordered yet. When the first one arrives it starts at{" "}
                <strong className="text-ink">Order Received</strong> and you confirm each item can be sourced before
                moving it on — all over WhatsApp.
              </p>
            ) : open.length === 0 ? (
              <p className="mt-3 text-sm text-muted-strong">Nothing pending. 🌷</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {open.map((s) => (
                  <li key={s.key} className="flex items-center justify-between">
                    <Link to={`/admin/orders?status=${s.key}`} className="focus-ring text-[13px] text-ink/85 hover:text-plum">{s.label}</Link>
                    <span className="num-tabular rounded-full bg-plum-soft px-2 py-0.5 text-[12px] font-semibold text-plum">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.recent.length > 0 && (
            <div className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-[14px] font-semibold text-ink">Recent orders</h2>
              <ul className="mt-3 divide-y divide-line">
                {data.recent.map((o) => (
                  <li key={o.id}>
                    <Link to={`/admin/orders?id=${o.id}`} className="focus-ring flex items-center gap-3 py-3 hover:opacity-80">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-ink">{o.number} · {o.fullName}</p>
                        <p className="text-[11px] text-muted-strong">{o.items.length} item{o.items.length === 1 ? "" : "s"} · {relativeTime(o.createdAt)}</p>
                      </div>
                      <StatusPill status={o.status} statuses={statuses} />
                      <span className="num-tabular text-[13px] font-semibold">{money(o.totalCents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, to }: { label: string; value: string; to?: string }) {
  const inner = (
    <>
      <p className="th-label">{label}</p>
      <p className="num-tabular mt-1 text-2xl font-semibold text-ink">{value}</p>
    </>
  );
  return to ? (
    <Link to={to} className="focus-ring rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-plum/40">{inner}</Link>
  ) : (
    <div className="rounded-2xl border border-line bg-surface p-5">{inner}</div>
  );
}

const SEVERITY: Record<string, { label: string; cls: string }> = {
  placeholder: { label: "Placeholder", cls: "bg-sale/10 text-sale ring-sale/25" },
  missing: { label: "Not set", cls: "bg-[#fdf1dd] text-[#8a5f0c] ring-[#e5c890]" },
  unverified: { label: "Unconfirmed", cls: "bg-soft text-muted-strong ring-line-strong" },
};

/**
 * The mechanism that surfaces unconfigured settings instead of the code inventing values.
 * Ordered worst-first by the server; placeholders outrank blanks because a wrong value that
 * looks right is more dangerous than an obviously empty one.
 */
function SetupBanner({ checks }: { checks: SetupCheck[] }) {
  const blocking = checks.filter((c) => c.severity !== "unverified").length;
  return (
    <section
      aria-labelledby="setup-heading"
      className="mt-6 overflow-hidden rounded-2xl border border-sale/25 bg-sale/[0.04]"
    >
      <div className="flex items-start gap-3 border-b border-sale/15 px-5 py-4">
        <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-sale" />
        <div className="min-w-0">
          <h2 id="setup-heading" className="text-[14px] font-semibold text-ink">
            Setup incomplete — {checks.length} thing{checks.length === 1 ? "" : "s"} to fix
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink/70">
            {blocking > 0
              ? `${blocking} of these will affect customers or your own access. Nothing here is guessed — each one needs a real value from you.`
              : "These are valid but unconfirmed. Check each one is really yours."}
          </p>
        </div>
      </div>

      <ul className="divide-y divide-sale/10">
        {checks.map((c) => {
          const s = SEVERITY[c.severity] ?? SEVERITY.missing;
          return (
            <li key={`${c.key}-${c.severity}`} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-5 py-3.5">
              <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ring-1 ring-inset ${s.cls}`}>
                {s.label}
              </span>
              <div className="min-w-[12rem] flex-1">
                <p className="text-[13px] font-semibold text-ink">{c.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink/75">{c.message}</p>
              </div>
              <Link
                to={c.fix}
                className="btn btn-ghost focus-ring shrink-0 px-4 py-1.5 text-[12px]"
              >
                Fix <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
