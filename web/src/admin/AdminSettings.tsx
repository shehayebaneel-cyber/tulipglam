import { useEffect, useState } from "react";
import { adminApi, ApiError, type AdminArea, type AdminBrand, type AdminCategory } from "./adminApi";
import { Spinner, PlusIcon, TrashIcon, AlertIcon } from "../components/ui";
import { Combobox, type Option } from "./primitives/Combobox";
import { useToast } from "./primitives/Toast";

type FieldDef = { key: string; label: string; hint?: string; kind?: "text" | "textarea" | "bool" | "password" };

const STORE_FIELDS: FieldDef[] = [
  { key: "storeName", label: "Store name" },
  { key: "announcement", label: "Announcement bar text", kind: "textarea" },
  { key: "whatsappNumber", label: "WhatsApp number", hint: "Country code first, digits only, no “+”. Every order is confirmed on this number." },
  { key: "instagramUrl", label: "Instagram", hint: "Profile URL or @handle. Hidden from the footer while empty." },
  { key: "contactEmail", label: "Contact email", hint: "Shown on the Contact page and in the footer." },
  { key: "freeDeliveryThresholdCents", label: "Free delivery over (USD cents)", hint: "6000 = $60" },
  { key: "defaultDeliveryCents", label: "Default delivery fee (USD cents)", hint: "300 = $3. Used when an area has no fee of its own." },
  { key: "newArrivalDays", label: "New badge lasts (days)", hint: "Products set to “auto” show New for this long." },
];

/**
 * Sentences on the policy pages that only you can answer.
 *
 * Each one used to be hardcoded prose making a promise nobody had agreed to — "most orders
 * arrive within 2–5 working days" with no courier integration behind it, and a 48-hour returns
 * deadline out of thin air. While one of these is blank the sentence simply doesn't appear.
 */
const POLICY_FIELDS: FieldDef[] = [
  { key: "deliveryEstimate", label: "How long delivery takes", hint: "A full sentence, shown on the Delivery page. e.g. “Most orders arrive within 3 working days.” Leave blank and the page says we’ll confirm a timeframe on the call." },
  { key: "returnsWindow", label: "Window to report a problem", hint: "e.g. “48 hours” or “3 days”. Shown on the Returns page. Leave blank and it says “as soon as you notice”." },
  { key: "siteUrl", label: "Public site address", hint: "e.g. https://tulipglam.com — used for links in emails, the sitemap, and WhatsApp link previews." },
];

const EMAIL_FIELDS: FieldDef[] = [
  { key: "emailFrom", label: "From address", hint: "e.g. TulipGlam <orders@yourdomain.com>" },
  { key: "smtpHost", label: "SMTP host", hint: "Leave blank to disable email — orders still work over WhatsApp." },
  { key: "smtpPort", label: "SMTP port", hint: "587 or 465" },
  { key: "smtpUser", label: "SMTP username" },
  { key: "smtpPass", label: "SMTP password", kind: "password" },
  { key: "smtpSecure", label: "Use SSL", kind: "bool" },
];

const BOOL_OPTIONS: Option[] = [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];

export function AdminSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [areas, setAreas] = useState<AdminArea[]>([]);
  const [cats, setCats] = useState<AdminCategory[]>([]);
  const [brands, setBrands] = useState<AdminBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    adminApi.settings().then((r) => { setSettings(r.settings); setAreas(r.areas); }).finally(() => setLoading(false));
    adminApi.categories().then((r) => setCats(r.categories)).catch(() => setCats([]));
    adminApi.brands().then((r) => setBrands(r.brands)).catch(() => setBrands([]));
  }, []);

  const set = (key: string, value: string) => {
    setSettings((s) => ({ ...s, [key]: value }));
    // clear the inline error as soon as the operator edits the offending field
    setErrors((e) => (key in e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e));
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await adminApi.saveSettings(settings);
      push("ok", "Settings saved");
    } catch (e) {
      const err = e as ApiError;
      if (err.fields && Object.keys(err.fields).length) {
        setErrors(err.fields);
        push("error", "Some settings need fixing — see the fields marked below.");
      } else {
        push("error", err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const saveAreas = async () => {
    try {
      await adminApi.saveAreas(areas.map((a) => ({ id: a.id || undefined, name: a.name, fee: a.feeCents / 100, active: a.active })));
      const r = await adminApi.settings();
      setAreas(r.areas);
      push("ok", "Delivery areas saved");
    } catch (e) {
      push("error", (e as Error).message);
    }
  };

  if (loading) return <div className="grid place-items-center py-20 text-plum"><Spinner /></div>;

  const scopeType = settings.promoScopeType ?? "";
  const scopeOptions: Option[] =
    scopeType === "brand"
      ? [{ value: "", label: "Choose a brand…" }, ...[...brands].sort((a, b) => a.name.localeCompare(b.name)).map((b) => ({ value: b.slug, label: b.name, hint: String(b._count.products) }))]
      : scopeType === "category"
        ? [{ value: "", label: "Choose a category…" }, ...cats.filter((c) => c.active).map((c) => ({ value: c.slug, label: c.name, depth: c.parentId ? 1 : 0, hint: String(c._count.products) }))]
        : [];

  const field = (d: FieldDef) => (
    <Row key={d.key} label={d.label} hint={d.hint} error={errors[d.key]}>
      {d.kind === "textarea" ? (
        <textarea value={settings[d.key] ?? ""} onChange={(e) => set(d.key, e.target.value)} rows={2}
          aria-invalid={!!errors[d.key]} className={`field focus-ring resize-none ${errors[d.key] ? "border-sale" : ""}`} />
      ) : d.kind === "bool" ? (
        <Combobox value={(settings[d.key] ?? "false") === "true" ? "true" : "false"} onChange={(v) => set(d.key, v)} options={BOOL_OPTIONS} ariaLabel={d.label} buttonClassName="py-2.5" />
      ) : (
        <input type={d.kind === "password" ? "password" : "text"} value={settings[d.key] ?? ""} onChange={(e) => set(d.key, e.target.value)}
          aria-invalid={!!errors[d.key]} className={`field focus-ring ${errors[d.key] ? "border-sale" : ""}`} />
      )}
    </Row>
  );

  return (
    <div>
      <h1 className="serif text-2xl font-medium text-ink sm:text-3xl">Settings</h1>
      <p className="mt-1 text-sm text-muted-strong">Placeholder-looking values are rejected — the storefront would otherwise show them to customers.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card title="Store">
            <div className="space-y-3">{STORE_FIELDS.map(field)}</div>
          </Card>

          <Card title="Policy pages">
            <p className="mb-3 text-[12px] leading-relaxed text-muted-strong">
              These fill in sentences on the Delivery and Returns pages. Those sentences used to be hardcoded and made
              promises nobody had agreed to — a 2–5 day delivery window with no courier behind it, and a 48-hour returns
              deadline. Leave one blank and its sentence simply doesn’t appear.
            </p>
            <div className="space-y-3">{POLICY_FIELDS.map(field)}</div>
          </Card>

          <Card title="Homepage promo">
            <p className="mb-3 text-[12px] leading-relaxed text-muted-strong">
              The band hides itself unless it has a title and its scope resolves to a real brand or category with
              products in it. The discount line only appears when something in that scope actually has a sale price —
              so it can never claim a reduction that does not exist.
            </p>
            <div className="space-y-3">
              <Row label="Show the promo">
                <Combobox value={(settings.promoActive ?? "false") === "true" ? "true" : "false"} onChange={(v) => set("promoActive", v)} options={BOOL_OPTIONS} ariaLabel="Show the promo" buttonClassName="py-2.5" />
              </Row>
              <Row label="Title" hint="Required. With no title the band does not render." error={errors.promoTitle}>
                <input value={settings.promoTitle ?? ""} onChange={(e) => set("promoTitle", e.target.value)} className="field focus-ring" />
              </Row>
              <Row label="Supporting text">
                <textarea value={settings.promoText ?? ""} onChange={(e) => set("promoText", e.target.value)} rows={2} className="field focus-ring resize-none" />
              </Row>
              <Row label="Discount line" hint="e.g. “up to 30% off”. Suppressed automatically when nothing in scope is on sale.">
                <input value={settings.promoDiscountText ?? ""} onChange={(e) => set("promoDiscountText", e.target.value)} placeholder="leave blank for no claim" className="field focus-ring" />
              </Row>
              <Row label="Links to">
                <Combobox
                  value={scopeType}
                  onChange={(v) => { set("promoScopeType", v); set("promoScopeSlug", ""); }}
                  options={[
                    { value: "", label: "The whole shop" },
                    { value: "brand", label: "A brand" },
                    { value: "category", label: "A category" },
                    { value: "sale", label: "Everything on sale" },
                  ]}
                  ariaLabel="What the promo links to"
                  buttonClassName="py-2.5"
                />
              </Row>
              {(scopeType === "brand" || scopeType === "category") && (
                <Row label={scopeType === "brand" ? "Which brand" : "Which category"} hint="If this no longer exists, the whole band stops rendering.">
                  <Combobox value={settings.promoScopeSlug ?? ""} onChange={(v) => set("promoScopeSlug", v)} options={scopeOptions}
                    ariaLabel={scopeType === "brand" ? "Promo brand" : "Promo category"} searchable searchPlaceholder="Search…" buttonClassName="py-2.5" />
                </Row>
              )}
              <Row label="Button label">
                <input value={settings.promoCtaLabel ?? ""} onChange={(e) => set("promoCtaLabel", e.target.value)} placeholder="Shop now" className="field focus-ring" />
              </Row>
            </div>
          </Card>

          <button onClick={save} disabled={busy} className="btn btn-ink focus-ring px-6 py-3">{busy ? "Saving…" : "Save settings"}</button>
        </div>

        <div className="space-y-6">
          <Card title="Email notifications">
            <p className="mb-3 text-[12px] text-muted-strong">
              Optional. When configured, customers get an email on order and status changes. Leave the host blank to
              skip email — orders still work over WhatsApp.
            </p>
            <div className="space-y-3">{EMAIL_FIELDS.map(field)}</div>
            <button onClick={save} disabled={busy} className="btn btn-ink focus-ring mt-4 px-6 py-3">{busy ? "Saving…" : "Save email settings"}</button>
          </Card>

          <Card title="Delivery areas & fees">
            <div className="space-y-2">
              {areas.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={a.name} onChange={(e) => setAreas((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    placeholder="Area" aria-label={`Area ${i + 1} name`} className="field focus-ring flex-1 py-2" />
                  <div className="relative w-28">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-strong">$</span>
                    <input value={(a.feeCents / 100).toString()} onChange={(e) => setAreas((arr) => arr.map((x, j) => j === i ? { ...x, feeCents: Math.round(Number(e.target.value) * 100) || 0 } : x))}
                      inputMode="decimal" aria-label={`Area ${i + 1} fee in dollars`} className="field focus-ring num-tabular py-2 pl-6" />
                  </div>
                  <label className="flex items-center gap-1 text-[11px] text-ink/80">
                    <input type="checkbox" checked={a.active} onChange={(e) => setAreas((arr) => arr.map((x, j) => j === i ? { ...x, active: e.target.checked } : x))} className="focus-ring accent-plum" /> on
                  </label>
                  <button onClick={() => setAreas((arr) => arr.filter((_, j) => j !== i))} aria-label={`Remove area ${i + 1}`} className="focus-ring grid h-8 w-8 place-items-center rounded-md text-muted-strong hover:text-sale"><TrashIcon className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={() => setAreas((arr) => [...arr, { id: 0, name: "", feeCents: 300, active: true, sortOrder: arr.length }])} className="btn btn-ghost focus-ring mt-2 px-4 py-2 text-[12px]"><PlusIcon className="h-4 w-4" /> Add area</button>
            <div className="mt-4"><button onClick={saveAreas} className="btn btn-ink focus-ring px-6 py-3">Save areas</button></div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted-strong">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink/70">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 flex items-start gap-1.5 text-[11.5px] font-medium text-sale">
          <AlertIcon className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-muted-strong">{hint}</span>
      ) : null}
    </label>
  );
}
