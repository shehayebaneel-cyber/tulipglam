import { useEffect, useState } from "react";
import { adminApi, type AdminReview } from "./adminApi";
import { Stars, Spinner, TrashIcon, CheckIcon } from "../components/ui";

export function AdminReviews() {
  const [rows, setRows] = useState<AdminReview[]>([]);
  const [pending, setPending] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = () => { setLoading(true); adminApi.reviews(pending).then((r) => setRows(r.reviews)).finally(() => setLoading(false)); };
  useEffect(load, [pending]);

  const approve = async (r: AdminReview, v: boolean) => { await adminApi.approveReview(r.id, v); load(); };
  const remove = async (r: AdminReview) => { if (confirm("Delete this review?")) { await adminApi.deleteReview(r.id); load(); } };

  return (
    <div>
      <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Reviews</h1>
      <div className="mt-4 inline-flex rounded-full border border-line bg-surface p-0.5 text-[13px] font-medium">
        <button onClick={() => setPending(true)} className={`rounded-full px-4 py-1.5 ${pending ? "bg-plum text-white" : "text-ink/70"}`}>Pending</button>
        <button onClick={() => setPending(false)} className={`rounded-full px-4 py-1.5 ${!pending ? "bg-plum text-white" : "text-ink/70"}`}>All</button>
      </div>

      {loading ? <div className="grid place-items-center py-20 text-plum"><Spinner /></div> : rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted">{pending ? "No reviews waiting for approval. 🌷" : "No reviews yet."}</p>
      ) : (
        <div className="mt-5 space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Stars rating={r.rating} />
                  {r.title && <p className="mt-1.5 text-[14px] font-semibold text-ink">{r.title}</p>}
                  <p className="mt-1 text-[14px] text-ink/85">“{r.text}”</p>
                  <p className="mt-2 text-[12px] text-muted">{r.author} · {r.product.name} · {new Date(r.createdAt).toLocaleDateString()}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${r.approved ? "bg-ok/10 text-ok" : "bg-[#fdf1dd] text-[#96690f]"}`}>{r.approved ? "Published" : "Pending"}</span>
              </div>
              <div className="mt-3 flex gap-2">
                {!r.approved && <button onClick={() => approve(r, true)} className="btn btn-ink px-4 py-2 text-[12px]"><CheckIcon className="h-4 w-4" /> Approve</button>}
                {r.approved && <button onClick={() => approve(r, false)} className="btn btn-ghost px-4 py-2 text-[12px]">Unpublish</button>}
                <button onClick={() => remove(r)} className="btn btn-ghost px-4 py-2 text-[12px] text-sale"><TrashIcon className="h-4 w-4" /> Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
