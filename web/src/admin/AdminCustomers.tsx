import { useEffect, useState } from "react";
import { adminApi, type AdminCustomer } from "./adminApi";
import { usd } from "../lib/api";
import { Spinner } from "../components/ui";

export function AdminCustomers() {
  const [rows, setRows] = useState<AdminCustomer[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { setLoading(true); adminApi.customers(q).then((r) => setRows(r.customers)).finally(() => setLoading(false)); }, [q]);

  return (
    <div>
      <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Customers</h1>
      <p className="mt-1 text-sm text-muted">{rows.length} registered accounts</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone…" className="field mt-4 max-w-xs" />

      {loading ? <div className="grid place-items-center py-20 text-plum"><Spinner /></div> : rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted">No customers found. Accounts appear here when shoppers register.</p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-soft/50 text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-3">Customer</th><th className="hidden px-4 py-3 sm:table-cell">Phone</th><th className="px-4 py-3">Orders</th><th className="px-4 py-3">Spent</th><th className="hidden px-4 py-3 sm:table-cell">Joined</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-soft/40">
                  <td className="px-4 py-3"><p className="font-semibold text-ink">{c.fullName}</p><p className="text-[11px] text-muted">{c.email}</p></td>
                  <td className="hidden px-4 py-3 text-muted sm:table-cell">{c.phone || "—"}</td>
                  <td className="px-4 py-3 tabular">{c.orderCount}</td>
                  <td className="px-4 py-3 serif tabular">{usd(c.spentCents)}</td>
                  <td className="hidden px-4 py-3 text-muted sm:table-cell">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
