import { useState } from "react";
import { adminApi, getKey } from "./adminApi";
import { Spinner, CheckIcon } from "../components/ui";

export function AdminImport() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const [err, setErr] = useState("");

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
      setResult(await adminApi.importFile(data));
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const downloadTemplate = async () => {
    const res = await fetch("/api/admin/import/template", { headers: { "x-admin-key": getKey() } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "tulipglam-import-template.xlsx"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-2xl">
      <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Import products</h1>
      <p className="mt-1 text-sm text-muted">Bulk-add or update products from an Excel file. Products are matched by brand + name — existing ones are updated, new ones created.</p>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">1 · Get the template</h2>
        <p className="mt-2 text-[13px] text-ink/80">Columns: <code className="rounded bg-soft px-1">name, brand, category, price, sale, status, shortDesc, description, glyph, tint, bestSeller, concerns, attributes, shades, sizes</code>. Category must match an existing category slug or name. Shades use <code className="rounded bg-soft px-1">Label:#hex; Label:#hex</code>; sizes use <code className="rounded bg-soft px-1">50ml; 90ml</code>.</p>
        <button onClick={downloadTemplate} className="btn btn-ghost mt-3 px-5 py-2.5 text-[13px]">Download template</button>
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">2 · Upload your file</h2>
        <label className="mt-3 grid cursor-pointer place-items-center rounded-xl border border-dashed border-line-strong py-10 text-center hover:border-plum">
          {busy ? <Spinner className="h-6 w-6 text-plum" /> : <p className="text-[14px] font-medium text-ink">Click to choose an .xlsx file</p>}
          <p className="mt-1 text-[12px] text-muted">or drag it here</p>
          <input type="file" accept=".xlsx,.xls" onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="hidden" />
        </label>
      </div>

      {err && <p className="mt-4 rounded-lg bg-sale/10 px-3 py-2 text-[13px] text-sale">{err}</p>}
      {result && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ok"><CheckIcon className="h-5 w-5" /> Import complete</p>
          <p className="mt-1 text-[13px] text-ink/80">{result.created} created · {result.updated} updated</p>
          {result.errors.length > 0 && (
            <div className="mt-3">
              <p className="text-[13px] font-semibold text-sale">{result.errors.length} row(s) skipped:</p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-[12px] text-muted">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
