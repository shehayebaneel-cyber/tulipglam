import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { Spinner, ArrowRight } from "../components/ui";

export function Brands() {
  const { data, loading } = useFetch(() => api.brands(), []);
  const brands = data?.brands ?? [];

  return (
    <div className="wrap py-6 sm:py-8">
      <h1 className="serif text-3xl font-medium text-ink sm:text-4xl">Our brands</h1>
      <p className="mt-1 max-w-lg text-sm text-muted">The lines we carry — sourced authentic and delivered across Lebanon.</p>

      {loading ? (
        <div className="grid place-items-center py-24 text-plum"><Spinner /></div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((b) => (
            <Link key={b.slug} to={`/shop?brand=${b.slug}`} className="group flex flex-col rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-plum/40">
              <div className="flex items-baseline justify-between">
                <span className="serif text-2xl font-medium text-ink">{b.name}</span>
                {b.featured && <span className="rounded-full bg-plum-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-plum">Featured</span>}
              </div>
              {b.blurb && <p className="mt-2 flex-1 text-[13px] text-muted">{b.blurb}</p>}
              <span className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-plum group-hover:gap-1.5">
                {b._count?.products ?? 0} product{(b._count?.products ?? 0) === 1 ? "" : "s"} <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
