import { useEffect, useState } from "react";
import { adminApi, type AdminCustomer } from "./adminApi";
import { usd } from "../lib/api";
import { Spinner } from "../components/ui";

/**
 * Customers.
 *
 * ── WHY THERE ARE TWO RENDERINGS ───────────────────────────────────────────────────
 *
 * The table sat in an `overflow-hidden` wrapper, so anything past the container's width was
 * clipped with no scrollbar to reach it with — the same defect 268695e fixed for the product
 * list ("the Edit button was off-screen on every laptop"). This screen is a sibling that was
 * missed; the wrapper now scrolls sideways.
 *
 * Below 640px it is cards instead, because five columns of a scrolled table is not how anyone
 * looks a customer up. The row has no Edit or Delete — the actions it does have are contact
 * ones, so those are what the card's footer carries, and the number is a `tel:` link rather
 * than text to be copied out by hand.
 */
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
        <>
          <ul className="mt-5 space-y-3 sm:hidden">
            {rows.map((c) => <PhoneCard key={c.id} c={c} />)}
          </ul>

          <div className="mt-5 hidden overflow-hidden rounded-2xl border border-line bg-surface sm:block">
            <div className="overflow-x-auto">
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
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One customer, as read on a phone.
 *
 * The name leads and is the largest thing here — this list is searched by name, and the row is
 * confirmed by the email under it. Total spent is the figure worth knowing about a customer and
 * keeps its serif; the order count is what gives it meaning, so the two sit together. Joined
 * drops to provenance size: it explains a number, it is never the reason anyone opened this.
 */
function PhoneCard({ c }: { c: AdminCustomer }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[18px] font-semibold leading-tight text-ink">{c.fullName}</p>
            <p className="mt-0.5 truncate text-[13px] text-muted-strong">{c.email}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="serif text-[17px] leading-none tabular text-ink">{usd(c.spentCents)}</p>
            <p className="mt-1 text-[11px] text-muted">{c.orderCount} order{c.orderCount === 1 ? "" : "s"}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted">Joined {new Date(c.createdAt).toLocaleDateString()}</p>
      </div>

      {/* Contact, as a footer a thumb can hit. Phone is absent on plenty of accounts, so the
          Call half is only there when there is a number behind it. */}
      <div className="flex border-t border-line">
        {c.phone && (
          <a href={`tel:${c.phone}`} className="focus-ring flex min-h-11 flex-1 items-center justify-center truncate px-3 text-[13px] font-semibold text-ink">
            Call {c.phone}
          </a>
        )}
        <a
          href={`mailto:${c.email}`}
          className={`focus-ring flex min-h-11 items-center justify-center px-4 text-[13px] font-semibold text-ink ${c.phone ? "shrink-0 border-l border-line" : "flex-1"}`}
        >
          Email
        </a>
      </div>
    </li>
  );
}

