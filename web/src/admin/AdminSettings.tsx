import { useEffect, useState } from "react";
import { adminApi, type AdminArea } from "./adminApi";
import { Spinner, PlusIcon, TrashIcon } from "../components/ui";
import { L } from "./AdminCategories";

const FIELDS: [string, string, string?][] = [
  ["storeName", "Store name"],
  ["announcement", "Announcement bar text"],
  ["whatsappNumber", "WhatsApp number", "e.g. 9613000000 (country code, no +)"],
  ["instagramUrl", "Instagram URL"],
  ["contactEmail", "Contact email", "shown on the Contact page + footer"],
  ["freeDeliveryThresholdCents", "Free delivery over (USD cents)", "6000 = $60"],
  ["defaultDeliveryCents", "Default delivery fee (USD cents)", "300 = $3"],
  ["newArrivalDays", "New badge lasts (days)", "auto products newer than this show New"],
  ["promoTitle", "Homepage promo title"],
  ["promoText", "Homepage promo text"],
  ["promoActive", "Show promo? (true / false)"],
];

const EMAIL_FIELDS: [string, string, string?][] = [
  ["emailFrom", "From address", "e.g. TulipGlam <orders@yourdomain.com>"],
  ["smtpHost", "SMTP host", "leave blank to disable email (orders still work)"],
  ["smtpPort", "SMTP port", "587 or 465"],
  ["smtpUser", "SMTP username"],
  ["smtpPass", "SMTP password"],
  ["smtpSecure", "Use SSL? (true / false)"],
];

export function AdminSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [areas, setAreas] = useState<AdminArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState("");

  useEffect(() => { adminApi.settings().then((r) => { setSettings(r.settings); setAreas(r.areas); }).finally(() => setLoading(false)); }, []);

  const saveSettings = async () => { await adminApi.saveSettings(settings); flash("Settings saved"); };
  const saveAreas = async () => {
    await adminApi.saveAreas(areas.map((a) => ({ id: a.id || undefined, name: a.name, fee: a.feeCents / 100, active: a.active })));
    const r = await adminApi.settings(); setAreas(r.areas); flash("Delivery areas saved");
  };
  const flash = (m: string) => { setSaved(m); setTimeout(() => setSaved(""), 2500); };

  if (loading) return <div className="grid place-items-center py-20 text-plum"><Spinner /></div>;

  return (
    <div>
      <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Settings</h1>
      {saved && <p className="mt-3 rounded-lg bg-ok/10 px-3 py-2 text-[13px] text-ok">{saved}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Store</h2>
          <div className="mt-3 space-y-3">
            {FIELDS.map(([key, label, hint]) => (
              <L key={key} label={label}>
                {key === "announcement" || key === "promoText" ? (
                  <textarea value={settings[key] ?? ""} onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))} rows={2} className="field resize-none" />
                ) : (
                  <input value={settings[key] ?? ""} onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))} className="field" />
                )}
                {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
              </L>
            ))}
          </div>
          <button onClick={saveSettings} className="btn btn-ink mt-4 px-6 py-3">Save settings</button>
        </div>

        <div className="space-y-6">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Email notifications</h2>
          <p className="mt-1 text-[12px] text-muted">Optional. When configured, customers get an email on order and status changes. Leave the host blank to skip email — orders still work via WhatsApp.</p>
          <div className="mt-3 space-y-3">
            {EMAIL_FIELDS.map(([key, label, hint]) => (
              <L key={key} label={label}>
                <input type={key === "smtpPass" ? "password" : "text"} value={settings[key] ?? ""} onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))} className="field" />
                {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
              </L>
            ))}
          </div>
          <button onClick={saveSettings} className="btn btn-ink mt-4 px-6 py-3">Save email settings</button>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Delivery areas & fees</h2>
          <div className="mt-3 space-y-2">
            {areas.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={a.name} onChange={(e) => setAreas((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Area" className="field flex-1 py-2" />
                <div className="relative w-28">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">$</span>
                  <input value={(a.feeCents / 100).toString()} onChange={(e) => setAreas((arr) => arr.map((x, j) => j === i ? { ...x, feeCents: Math.round(Number(e.target.value) * 100) || 0 } : x))} inputMode="decimal" className="field py-2 pl-6" />
                </div>
                <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={a.active} onChange={(e) => setAreas((arr) => arr.map((x, j) => j === i ? { ...x, active: e.target.checked } : x))} className="accent-plum" /> on</label>
                <button onClick={() => setAreas((arr) => arr.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:text-sale"><TrashIcon className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <button onClick={() => setAreas((arr) => [...arr, { id: 0, name: "", feeCents: 300, active: true, sortOrder: arr.length }])} className="btn btn-ghost mt-2 px-4 py-2 text-[12px]"><PlusIcon className="h-4 w-4" /> Add area</button>
          <div className="mt-4"><button onClick={saveAreas} className="btn btn-ink px-6 py-3">Save areas</button></div>
        </div>
        </div>
      </div>
    </div>
  );
}
