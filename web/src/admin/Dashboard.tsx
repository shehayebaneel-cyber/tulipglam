import { Link } from "react-router-dom";
import { adminApi } from "./adminApi";
import { useFetch } from "../lib/hooks";
import { useStore } from "../lib/store";
import { usd } from "../lib/api";
import { Spinner } from "../components/ui";
import { StatusPill } from "./ui";

export function Dashboard() {
  const { data, loading } = useFetch(() => adminApi.summary(), []);
  const { site } = useStore();
  const statuses = site?.statuses ?? [];

  if (loading || !data) return <div className="grid place-items-center py-24 text-plum"><Spinner /></div>;

  const stats = [
    { label: "Orders", value: data.orders },
    { label: "Revenue (est.)", value: usd(data.revenueCents) },
    { label: "Active products", value: `${data.active}/${data.products}` },
    { label: "Reviews to approve", value: data.pendingReviews },
  ];
  const open = statuses.filter((s) => !["delivered", "completed", "cancelled", "unavailable"].includes(s.key)).map((s) => ({ ...s, count: data.byStatus[s.key] ?? 0 }));

  return (
    <div>
      <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">A quick look at your store.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-[12px] font-medium uppercase tracking-wide text-muted">{s.label}</p>
            <p className="serif mt-1 text-2xl font-medium text-ink tabular">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* recent orders */}
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Recent orders</h2>
            <Link to="/admin/orders" className="text-[13px] font-semibold text-plum hover:underline">View all</Link>
          </div>
          {data.recent.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No orders yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {data.recent.map((o) => (
                <li key={o.id}>
                  <Link to={`/admin/orders?id=${o.id}`} className="flex items-center gap-3 py-3 hover:opacity-80">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-ink">{o.number} · {o.fullName}</p>
                      <p className="text-[11px] text-muted">{o.items.length} item{o.items.length === 1 ? "" : "s"} · {new Date(o.createdAt).toLocaleDateString()}</p>
                    </div>
                    <StatusPill status={o.status} statuses={statuses} />
                    <span className="serif text-[14px] tabular">{usd(o.totalCents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* open by status */}
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[14px] font-semibold text-ink">Needs attention</h2>
          <ul className="mt-3 space-y-2">
            {open.filter((s) => s.count > 0).length === 0 && <li className="text-sm text-muted">Nothing pending. 🌷</li>}
            {open.filter((s) => s.count > 0).map((s) => (
              <li key={s.key} className="flex items-center justify-between">
                <Link to={`/admin/orders?status=${s.key}`} className="text-[13px] text-ink/80 hover:text-plum">{s.label}</Link>
                <span className="rounded-full bg-plum-soft px-2 py-0.5 text-[12px] font-semibold text-plum tabular">{s.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
