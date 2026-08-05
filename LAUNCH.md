# Launch

Two procedures. **Going dark** puts the site behind the coming-soon page. **Going live** takes
it back out. One environment variable does both; nothing else changes, and no code is deployed.

Everything is set in **Render Dashboard → the `tulipglam` service → Environment**. Saving there
triggers a redeploy on its own — you do not need to push anything.

> If a step's output doesn't match what's written here, **stop and read [Something looks
> wrong](#something-looks-wrong)** rather than continuing. Nothing in either procedure is
> urgent enough to push through a surprise.

---

## 1 · Going dark

Turning the gate on for the first time.

**Before you start**, have your `PREVIEW_KEY` to hand — the long random string. It is not in
this repository and never should be. Without it you cannot get back into the real site, and
the server will refuse to start.

1. **Add both variables in a single save.** Environment → *Add Environment Variable*, twice:

   | Key | Value |
   |---|---|
   | `PREVIEW_KEY` | your long random string |
   | `COMING_SOON` | `true` |

   Add them **together and save once**. Saving `COMING_SOON=true` on its own starts a deploy
   that refuses to boot, because a gate with no way past it is a mistake the server declines to
   make. (Render keeps the current version running when a new deploy fails its health check, so
   this is recoverable — but it wastes ten minutes at 2am.)

2. **Wait for the deploy to go green.** Events tab → the newest deploy reads **Live**. Usually
   3–5 minutes. Do not test anything before it does; you will be testing the old version.

3. **Confirm the placeholder is serving.**

   ```bash
   curl -s  -H 'Accept: text/html' https://tulipglam.com/ | grep -c 'Opening soon'   # 1
   curl -sI -H 'Accept: text/html' https://tulipglam.com/ | grep -iE 'HTTP|cache-control|vary'
   ```

   The first must print `1`. The second must show a **200**, and these three header values,
   which do not change:

   ```
   Cache-Control: public, max-age=0, must-revalidate
   Vary: Cookie, Accept, Sec-Fetch-Dest
   ```

   Ignore `Content-Length` — it moves whenever the page's CONFIG is edited and means nothing
   here.

   **200 is correct — not a redirect and not 503.** Google should index this page so people
   searching "TulipGlam" find it. If you see `301`, `302` or `Location:`, stop.

   *The `-H 'Accept: text/html'` is required.* Bare `curl` asks for anything, which the gate
   treats as a script request and answers with 404. That is deliberate: serving HTML at
   `/assets/index-abc123.js` would poison a cache for a year.

4. **Confirm the shop is actually shut.** Every one of these must return the placeholder, and
   the last must return nothing at all:

   ```bash
   curl -s -H 'Accept: text/html' https://tulipglam.com/product/anything | grep -c "Opening soon"   # 1
   curl -s -H 'Accept: text/html' https://tulipglam.com/checkout        | grep -c "Opening soon"   # 1
   curl -s https://tulipglam.com/api/products                           | head -c 100             # (empty)
   ```

   If `/api/products` returns product data, the gate is not on. Stop.

5. **Confirm Render can still see the service.**

   ```bash
   curl -s https://tulipglam.com/api/health     # {"ok":true}
   ```

   This one is never gated. If it returns the placeholder the service will start failing its
   health check and restarting. Stop.

6. **Let yourself in.** In a browser, visit:

   ```
   https://tulipglam.com/?preview=YOUR_PREVIEW_KEY
   ```

   You should land on the **real homepage**, at `https://tulipglam.com/` — the key is stripped
   from the address bar on purpose, so it doesn't linger in history or get screenshotted. Click
   into a product and check the price loads.

   Your access lasts **7 days**. Re-visit the same URL to renew it.

7. **Check it from a phone on mobile data** — not your own laptop, not your home wifi. You
   should see the coming-soon page. This is the only step that tests what a customer sees.

8. **Confirm the crawler files switched over.**

   ```bash
   curl -s https://tulipglam.com/robots.txt                    # "Allow: /$" then "Disallow: /"
   curl -s https://tulipglam.com/sitemap.xml | grep -c "<loc>" # 1
   ```

   The sitemap drops to a single URL on purpose. Offering Google 8,488 URLs that all return the
   same placeholder is how a site arrives at launch already carrying a duplicate-content
   problem.

**To undo:** set `COMING_SOON` to `false` and save. That is [Going live](#2--going-live).

---

## 2 · Going live

Taking the gate off. Run this when the store is ready to sell.

1. **Flip the switch.** Environment → `COMING_SOON` → change `true` to **`false`** → save.

   > **One thing to know before you do.** `render.yaml` sets `COMING_SOON: "true"` as the
   > blueprint default, so **re-syncing the blueprint will put the gate back on** and take the
   > store offline behind the placeholder. That is deliberate — the two failure directions are
   > not equal. Re-gating a live shop is an outage you spot in seconds and undo with this same
   > toggle; un-gating an unfinished one cannot be undone, because you cannot un-publish what a
   > crawler already read. If you re-sync after going live, come back here and flip it again.

   Leave `PREVIEW_KEY` where it is. It is ignored while the gate is off, and you will want it
   again if you ever put the site into maintenance mode.

2. **Wait for the deploy to go green.** Events tab → newest deploy reads **Live**. 3–5 minutes.

3. **Confirm the real site is serving.**

   ```bash
   curl -s -H 'Accept: text/html' https://tulipglam.com/ | grep -c 'id="root"'   # 1
   ```

   `1` means the real shop. `0` means you are still getting the placeholder — the deploy has
   not finished, so wait and repeat. The reverse also works if you prefer a positive result:

   ```bash
   curl -s -H 'Accept: text/html' https://tulipglam.com/ | grep -c 'Opening soon'   # 0
   ```

   (`grep -c` exits non-zero when it prints `0`, so your shell may flag it as failed. Read the
   number, not the exit status — `0` here is the answer you want.)

   > **Do not judge this by response size.** `Content-Length` changes every time the
   > coming-soon page's CONFIG is edited — adding an Instagram handle changes it — so any
   > number written down here would be wrong within a month. The real homepage is also
   > *smaller* than the placeholder, because the shop is rendered in the browser, so "bigger
   > number = real site" is backwards as well as brittle. Use the `grep` above; it stays true
   > no matter what either page grows into.

4. **Check the edge cache is not holding the placeholder.**

   ```bash
   curl -sI -H 'Accept: text/html' https://tulipglam.com/ | grep -i cf-cache-status
   ```

   Expect **`cf-cache-status: DYNAMIC`**.

   `DYNAMIC` means Cloudflare is passing HTML straight through and caching nothing — which is
   what we want, and what the `must-revalidate` header on the placeholder was there to ensure.

   **If it says `HIT`, stop and do not announce the launch.** A `HIT` on HTML means the edge is
   serving a stored copy, and it may be the placeholder. See [Something looks
   wrong](#something-looks-wrong) — we cannot purge this cache ourselves.

5. **Confirm the catalogue answers.**

   ```bash
   curl -s 'https://tulipglam.com/api/products?limit=1' | grep -c priceCents   # 1
   ```

6. **Hard refresh from a clean browser.** Not the one you previewed in — it holds a cookie that
   would have let you through the gate anyway, so it proves nothing. Use a private window, or a
   phone that has never visited the site, and load `https://tulipglam.com/`.

   You should see the shop. Click a product, add it to the bag, and open the checkout.

7. **Confirm the crawler files came back.**

   ```bash
   curl -s https://tulipglam.com/robots.txt                    # the full Disallow list
   curl -s https://tulipglam.com/sitemap.xml | grep -c "<loc>" # thousands, not 1
   ```

8. **Announce it.** Not before step 6 passes on a device that never held the preview cookie.

**To undo:** set `COMING_SOON` back to `true`. The placeholder returns on the next deploy.

---

## Something looks wrong

**The deploy failed and the logs say `FATAL: COMING_SOON=true, but the gate is not safe to
run`.** The server refused to start, deliberately. The message says which of the three reasons
it was: `PREVIEW_KEY` missing, `PREVIEW_KEY` shorter than 24 characters, or `coming-soon.html`
missing from the build. Fix that variable and save again. Your live site is unaffected — Render
does not retire a working deploy for one that fails to boot.

**`cf-cache-status: HIT` on an HTML response.** Cloudflare sits in front of Render, but it is
**Render's Cloudflare, not ours** — `tulipglam.com` points at Render through Namecheap DNS, and
we have no Cloudflare account for this domain and therefore no purge button. There is no purge
command to run. What to do instead:

1. Wait 60 seconds and re-check — the placeholder is served `max-age=0, must-revalidate`, so
   nothing should hold it longer than one request.
2. Check a cache-busting URL: `curl -sI -H 'Accept: text/html' 'https://tulipglam.com/?x=1'`.
   If that returns the real site, the origin is correct and only a cached entry is stale.
3. If a `HIT` persists past a few minutes, open a Render support ticket. Do not announce.

**`curl` returns 404 and you expected the page.** You left off `-H 'Accept: text/html'`. See
step 3 of Going dark.

**You are locked out of your own site.** Visit `https://tulipglam.com/?preview=YOUR_KEY` again.
If the key is lost, set a new `PREVIEW_KEY` in Render — any 24+ character random string —
and save.

**You want out of preview mode** (to see what customers see, in the same browser):
`https://tulipglam.com/?preview=exit`.

---

## Reference

| | |
|---|---|
| The switch | `COMING_SOON` — `true` gates the site, anything else does not |
| The way in | `https://tulipglam.com/?preview=<PREVIEW_KEY>` · lasts 7 days · `?preview=exit` to leave |
| The page | `web/public/coming-soon.html` — one self-contained file, no same-origin assets |
| Never gated | `/api/health`, `/api/admin/*`, `/api/auth/*`, `/robots.txt`, `/sitemap.xml`, `/favicon.*`, `/.well-known/*` |
| Verify it all | `cd server && node scripts/test-coming-soon.mjs` — starts its own servers, writes nothing |

**Editing the coming-soon page's WhatsApp number, Instagram, TikTok or signup endpoint:** those
are the `CONFIG` block at the very bottom of `web/public/coming-soon.html`. Change only those
lines, commit, and the next deploy picks it up. A test asserts the page is served byte-for-byte
as committed, so it will fail if anything else in the file moves.
