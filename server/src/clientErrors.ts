/**
 * Errors from customers' browsers — reported to us, and to nobody else.
 *
 * A 500 on the server has been visible since observe.ts existed. A crash on a customer's phone
 * has not: the page shows "Something broke on this page", the customer leaves, and nobody here
 * ever learns. This is the missing half, built to the same constraint as the rest of it.
 *
 * ── THE SENTENCE THIS MUST NOT MAKE FALSE ──────────────────────────────────────────
 *
 * The privacy policy (POLICIES.txt §3, "What we don't do") says:
 *
 *     "There is no advertising or analytics service on this site — no tracking pixel, no
 *      third-party script, and nothing loaded from another company's servers. When you browse
 *      TulipGlam, your browser talks to us and to nobody else."
 *
 * with the note underneath: "If analytics is ever added, that paragraph has to change in the
 * same commit that adds it."
 *
 * This is not analytics, and the test is one line: NOTHING IS RECORDED WHEN THE PAGE WORKS.
 * There is no page view here, no session, no funnel, no identifier of any kind. A row exists
 * only because something threw. Everything below is that promise winning an argument:
 *
 *  - **Same-origin, first-party.** The browser POSTs to this server. Nothing is loaded from
 *    anywhere else and nothing is forwarded anywhere else.
 *  - **No identifier.** No cookie is read, no localStorage id is accepted, and the payload has
 *    no field that could carry one. Two reports from the same phone are indistinguishable from
 *    two reports from two phones — which is exactly why this cannot count visitors.
 *  - **The IP is not stored.** It reaches the rate limiter's in-memory bucket key, the same as
 *    login and registration already do, and goes nowhere else. It is never written to the
 *    database and never logged.
 *  - **The user agent is coarsened HERE**, from the header every request carries anyway. The
 *    raw string never leaves `uaFamily` and never reaches the database. No version number:
 *    "Safari 26.1 on iOS 26" narrows a person down in a way "Safari · iOS" does not, and that
 *    is the deliberate cost — see the note in `uaFamily`.
 *  - **The route, never the URL.** `/search?q=…` carries what the customer typed and
 *    `/reset-password?token=…` carries a credential. The client sends `location.pathname` only,
 *    with the order number stripped before it leaves the device (see web/src/lib/clientErrors.ts).
 *
 * ── IT REUSES THE ERROR STORE, AND STAYS DISTINGUISHABLE INSIDE IT ─────────────────
 *
 * Rows go into `ErrorLog` via `recordError`, so there is one place an operator looks. They are
 * written with `method: "BROWSER"` and `status: 0`, and the pulse renders `{method} {path}` —
 * so "BROWSER /product/:slug" sits beside "GET /api/products" and the difference between *my
 * server broke* and *someone's phone broke* is legible at a glance. The method is also part of
 * the fingerprint, so a client error can never merge into a server error's group.
 *
 * ── AND IT IS BOUNDED IN FOUR PLACES ───────────────────────────────────────────────
 *
 * A render loop throws thousands of times a second, and the client is the least trustworthy
 * caller this server has:
 *
 *  1. the browser caps itself per page load and de-duplicates (web/src/lib/clientErrors.ts),
 *  2. `rateLimit` caps reports per IP per window,
 *  3. the body is size-capped and every field is truncated on the way in,
 *  4. rows are grouped by fingerprint, and NEW fingerprints are budgeted per hour — otherwise
 *     one bad deploy, or one bored person with curl, fills the table and hides the five real
 *     problems it exists to show.
 */
import express from "express";
import type { PrismaClient } from "@prisma/client";
import { recordError, routeShape, fingerprintOf } from "./observe.js";
import { rateLimit, WINDOW, type LimitOptions } from "./rateLimit.js";

/**
 * The limit for this endpoint.
 *
 * It lives here rather than in `LIMITS` only because that file is not this change's to edit;
 * side by side with the others is the better home for it and moving it is a one-line follow-up.
 *
 * Sized like the rest of them — for carrier-grade NAT, where one address is routinely a whole
 * apartment block. Losing reports past the cap costs nothing: after the first few, every further
 * report of a broken page is the same fingerprint, and the count on that row is already moving.
 */
export const CLIENT_ERROR_LIMIT: LimitOptions = { name: "client-error", max: 30, windowMs: WINDOW };

/**
 * Big enough for a message and four stack frames, small enough to be worth refusing.
 *
 * Checked against `Content-Length` before anything is parsed. It does NOT undo the app-level
 * `express.json({ limit: "12mb" })` — that parser runs first and has already read the body by
 * the time this handler sees it — so this is a cap on what we will WORK with, not on what the
 * process will buffer. See the follow-up note if that distinction ever starts to matter.
 */
export const MAX_BODY_BYTES = 4096;

const MAX_MESSAGE = 300;
const MAX_NAME = 40;
const MAX_ROUTE = 120;
const MAX_SOURCE = 200;
const MAX_FRAMES = 4;
const MAX_FRAME = 200;

/** Not a verb. Reads as one in the pulse's `{method} {path}`, which is the point. */
const CLIENT_METHOD = "BROWSER";
/**
 * There is no HTTP status: nothing failed on the server. 0 says that, where the column's
 * default of 500 would claim a response this server never sent.
 */
const CLIENT_STATUS = 0;

/** What a browser is allowed to tell us. Every field is optional except the message. */
export type ClientReport = {
  kind: "error" | "unhandledrejection";
  name: string;
  message: string;
  route: string;
  source: string;
  line: number;
  column: number;
  frames: string[];
  /** The device's own clock, as an ISO string, or "" when it sent something unusable. */
  at: string;
};

/**
 * Browser-extension URLs.
 *
 * This page loads no third-party script, so a frame from another scheme did not come from
 * anything we shipped. It is somebody's ad blocker or password manager, it is not our bug, and
 * a table full of them would bury the ones that are.
 */
const EXTENSION_SCHEME = /(?:chrome|moz|safari-web|ms-browser)-extension:\/\//i;

/** An error name is a JavaScript identifier. Anything else is junk or an attempt at something. */
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_$]*$/;

/**
 * One line of plain text, control characters removed.
 *
 * Newlines are stripped rather than escaped because the message becomes the FIRST LINE of a
 * stored stack trace: a crafted `"boom\n    at reallyImportantFile.ts:1"` would otherwise forge
 * frames that never ran, into the one place an operator goes to be told the truth.
 */
function oneLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Matching control characters IS the point: this
  // is the sanitiser that stops a crafted message forging stack frames into the one place an
  // operator goes to be told the truth. Narrowing the range to satisfy the rule would remove
  // exactly the protection the rule imagines it is warning about.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function intOf(value: unknown, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), max);
}

/**
 * Storefront paths, collapsed to the route that produced them.
 *
 * Without this a bug on the product page is one row per product — 9,672 of them — and the
 * grouping does nothing, which is the same lesson `routeShape` already learned for the API.
 * The dynamic segments are the app's own (web/src/App.tsx); `routeShape` then handles order
 * numbers, numeric ids and long opaque tokens for everything else.
 */
const DYNAMIC_SEGMENT: Record<string, string> = {
  product: ":slug",
  category: ":slug",
  order: ":orderNumber",
  track: ":orderNumber",
};

export function clientRouteShape(path: string): string {
  const parts = path.split("/");
  const head = parts[1] ?? "";
  const placeholder = DYNAMIC_SEGMENT[head];
  return routeShape(placeholder && parts.length > 2 ? `/${head}/${placeholder}` : path);
}

function routeOf(value: unknown): string {
  const raw = oneLine(value, MAX_ROUTE + 80).split(/[?#]/)[0];
  // `//evil.example` is a protocol-relative URL wearing a path's clothes.
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/(unknown)";
  return clientRouteShape(raw).slice(0, MAX_ROUTE);
}

/**
 * The file a frame points at, as a same-origin path.
 *
 * The client strips our own origin before sending, so anything still carrying a scheme is from
 * somewhere we did not ship. Dropped rather than stored: we cannot fix it and it is not ours.
 */
function sourceOf(value: unknown): string {
  const raw = oneLine(value, MAX_SOURCE).split(/[?#]/)[0];
  if (!raw.startsWith("/") || raw.includes("://")) return "";
  return raw;
}

function timestampOf(value: unknown): string {
  const raw = oneLine(value, 40);
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

/**
 * Turn whatever arrived into a report, or refuse it.
 *
 * Pure and exported so it can be exercised without a database or a socket. Returning `null`
 * means "record nothing" — the caller still answers 204, because a browser can do nothing with
 * a complaint about its own crash report and an endpoint that answers differently for a bad
 * payload is one a script can probe.
 */
export function parseClientReport(body: unknown): ClientReport | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  const message = oneLine(b.message, MAX_MESSAGE);
  if (!message) return null;

  /**
   * "Script error." is what a browser reports for a script it will not describe, because the
   * script came from another origin. This page loads none, so it is an extension, and it
   * carries no message, no file and no line — a row that says only that something, somewhere,
   * broke.
   */
  if (message === "Script error." || message === "Script error") return null;

  const source = sourceOf(b.source);
  const frames = (Array.isArray(b.frames) ? b.frames : [])
    .map((f) => oneLine(f, MAX_FRAME))
    // A frame with a scheme left in it is cross-origin; see sourceOf.
    .filter((f) => f.length > 0 && !f.includes("://"))
    .slice(0, MAX_FRAMES);

  if (EXTENSION_SCHEME.test(message) || EXTENSION_SCHEME.test(String(b.source ?? "")) ||
      (Array.isArray(b.frames) && b.frames.some((f) => EXTENSION_SCHEME.test(String(f))))) return null;

  const name = oneLine(b.name, MAX_NAME);

  return {
    kind: b.kind === "unhandledrejection" ? "unhandledrejection" : "error",
    name: ERROR_NAME.test(name) ? name : "Error",
    message,
    route: routeOf(b.route),
    source,
    line: intOf(b.line, 10_000_000),
    column: intOf(b.column, 10_000_000),
    frames,
    at: timestampOf(b.at),
  };
}

/**
 * A coarse browser family, derived from the header and immediately thrown away.
 *
 * ORDER MATTERS: Edge, Opera and Samsung Internet all put "Chrome" in their user agent, and
 * Chrome puts "Safari" in its. Checking the specific ones first is the difference between a
 * useful bucket and everything reading as Chrome.
 *
 * NO VERSION NUMBER, deliberately. A browser and OS family are two of the lowest-entropy facts
 * about a visitor; a full version string is one of the highest, and it is the raw material of
 * fingerprinting. The cost is real — a bug that only affects one Safari release will not
 * announce itself here — and the stack's file and line is the substitute for it.
 */
export function uaFamily(ua: string): string {
  const s = ua ?? "";
  const browser =
    /SamsungBrowser/.test(s) ? "Samsung Internet"
    : /\b(?:Edg|EdgA|EdgiOS)\//.test(s) ? "Edge"
    : /\bOPR\/|\bOpera/.test(s) ? "Opera"
    : /\b(?:Firefox|FxiOS)\//.test(s) ? "Firefox"
    : /\b(?:Chrome|CriOS)\//.test(s) ? "Chrome"
    : /\bSafari\//.test(s) ? "Safari"
    : "other browser";
  const os =
    /iPhone|iPad|iPod|\biOS\b/.test(s) ? "iOS"
    : /Android/.test(s) ? "Android"
    : /Windows/.test(s) ? "Windows"
    : /Mac OS X|Macintosh/.test(s) ? "macOS"
    : /Linux/.test(s) ? "Linux"
    : "other OS";
  return `${browser} · ${os}`;
}

/**
 * The stack as it will be stored.
 *
 * Shaped like a real one — `Name: message` then indented frames — because that is what the
 * operator's eye expects and what `recordError` already trims (first six lines, 1,500 chars).
 * The browser family and the route live on line two, so the six lines that survive carry the
 * three things a phone crash needs: what broke, where in the code, and on what.
 *
 * `recordError` overwrites message and stack on every recurrence, so this always describes the
 * MOST RECENT occurrence — "last seen on Safari · iOS", not the first.
 */
function stackFor(report: ClientReport, ua: string): string {
  const kind = report.kind === "unhandledrejection" ? " · unhandled promise rejection" : "";
  // The device clock is recorded because `lastSeen` is server time: a stack that makes no sense
  // next to a clock that is hours out is a different problem from a stack that makes no sense.
  const clock = report.at ? ` · device clock ${report.at}` : "";
  const lines = [
    `${report.name}: ${report.message}`,
    `    browser: ${ua} · route ${report.route}${kind}${clock}`,
    ...(report.source ? [`    at ${report.source}:${report.line}:${report.column}`] : []),
    ...report.frames,
  ];
  return lines.slice(0, 6).join("\n");
}

// ---------------------------------------------------------------- the budget for new problems

/**
 * How many DISTINCT problems an hour this endpoint may open.
 *
 * Grouping stops one broken loop from filling the table. It does not stop a thousand DIFFERENT
 * messages, which is one `for` loop away for anyone who finds the endpoint, and would push
 * every real row off the operator's screen. Repeats of a problem already admitted this hour
 * always count — it is only NEW ones that are budgeted.
 *
 * Twenty is far above a real breakage (a bad deploy produces a handful of distinct errors) and
 * far below useful as a flood. The set holds at most that many strings, so the memory is
 * bounded by the constant rather than by the traffic.
 */
export const NOVEL_FINGERPRINTS_PER_HOUR = 20;
const HOUR = 60 * 60 * 1000;

let budgetSince = Date.now();
let admitted = new Set<string>();
let droppedThisHour = 0;

function admit(fingerprint: string, now: number): boolean {
  if (now - budgetSince >= HOUR) {
    budgetSince = now;
    admitted = new Set();
    droppedThisHour = 0;
  }
  if (admitted.has(fingerprint)) return true;
  if (admitted.size >= NOVEL_FINGERPRINTS_PER_HOUR) {
    droppedThisHour++;
    // Once per hour, not once per report: a flood must not become a second flood in the logs.
    if (droppedThisHour === 1) {
      console.warn(`[clientErrors] ${NOVEL_FINGERPRINTS_PER_HOUR} distinct browser errors already this hour — dropping new ones until the hour turns.`);
    }
    return false;
  }
  admitted.add(fingerprint);
  return true;
}

/** For a future pulse panel, and for tests. Counts only; nothing here identifies anyone. */
export function clientErrorBudget(): { since: Date; problems: number; dropped: number } {
  return { since: new Date(budgetSince), problems: admitted.size, dropped: droppedThisHour };
}

/** Exported for tests, which need a clean slate between cases — same as `_resetAllBuckets`. */
export function _resetClientErrorBudget(): void {
  budgetSince = Date.now();
  admitted = new Set();
  droppedThisHour = 0;
}

// ---------------------------------------------------------------- writing

/**
 * Record one browser error, grouped with its own kind.
 *
 * The `Error` is built rather than thrown: `recordError` and `fingerprintOf` both read `name`,
 * `message` and `stack` off one, so constructing one is how this reuses the existing store
 * instead of growing a second.
 *
 * The fingerprint is method + route + name + message. It deliberately does NOT include the
 * source file, because every deploy renames `/assets/index-<hash>.js` — a fingerprint carrying
 * the filename would split one long-running bug into a fresh row per release, which is the
 * table-filling this is supposed to prevent.
 */
export async function recordClientError(
  db: PrismaClient,
  report: ClientReport,
  ua: string,
  now = new Date(),
): Promise<"recorded" | "over-budget"> {
  const err = new Error(report.message);
  err.name = report.name;
  err.stack = stackFor(report, ua);

  const fingerprint = fingerprintOf(CLIENT_METHOD, report.route, err);
  if (!admit(fingerprint, now.getTime())) return "over-budget";

  await recordError(db, { method: CLIENT_METHOD, path: report.route, status: CLIENT_STATUS, err }, now);
  return "recorded";
}

// ---------------------------------------------------------------- the endpoint

/**
 * Mount with:  app.use("/api/client-errors", clientErrorsRouter(db));
 *
 * Anywhere after `app.use(express.json(...))` and before the SPA catch-all.
 */
export function clientErrorsRouter(db: PrismaClient): express.Router {
  const router = express.Router();

  router.post("/", rateLimit(CLIENT_ERROR_LIMIT), (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    const declared = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return res.status(413).end();

    const report = parseClientReport(req.body);
    if (report) {
      /**
       * Not awaited, and it cannot reject: `recordError` swallows its own failures. Same rule
       * as the express error handler this sits beside — the thing that records a breakage must
       * never be able to cause one, and a customer's browser is not waiting for an answer.
       */
      void recordClientError(db, report, uaFamily(String(req.headers["user-agent"] ?? ""))).catch(() => {});
    }

    // 204 whether it was recorded, dropped as junk, or dropped over budget. See parseClientReport.
    return res.status(204).end();
  });

  /**
   * Anything else under this mount answers here.
   *
   * Without it, `GET /api/client-errors` falls through to the SPA catch-all and is served the
   * storefront's index.html with a 200 — the exact trap index.ts documents, where an
   * unmatched path under a mounted prefix quietly becomes a page.
   */
  router.use((_req, res) => { res.status(404).json({ error: "Not found" }); });

  return router;
}
