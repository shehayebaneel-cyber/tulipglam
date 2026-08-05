/**
 * Telling our own server when this page breaks — and telling nobody else anything.
 *
 * ── THE SENTENCE THIS MUST NOT MAKE FALSE ──────────────────────────────────────────
 *
 * The privacy policy (POLICIES.txt §3, "What we don't do") says:
 *
 *     "There is no advertising or analytics service on this site — no tracking pixel, no
 *      third-party script, and nothing loaded from another company's servers. When you browse
 *      TulipGlam, your browser talks to us and to nobody else."
 *
 * Every word of that stays true with this installed. Nothing is loaded — this is a few hundred
 * bytes inside the bundle the browser already has. Nothing is sent anywhere but our own origin.
 * And it is NOT analytics: it fires only when something throws, so a customer who browses,
 * orders and leaves without hitting a bug produces no record of any kind. There is no page
 * view, no session, no identifier, no cookie, no localStorage key, nothing derived from the
 * customer at all.
 *
 * What leaves the device, and only when something has already gone wrong:
 *
 *     the error name and message · up to four stack frames, our origin stripped out
 *     the file, line and column · `location.pathname` · the device clock
 *
 * What deliberately does not:
 *
 *   - **`location.search`.** `/search?q=…` is what the customer typed into the search box and
 *     `/reset-password?token=…` is a credential. Only the pathname is read.
 *   - **The order number.** It is stripped out here rather than on the server, because /track
 *     takes no sign-in: the number IS the credential for reading that order, so it must not
 *     leave the device at all, not merely go unstored.
 *   - **Anything about who you are.** There is no id to send. Two errors from one phone and one
 *     error from each of two phones are indistinguishable at the other end, which is precisely
 *     why this can never be turned into a visitor count.
 *
 * The user-agent family recorded against a report is derived ON THE SERVER from the header the
 * browser sends with every request anyway (server/src/clientErrors.ts) — so this file sends no
 * user agent at all, coarse or otherwise.
 *
 * ── IT MUST NEVER BREAK, AND NEVER LOOP ────────────────────────────────────────────
 *
 * This runs on a customer's phone in the middle of a failure. Three rules, all enforced below:
 *
 *   1. Every path is inside a `try`. A reporter that throws while reporting turns one broken
 *      component into a broken page.
 *   2. It cannot report itself. `reporting` blocks re-entry, and the send never produces a
 *      rejection to catch — an unhandled one would come straight back through
 *      `unhandledrejection` and the loop would be closed.
 *   3. It is capped and de-duplicated per page load. A render loop throws thousands of times a
 *      second; five distinct problems is everything anyone can act on and the rest is a
 *      denial-of-service against our own error table.
 *
 * ── TESTING IT ─────────────────────────────────────────────────────────────────────
 *
 * Off in dev by default, because the dev server proxies to the same API the shop runs on and
 * every typo during an HMR session would land in the operator's error list as if a customer had
 * hit it. To exercise it locally: `installClientErrorReporting({ enabled: true })`, then
 * `setTimeout(() => { throw new Error("test"); })` in the console.
 */

const ENDPOINT = "/api/client-errors";

/**
 * Distinct problems reported per page load.
 *
 * A full reload resets it, which is the behaviour we want: someone who reloads a broken page is
 * telling us it broke again. Route changes do not, because an SPA session lasts a long time and
 * the cap is there to survive one.
 */
export const MAX_REPORTS_PER_PAGE_LOAD = 5;

const MAX_FRAMES = 4;
const MAX_FRAME_CHARS = 200;
const MAX_MESSAGE_CHARS = 300;
/** Comfortably under the server's own 4 KB cap; a payload over it is malformed, not urgent. */
const MAX_BODY_CHARS = 3000;

const EXTENSION_SCHEME = /(?:chrome|moz|safari-web|ms-browser)-extension:\/\//i;

/**
 * Noise that is never our bug.
 *
 * "Script error." is what a browser reports for a script from another origin that it refuses to
 * describe — and since this page loads no third-party script, one can only have come from an
 * extension. The ResizeObserver messages are a well-known browser artefact that no application
 * code causes and none can fix.
 *
 * Network failures are deliberately NOT on this list. "Failed to fetch" in bulk means the API
 * is unreachable, and that is exactly the thing worth being told about.
 */
const IGNORED = [
  "Script error.",
  "Script error",
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications.",
];

let installed = false;
let reporting = false;
let sent = 0;
const seen = new Set<string>();

/**
 * Install the handlers. Idempotent, and a no-op unless enabled.
 *
 * `addEventListener("error")` rather than assigning `window.onerror`: same signal, and it
 * cannot silently replace a handler something else installed.
 */
export function installClientErrorReporting(options: { enabled?: boolean } = {}): void {
  if (installed) return;
  if (!(options.enabled ?? import.meta.env.PROD)) return;
  installed = true;
  window.addEventListener("error", onErrorEvent);
  window.addEventListener("unhandledrejection", onRejectionEvent);
}

/**
 * A render error that an error boundary caught, handed over by `createRoot` (see main.tsx).
 *
 * React 19 sends a CAUGHT error to `console.error` and nowhere else — only uncaught ones reach
 * `window.onerror`. Every page here renders inside `ErrorBoundary`, so without this the most
 * serious failure a customer can hit is the one failure this file would never see.
 */
export function reportCaughtError(error: unknown): void {
  report(fromValue(error, "error"));
}

// ---------------------------------------------------------------- handlers

function onErrorEvent(event: Event): void {
  /**
   * A failed image or stylesheet also fires "error" on window — with a plain Event, not an
   * ErrorEvent. This catalogue is 9,900 product photos served off the same box; a missing one
   * is a 404 to fix in the importer, not a JavaScript error, and reporting them would drown
   * every real crash.
   */
  if (!(event instanceof ErrorEvent)) return;
  try {
    /**
     * `event.error` is the real thing when the browser has one, and some events carry only a
     * message. Asking `fromValue` to describe a missing error would produce "Rejected with
     * undefined" and then WIN the `||` below, hiding the one line the event did give us.
     */
    const base = event.error instanceof Error
      ? fromValue(event.error, "error")
      : { kind: "error" as const, name: "Error", message: "", source: "", line: 0, column: 0, frames: [] };
    report({
      ...base,
      message: base.message || String(event.message ?? ""),
      source: event.filename || base.source,
      line: event.lineno || base.line,
      column: event.colno || base.column,
    });
  } catch { /* rule 1: never break the page */ }
}

function onRejectionEvent(event: PromiseRejectionEvent): void {
  try {
    report(fromValue(event.reason, "unhandledrejection"));
  } catch { /* rule 1 */ }
}

// ---------------------------------------------------------------- building a report

type Draft = {
  kind: "error" | "unhandledrejection";
  name: string;
  message: string;
  source: string;
  line: number;
  column: number;
  frames: string[];
};

/** Whatever was thrown — an Error, a string, an object, `undefined` — as something reportable. */
function fromValue(value: unknown, kind: Draft["kind"]): Draft {
  const err = value instanceof Error ? value : null;
  const frames = err?.stack ? framesOf(err.stack) : [];
  const first = frames[0] ?? "";
  // The file, line and column of the top frame, from either format — "at fn (/a.js:9:143)" and
  // "fn@/a.js:9:143". Excluding "@" from the file part is what keeps the function name out of
  // it in the Firefox/Safari one. Only used when the browser did not hand them over separately.
  const at = /([^\s()@]+):(\d+):(\d+)\)?$/.exec(first);
  return {
    kind,
    name: err?.name || "Error",
    message: err ? err.message : stringify(value),
    source: at?.[1] ?? "",
    line: Number(at?.[2] ?? 0),
    column: Number(at?.[3] ?? 0),
    frames,
  };
}

/**
 * A thrown non-Error, as text.
 *
 * `String({})` is "[object Object]", which tells nobody anything, so an object gets its keys —
 * not its values. A rejected fetch response or a caught API payload can hold an address or an
 * order; the SHAPE of the thing is what identifies where it came from.
 */
function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return `Rejected with ${String(value)}`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 8).join(", ");
    return `Rejected with an object {${keys}}`;
  }
  return `Rejected with ${typeof value}: ${String(value)}`;
}

/**
 * Stack frames, our origin removed.
 *
 * Two formats: Chrome's "    at fn (url:1:2)" and Firefox/Safari's "fn@url:1:2". Anything that
 * is neither — notably the "TypeError: message" header line Chrome puts first — is dropped, so
 * the message never gets counted twice.
 */
function framesOf(stack: string): string[] {
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^at\s/.test(line) || /^[^@\s]*@\S+/.test(line))
    .map((line) => stripOrigin(line).slice(0, MAX_FRAME_CHARS))
    .slice(0, MAX_FRAMES);
}

function stripOrigin(text: string): string {
  return text.split(location.origin).join("");
}

/**
 * The page, with nothing on it that belongs to the customer.
 *
 * pathname only — see the header for why the query string never goes anywhere. The order number
 * is removed here, on the device.
 */
function routeOf(): string {
  return location.pathname.replace(/\/TG-[A-Za-z0-9]+/gi, "/:orderNumber").slice(0, 120);
}

// ---------------------------------------------------------------- sending

function report(draft: Draft): void {
  if (!installed || reporting || sent >= MAX_REPORTS_PER_PAGE_LOAD) return;
  reporting = true; // rule 2: an error thrown below must not come back through here
  try {
    const message = draft.message.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_CHARS);
    if (!message || IGNORED.includes(message)) return;

    const source = stripOrigin(draft.source).split(/[?#]/)[0].slice(0, MAX_FRAME_CHARS);
    if (EXTENSION_SCHEME.test(source) || EXTENSION_SCHEME.test(message) ||
        draft.frames.some((f) => EXTENSION_SCHEME.test(f))) return;

    /**
     * De-duplicated on what the error IS, not on how we heard about it.
     *
     * React reports an uncaught render error through `window.reportError`, which then fires our
     * "error" listener too — so the same crash can arrive twice by two routes. Keying on the
     * name, message and top frame (all identical either way) collapses that pair into one.
     */
    const key = `${draft.name}|${message}|${draft.frames[0] ?? `${source}:${draft.line}`}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;

    send({
      kind: draft.kind,
      name: draft.name,
      message,
      route: routeOf(),
      source,
      line: draft.line,
      column: draft.column,
      frames: draft.frames,
      at: new Date().toISOString(),
    });
  } catch {
    /**
     * Nowhere useful to put this. Logging it is harmless but pointless, and reporting it is the
     * loop rule 2 exists to prevent.
     */
  } finally {
    reporting = false;
  }
}

/**
 * Same-origin POST, fire and forget.
 *
 * `sendBeacon` first because it survives the page being closed — a customer whose page just
 * broke is a customer about to leave — and because it cannot produce a promise at all, let
 * alone a rejecting one. `fetch` with `keepalive` is the fallback for browsers that refuse the
 * beacon (a full queue returns false), and its rejection is swallowed on the spot: an unhandled
 * one would fire `unhandledrejection` and start the loop this file is built to avoid.
 */
function send(payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  if (body.length > MAX_BODY_CHARS) return;

  try {
    if (typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through to fetch */ }

  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => { /* the server is unreachable; there is nobody left to tell */ });
  } catch { /* nothing else to try */ }
}
