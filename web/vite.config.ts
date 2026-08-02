import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { analyseBundle } from "./scripts/analyse-bundle.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * TulipGlam — web dev server on 5330, API on 4230.
 *
 * ── WHY THE PROXY FORGES A PREVIEW COOKIE ──────────────────────────────────────────
 *
 * With COMING_SOON=true the API gates everything that is not allowlisted, and `/api/loyalty/*`
 * is deliberately not allowlisted — it is customer data, and allowlisting it would publish it
 * while the site is meant to be dark.
 *
 * In production you get past the gate by visiting `/?preview=<PREVIEW_KEY>`, which sets a
 * `tg_preview` cookie on the site's own origin. That does not work in dev: the browser is
 * talking to Vite on :5330 and the gate lives on :4230, so a cookie set by the API is scoped to
 * an origin the app never visits. The result is a rewards page that renders and then 404s on
 * every request — which looks exactly like a broken endpoint, and cost me twenty minutes before
 * I worked out it was the gate doing its job.
 *
 * So the proxy attaches the cookie itself, server-side, to every request it forwards. It derives
 * the value the same way `comingSoon.ts` does — sha256 of the key, hex — reading PREVIEW_KEY
 * straight out of `server/.env` so there is nothing extra to configure and no second copy of the
 * secret to keep in step.
 *
 * Dev-only in the strongest sense: this file is not part of the production build, and in
 * production the API serves `web/dist` itself with no proxy in the picture at all.
 */
function previewCookie(): string | null {
  try {
    const env = readFileSync(new URL("../server/.env", import.meta.url), "utf8");
    // Tolerant of `KEY=value`, `KEY="value"` and trailing whitespace, because .env files are
    // edited by hand and an unbalanced quote in this very file has already cost this project a
    // production outage once.
    const line = env.split(/\r?\n/).find((l) => /^\s*PREVIEW_KEY\s*=/.test(l));
    if (!line) return null;
    const key = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "").trim();
    if (!key) return null;
    return createHash("sha256").update(key, "utf8").digest("hex");
  } catch {
    return null; // no .env, or unreadable — dev works exactly as it did before
  }
}

const cookie = previewCookie();
if (!cookie) {
  console.log("[vite] No PREVIEW_KEY found in server/.env — proxied API requests carry no preview cookie.");
  console.log("[vite] Harmless unless COMING_SOON=true, in which case gated endpoints will answer 404.");
}

export default defineConfig({
  // ANALYSE=1 adds a build-only reporter that writes bundle-report.txt. Off by default so a
  // normal build is byte-identical to what it was.
  plugins: [react(), tailwindcss(), ...(process.env.ANALYSE ? [analyseBundle()] : [])],
  server: {
    port: 5330,
    /**
     * Don't watch the generated image derivatives.
     *
     * `public/i/` holds 39,692 WebP files built by `scripts/image-build.mjs`. Vite's watcher
     * tries to follow everything under `public/`, and writing that many files during a build
     * wedged the dev server hard enough that it stopped answering requests entirely — which
     * presented as "the site is down" rather than as anything to do with images.
     *
     * They are build output, not source: nothing under `public/i` is ever hand-edited, and a
     * rebuild is a deliberate command. There is nothing for a watcher to usefully react to.
     */
    watch: { ignored: ["**/public/i/**", "**/public/products/**"] },
    proxy: {
      "/api": {
        target: "http://localhost:4230",
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            if (!cookie) return;
            // Appended, not assigned: the browser may already be sending cookies of its own and
            // replacing the header would drop them.
            const existing = proxyReq.getHeader("cookie") as string | undefined;
            proxyReq.setHeader("cookie", [existing, `tg_preview=${cookie}`].filter(Boolean).join("; "));
          });
        },
      },
      "/uploads": "http://localhost:4230",
    },
  },
});
