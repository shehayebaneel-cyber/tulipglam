/**
 * Coming-soon gate.
 *
 * One environment variable puts the entire site behind `coming-soon.html`, and takes it back
 * out again. No routes are commented out, nothing is renamed, nothing is deleted — this
 * middleware is the only mechanism.
 *
 *     COMING_SOON=true          gate on — everyone except preview sees the placeholder
 *     COMING_SOON=<anything>    gate off — not even mounted (see index.ts)
 *     PREVIEW_KEY=<24+ chars>   required only while the gate is on
 *
 * DESIGN NOTES, because each of these is load-bearing:
 *
 * - **200, never a redirect.** The placeholder is served in place at whatever URL was asked
 *   for. A redirect to /coming-soon would be cached by browsers and shared caches and would
 *   still be sending people to the placeholder days after launch.
 *
 * - **Documents get HTML, everything else gets a bare 404.** Returning HTML at
 *   `/assets/index-abc123.js` — a URL served with `immutable, max-age=31536000` — risks a
 *   shared cache storing that HTML as JavaScript for a year. That is a worse failure than the
 *   one the gate is guarding against.
 *
 * - **No I/O, no database, nothing async on the request path.** Render's free tier spins the
 *   service down; the first request after idle already pays ~30s of cold start. The page is
 *   read into memory once at boot, the allowlist is a Set, and the whole gate is string
 *   comparison. It returns long before anything that could touch Prisma.
 *
 * - **The allowlist for the page's own assets is derived from the page**, so changing
 *   `coming-soon.html` never requires editing this file.
 */
import type { RequestHandler, Request } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Exactly "true" turns the gate on. Anything else — unset, "1", "yes", "TRUE " — is off. */
export const COMING_SOON = String(process.env.COMING_SOON ?? "").trim().toLowerCase() === "true";

const COOKIE_NAME = "tg_preview";
const PREVIEW_DAYS = 7;
/** A bypass protected by a guessable string is not a bypass, it is a door. */
const MIN_KEY_LENGTH = 24;

/**
 * Paths that stay reachable while the gate is on.
 *
 * `/robots.txt` and `/sitemap.xml` are here so they reach their handlers — those handlers
 * serve *different content* while gated (see index.ts), they are not simply passed through.
 */
const ALLOW_EXACT = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/robots.txt",
  "/sitemap.xml",
  // Render calls this; blocking it fails the health check and the service gets restarted.
  "/api/health",
]);

const ALLOW_PREFIX = [
  // Dead code on Render — TLS terminates at their edge, so ACME challenges never reach Express.
  // Kept so the gate stays correct if this ever moves to a host that does terminate here.
  "/.well-known/",
  // Backend work continues while customers see the placeholder. The admin *UI* still needs the
  // preview cookie, because /assets/* is gated — these two cover API access.
  "/api/admin/",
  "/api/auth/",
];

// ---------------------------------------------------------------- page

/**
 * Where `coming-soon.html` lives at runtime.
 *
 * It is authored in `web/public/`, which Vite copies into `web/dist/` at build time, so
 * production serves the dist copy. The public copy is the fallback for a dev server that has
 * never run a build. `COMING_SOON_PAGE` overrides both — used by the tests, and by any future
 * reuse of this gate as a maintenance page pointing at a different file.
 *
 * cwd is `server/` (see render.yaml `startCommand`), matching how WEB_DIST is resolved.
 */
function resolvePage(): string | null {
  // An explicit override is authoritative: if it is set and missing, that is a typo, and
  // silently serving the default page instead would hide it.
  const override = process.env.COMING_SOON_PAGE?.trim();
  if (override) return fs.existsSync(override) ? override : null;

  return [
    path.resolve(process.cwd(), "..", "web", "dist", "coming-soon.html"),
    path.resolve(process.cwd(), "..", "web", "public", "coming-soon.html"),
  ].find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Same-origin URLs the page loads, so they can be allowlisted without hardcoding them here.
 *
 * Only absolute same-origin paths are collected. Anything external — the font CDN, say — is not
 * ours to allow or block; the gate never sees those requests. Query strings and fragments are
 * trimmed so `/logo.svg?v=2` still matches the allowlisted `/logo.svg`.
 *
 * **An empty result is the expected answer, not a failure.** The shipped page is a single
 * self-contained document: inline CSS and JS, its only image a `data:` URI, fonts cross-origin.
 * Nothing here or in the boot check may treat "no same-origin references" as an error.
 */
export function assetsReferencedBy(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["'](\/[^"'#?\s]*)/gi)) found.add(m[1]);
  for (const m of html.matchAll(/url\(\s*["']?(\/[^"')#?\s]*)/gi)) found.add(m[1]);
  found.delete("/");
  return [...found];
}

// ---------------------------------------------------------------- secrets

/**
 * Constant-time comparison that is also safe against differing lengths.
 *
 * `timingSafeEqual` throws when the buffers differ in size, and guarding that with a length
 * check leaks the length. Hashing both sides first makes them always 32 bytes, so the
 * comparison is genuinely constant-time for any input.
 */
function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** The cookie carries a hash of the key, never the key itself. */
const derive = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

/** Minimal cookie reader — this is the only cookie the server reads, so no dependency for it. */
function readCookie(header: string | undefined, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return ""; }
  }
  return "";
}

// ---------------------------------------------------------------- request shape

/**
 * Is this a request for a page, as opposed to a script, image or stylesheet?
 *
 * `Sec-Fetch-Dest` is authoritative when present: browsers send it on every request and it
 * distinguishes `document` from `script`/`image`/`style` exactly. Only when it is absent —
 * curl, older clients — does this fall back to the `Accept` header.
 *
 * Consequence worth knowing: a bare `curl https://tulipglam.com/` sends a wildcard Accept
 * header, so it gets the 404 rather than the page. Use `curl -H 'Accept: text/html'` to see
 * what a browser sees. Real crawlers, Googlebot included, send `Accept: text/html,...` and
 * get the page.
 */
function isDocumentRequest(req: Request): boolean {
  const dest = req.headers["sec-fetch-dest"];
  if (typeof dest === "string" && dest.length > 0) return dest === "document";
  return String(req.headers.accept ?? "").includes("text/html");
}

// ---------------------------------------------------------------- boot

/**
 * Refuse to start rather than serve a gate that does not hold.
 *
 * Only enforced while the gate is on. Enforcing it unconditionally would mean a missing
 * PREVIEW_KEY takes production down during the state the site is in almost all the time.
 */
export function assertComingSoonConfig(): void {
  if (!COMING_SOON) return;

  const fail = (lines: string[]): never => {
    console.error(["", "FATAL: COMING_SOON=true, but the gate is not safe to run.", "", ...lines, "", "  Refusing to start.", ""].join("\n"));
    process.exit(1);
  };

  const key = (process.env.PREVIEW_KEY ?? "").trim();
  if (!key) {
    fail([
      "  PREVIEW_KEY is not set. Without it there is no way to preview the real site,",
      "  and an empty key would let an empty ?preview= through.",
      "",
      "  Generate one with:",
      '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    ]);
  }
  if (key.length < MIN_KEY_LENGTH) {
    fail([
      `  PREVIEW_KEY is ${key.length} characters; the minimum is ${MIN_KEY_LENGTH}.`,
      "  A guessable preview key is a public bypass of the whole gate.",
    ]);
  }
  if (!resolvePage()) {
    fail([
      "  coming-soon.html was not found. Looked in:",
      "    $COMING_SOON_PAGE",
      "    web/dist/coming-soon.html    (built — Vite copies web/public into web/dist)",
      "    web/public/coming-soon.html  (source)",
      "",
      "  With the gate on and no page to serve, every request would fail.",
    ]);
  }
}

// ---------------------------------------------------------------- gate

/**
 * Build the gate. Only called when COMING_SOON is true — index.ts does not mount it otherwise,
 * so an ungated request does not even pay for a function call.
 */
export function comingSoonGate(): RequestHandler {
  const pageFile = resolvePage();
  if (!pageFile) throw new Error("comingSoonGate() called without a coming-soon.html; call assertComingSoonConfig() first");

  // Read once. Every gated request is then a buffer write with no disk access.
  const page = fs.readFileSync(pageFile);
  const expected = derive((process.env.PREVIEW_KEY ?? "").trim());

  const pageAssets = assetsReferencedBy(page.toString("utf8"));
  const allowExact = new Set([...ALLOW_EXACT, ...pageAssets]);

  console.log(
    `COMING_SOON is ON — serving ${path.relative(process.cwd(), pageFile)} to everyone without a preview cookie.\n` +
    `  allowlisted: ${[...ALLOW_EXACT].join(" ")} ${ALLOW_PREFIX.map((p) => `${p}*`).join(" ")}\n` +
    `  from the page: ${pageAssets.length ? pageAssets.join(" ") : "(nothing same-origin — the page is self-contained)"}`,
  );

  const allowed = (p: string) => allowExact.has(p) || ALLOW_PREFIX.some((prefix) => p.startsWith(prefix));

  /**
   * Everything this gate branches on. A shared cache that ignores any one of these can serve
   * the wrong variant to the wrong person:
   *
   *   Cookie          — or one previewer's real page gets handed to every customer.
   *   Accept          — or the bare 404 meant for a script request gets served to a browser
   *                     asking for HTML, which shows a broken site while the gate is on.
   *   Sec-Fetch-Dest  — same reason as Accept; it is the header actually consulted first.
   */
  const VARY = "Cookie, Accept, Sec-Fetch-Dest";

  /** The placeholder, in place, at whatever URL was asked for. */
  const servePage = (res: Parameters<RequestHandler>[1]) => {
    res.status(200);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Revalidate every time. A shared cache must never hold this longer than one request,
    // or people keep seeing it after launch.
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.setHeader("Vary", VARY);
    // Set explicitly so a HEAD reports the same length a GET would. `curl -sI` is the launch
    // verification command, and Node drops the body for HEAD on its own — without this the
    // header would simply be absent there.
    res.setHeader("Content-Length", String(page.length));
    res.end(page);
  };

  return (req, res, next) => {
    // ---- preview grant / exit -------------------------------------------------
    const preview = typeof req.query.preview === "string" ? req.query.preview : "";
    if (preview) {
      const clean = req.path; // the same URL, minus the key
      if (preview === "exit") {
        res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
        res.setHeader("Cache-Control", "no-store");
        return res.redirect(302, clean);
      }
      if (sameSecret(preview, (process.env.PREVIEW_KEY ?? "").trim())) {
        res.setHeader(
          "Set-Cookie",
          `${COOKIE_NAME}=${expected}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${PREVIEW_DAYS * 24 * 60 * 60}`,
        );
        res.setHeader("Cache-Control", "no-store");
        // Redirect to strip the key from the URL, so it does not sit in history, in a Referer
        // header, or in a screenshot. This is the one redirect in the gate and it only ever
        // fires for a correct key.
        return res.redirect(302, clean);
      }
      // Wrong key: fall through and be indistinguishable from no key at all. No message, no
      // different status, no cookie.
    }

    // ---- already previewing ---------------------------------------------------
    const cookie = readCookie(req.headers.cookie, COOKIE_NAME);
    if (cookie && sameSecret(cookie, expected)) return next();

    // ---- allowlist ------------------------------------------------------------
    if (allowed(req.path)) return next();

    // ---- gated ----------------------------------------------------------------
    if (isDocumentRequest(req)) return servePage(res);

    // Not a document. A bare 404 that nothing will cache — see the header comment for why
    // this must not be the HTML. `Vary` is belt-and-braces on top of `no-store`: an
    // intermediary that ignores the first directive should still not hand this to a browser
    // that asked for a page.
    res.status(404);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Vary", VARY);
    return res.end();
  };
}
