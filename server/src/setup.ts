// Settings validation + the "is this store actually configured?" audit.
//
// Two jobs, deliberately in one place so they can never disagree:
//   1. validateSettings() — hard rejection of bad or placeholder values on save.
//   2. setupChecks()      — the audit the admin Dashboard renders as a banner.
//
// The rule throughout: never invent a replacement value. If something is missing or
// looks like a placeholder we say so and point at the field; we do not guess.

/** The value shipped in server/.env for local development. Never valid in production. */
export const DEV_ADMIN_KEY = "tulip-admin-2026";

export type Severity = "missing" | "placeholder" | "unverified";

export type SetupCheck = {
  key: string; // setting key, or a synthetic key like "adminKey"
  label: string;
  severity: Severity;
  message: string;
  /** admin route that fixes it */
  fix: string;
};

// ---------------------------------------------------------------- primitives
const digitsOf = (v: string) => v.replace(/[^\d]/g, "");

/** 5+ of the same digit in a row, e.g. 9613000000 — real numbers rarely look like this. */
const hasRepeatedRun = (d: string) => /(\d)\1{4,}/.test(d);

/** 6+ ascending or descending consecutive digits, e.g. 123456 / 987654. */
function hasSequentialRun(d: string): boolean {
  let asc = 1, desc = 1;
  for (let i = 1; i < d.length; i++) {
    const delta = d.charCodeAt(i) - d.charCodeAt(i - 1);
    asc = delta === 1 ? asc + 1 : 1;
    desc = delta === -1 ? desc + 1 : 1;
    if (asc >= 6 || desc >= 6) return true;
  }
  return false;
}

const PLACEHOLDER_DOMAINS = ["example.com", "example.org", "example.net", "test.com", "domain.com", "yourdomain.com", "email.com", "localhost"];
const PLACEHOLDER_WORDS = ["yourhandle", "your-handle", "your_handle", "username", "your-username", "handle", "changeme", "placeholder", "todo", "xxx", "yourbrand", "yourstore", "youremail", "your-email"];

const looksPlaceholderWord = (v: string) => {
  const s = v.toLowerCase();
  return PLACEHOLDER_WORDS.some((w) => s === w || s.includes(w));
};

// ---------------------------------------------------------------- validators
// Each returns null when acceptable, or a human message explaining the rejection.

export function validateWhatsApp(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null; // emptiness is a setup gap, not a save-blocking error
  if (/[a-z]/i.test(v)) return "Digits only — country code first, no “+”, no letters.";
  const d = digitsOf(v);
  if (d.length < 8) return "Too short to be a real number — include the country code, e.g. 961 followed by the number.";
  if (d.length > 15) return "Too long — international numbers are at most 15 digits.";
  if (hasRepeatedRun(d)) return "This looks like a placeholder (a long run of the same digit). Enter the real WhatsApp number.";
  if (hasSequentialRun(d)) return "This looks like a placeholder (a run of sequential digits). Enter the real WhatsApp number.";
  return null;
}

export function validateInstagram(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const handle = instagramHandle(v);
  if (!handle) return "Enter an Instagram profile URL or an @handle.";
  if (looksPlaceholderWord(handle)) return "This looks like a placeholder. Enter the real Instagram handle.";
  if (PLACEHOLDER_DOMAINS.some((d) => v.toLowerCase().includes(d))) return "That is an example domain, not a real profile.";
  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) return "Instagram handles use letters, numbers, dots and underscores only.";
  return null;
}

/** "https://instagram.com/foo/", "@foo", "foo" → "foo". Empty string when unparseable. */
export function instagramHandle(raw: string): string {
  const v = raw.trim().replace(/^@/, "");
  const m = v.match(/instagram\.com\/([^/?#]+)/i);
  const handle = m ? m[1] : v.includes("/") || v.includes(" ") ? "" : v;
  return handle.replace(/\/$/, "");
}

export function validateEmail(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(v)) return "That is not a valid email address.";
  const domain = v.split("@")[1]!.toLowerCase();
  if (PLACEHOLDER_DOMAINS.includes(domain)) return `${domain} is an example domain — enter a real address.`;
  const local = v.split("@")[0]!.toLowerCase();
  if (looksPlaceholderWord(local) || looksPlaceholderWord(domain)) return "This looks like a placeholder. Enter the real address.";
  return null;
}

const NUMERIC_SETTINGS: Record<string, { label: string; min: number; max: number }> = {
  freeDeliveryThresholdCents: { label: "Free delivery threshold", min: 0, max: 10_000_00 },
  defaultDeliveryCents: { label: "Default delivery fee", min: 0, max: 1_000_00 },
  newArrivalDays: { label: "New badge duration", min: 1, max: 365 },
};

/**
 * Validate a partial settings patch. Returns per-key messages; an empty object means
 * the patch is safe to persist.
 */
export function validateSettings(patch: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  const check = (key: string, fn: (v: string) => string | null) => {
    if (!(key in patch)) return;
    const msg = fn(String(patch[key] ?? ""));
    if (msg) errors[key] = msg;
  };

  check("whatsappNumber", validateWhatsApp);
  check("instagramUrl", validateInstagram);
  check("contactEmail", validateEmail);
  check("emailFrom", (v) => {
    if (!v.trim()) return null;
    // allows "Name <addr@host>" as well as a bare address
    const m = v.match(/<([^>]+)>\s*$/);
    return validateEmail(m ? m[1] : v);
  });

  for (const [key, rule] of Object.entries(NUMERIC_SETTINGS)) {
    if (!(key in patch)) continue;
    const raw = String(patch[key] ?? "").trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) errors[key] = `${rule.label} must be a whole number.`;
    else if (n < rule.min || n > rule.max) errors[key] = `${rule.label} must be between ${rule.min} and ${rule.max}.`;
  }

  for (const key of ["promoActive", "smtpSecure"]) {
    if (!(key in patch)) continue;
    const raw = String(patch[key] ?? "").trim().toLowerCase();
    if (raw && raw !== "true" && raw !== "false") errors[key] = "Must be exactly “true” or “false”.";
  }

  return errors;
}

// ---------------------------------------------------------------- setup audit
type AuditInput = {
  settings: Record<string, string>;
  adminKeyIsDefault: boolean;
  /** true when promoActive is on but the promo could not be resolved into something renderable */
  promoActiveButUnresolved: boolean;
  promoUnresolvedReason: string;
};

/**
 * Everything standing between this store and being safe to promote. Ordered by how
 * damaging it is to leave unfixed.
 */
export function setupChecks(input: AuditInput): SetupCheck[] {
  const { settings: s } = input;
  const out: SetupCheck[] = [];
  const val = (k: string) => (s[k] ?? "").trim();

  if (input.adminKeyIsDefault) {
    out.push({
      key: "adminKey", label: "Admin key", severity: "placeholder", fix: "/admin/settings",
      message: "The admin key is still the development default. Set a strong ADMIN_KEY in the server environment and redeploy — anyone who knows the default can sign in here.",
    });
  }

  // WhatsApp is the entire fulfilment channel, so it outranks everything else in Settings.
  const wa = val("whatsappNumber");
  if (!wa) {
    out.push({ key: "whatsappNumber", label: "WhatsApp number", severity: "missing", fix: "/admin/settings",
      message: "No WhatsApp number. Checkout confirmation and every order conversation happen here — customers currently have no way to reach you." });
  } else {
    const msg = validateWhatsApp(wa);
    if (msg) out.push({ key: "whatsappNumber", label: "WhatsApp number", severity: "placeholder", fix: "/admin/settings", message: msg });
  }

  const email = val("contactEmail");
  if (!email) {
    out.push({ key: "contactEmail", label: "Contact email", severity: "missing", fix: "/admin/settings",
      message: "No contact email. It is shown on the Contact page and in the footer." });
  } else {
    const msg = validateEmail(email);
    if (msg) out.push({ key: "contactEmail", label: "Contact email", severity: "placeholder", fix: "/admin/settings", message: msg });
    else if (sharesStoreName(email, val("storeName"))) {
      out.push({ key: "contactEmail", label: "Contact email", severity: "unverified", fix: "/admin/settings",
        message: `“${email}” matches the store name but has not been confirmed as a real mailbox. Send a test message to it, or replace it.` });
    }
  }

  const ig = val("instagramUrl");
  if (!ig) {
    out.push({ key: "instagramUrl", label: "Instagram", severity: "missing", fix: "/admin/settings",
      message: "No Instagram link. The footer and contact page hide the link until this is set." });
  } else {
    const msg = validateInstagram(ig);
    if (msg) out.push({ key: "instagramUrl", label: "Instagram", severity: "placeholder", fix: "/admin/settings", message: msg });
    else if (sharesStoreName(instagramHandle(ig), val("storeName"))) {
      out.push({ key: "instagramUrl", label: "Instagram", severity: "unverified", fix: "/admin/settings",
        message: `“@${instagramHandle(ig)}” is a valid handle but has not been confirmed as your account. Open it and check, or replace it.` });
    }
  }

  if (input.promoActiveButUnresolved) {
    out.push({ key: "promoTitle", label: "Homepage promo", severity: "placeholder", fix: "/admin/settings",
      message: `The homepage promo is switched on but is not rendering: ${input.promoUnresolvedReason} Fix the promo fields or switch it off.` });
  }

  if (!val("storeName")) {
    out.push({ key: "storeName", label: "Store name", severity: "missing", fix: "/admin/settings", message: "No store name — it appears in emails and page titles." });
  }

  return out;
}

/** "hello@tulipglam.com" + "TulipGlam" → true. Catches self-referential placeholders. */
function sharesStoreName(value: string, storeName: string): boolean {
  const slug = storeName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (slug.length < 4) return false;
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").includes(slug);
}
