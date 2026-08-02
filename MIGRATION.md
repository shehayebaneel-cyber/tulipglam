# Migration: Render + Neon → Cloudflare + Hetzner

**Two vendors, total.** Cloudflare (DNS, CDN, R2) and Hetzner (compute, Postgres on the box).
Neon Frankfurt is withdrawn; this supersedes it.

The property Neon was being defended for — *data I can un-delete* — does not disappear with
Neon. It moves to us, and it is a **condition of cutover**, not a follow-up. Sections 1–3 are
that condition. Nothing goes live on the new stack until they pass.

---

## 1 · The number: maximum data loss is **60 minutes**

If the box dies at the worst possible moment, **up to one hour of orders, customers, ledger
entries and settings changes is gone.** That is the figure to sign or reject.

**Cadence: a full `pg_dump` every hour, on the hour, pushed to Cloudflare R2.**

Worst case is a failure at :59 against a dump taken at :00 — 59 minutes of writes. At launch
volume that is realistically zero orders; the number matters when volume arrives, and the
trigger for tightening it is below.

### Why hourly full dumps and not continuous WAL archiving

WAL archiving would give roughly a **5-minute** window, and it is the right answer eventually.
It is the wrong answer on day one for a specific reason: **if WAL shipping stalls, Postgres
keeps the un-archived segments on local disk and the disk fills.** A stalled backup then takes
down the live database. On a 40 GB box that is a real failure mode, and it converts a backup
problem into an outage — the opposite of what backups are for.

Hourly dumps have no such coupling. A dump that fails leaves the database entirely unaffected;
you lose a restore point, not a shop.

**Upgrade trigger: when the store is averaging more than one order per hour, or after the box
has run 30 days without incident — whichever comes first.** At that point add WAL archiving
with a disk-usage alarm, and the window drops to ~5 minutes.

### Retention, and where it lives

| | |
|---|---|
| Hourly | kept 48 hours |
| Daily (the 03:00 dump, promoted) | kept 14 days |
| Weekly (Sunday's, promoted) | kept 8 weeks |

About 70 objects. The catalogue is large in row count but small on disk — a compressed custom-
format dump is tens of megabytes — so this sits inside R2's free tier with room to spare.

**R2 rather than a Hetzner Storage Box.** Both stay inside the two vendors, but a Storage Box is
still Hetzner: a billing problem, an account suspension or a regional incident takes the backup
with the box it was protecting. R2 is a genuinely different blast radius, which is the entire
point of a backup leaving the machine.

**The R2 token is write-and-list only.** A token that can delete is a token that can be used to
delete the backups, and the credential lives on the machine most likely to be compromised.
Retention is enforced by an R2 lifecycle rule on the bucket, not by the box reaching in and
tidying up after itself.

---

## 2 · Backup failure is loud, and *absence* counts as failure

A design that reports errors is blind to the failure that actually happens: **the cron stops
running and nothing reports anything.** Silence looks identical to success.

So the check is not "did a backup fail" but **"how long since a backup succeeded"**:

- Each run writes an outcome row — started, finished, byte count, object key, error if any.
- `/admin/pulse` shows **hours since the last successful backup**, and goes red past **2 hours**.
  That threshold catches a cron that never fired, a box that is up but wedged, and an R2
  credential that expired, with the same mechanism.
- The dashboard is the primary signal and it needs someone to look at it. Once SMTP is
  configured, the same check queues an email through the outbox — which is exactly what the
  outbox was built for, and it now has a claim-before-send guard so a stuck alarm cannot
  spam.

**A dump is only counted as successful once it has been read back from R2 and its size checked.**
A `pg_dump` that exits 0 into a full disk or a broken pipe produces a truncated file, and a
backup system that trusts its own exit code is how you discover the truncation during a restore.

---

## 3 · The restore drill runs against the real mechanism, before cutover

`scripts/restore-drill.ts` already earned its keep once: it found the restore path broken in two
ways that the backups themselves gave no sign of — JSON has no date type, and my column parser
split `numeric(4,2)` down the middle. **The backups were fine and the restore was not**, which is
the only lesson that matters here.

It is rewritten for `pg_restore` and the JSON-era path is deleted with the other workarounds.

The drill:

1. takes a **real dump from R2** — not one made for the occasion;
2. `createdb` a throwaway database on the box;
3. `pg_restore` into it;
4. asserts against **values, not row counts alone** — a known order's full money breakdown
   including `pointsDiscountCents`, a loyalty balance recomputed from its ledger entries, a
   product's price and status, a `numeric` column read back exactly;
5. `dropdb`.

**It runs green before cutover, against a dump of the real Neon data**, and weekly thereafter —
because a backup that has silently started producing corrupt output is found by drilling it, not
by needing it.

---

## 4 · Staging: one layer at a time

Three things are moving — CDN, origin, database. **Each stage changes one**, except Stage C,
which has its reason written next to it.

### Stage A — Cloudflare in front of the *existing* Render origin

Nothing about the app or the data changes. This proves the zone in isolation.

- Add the zone, change nameservers at Namecheap, wait for propagation.
- TLS **Full (strict)**.
- Cache rules: **gated HTML is never cached at the edge** (§5).
- Security level and bot settings tuned for CGNAT (§5).
- **Verify:** site still serves, gate still holds, `cf-cache-status` never `HIT` on HTML,
  a phone on Lebanese mobile data reaches the site with no challenge.

**Rollback:** nameservers back to the previous values. Minutes, not hours.

### Stage B — The box, with no traffic on it

- Provision, harden, install Postgres + Node + Caddy.
- Restore the Neon data into local Postgres.
- **Build the backup system and pass §1–§3 here** — before it is protecting anything real, and
  while a mistake costs nothing.
- Run the whole suite against local Postgres: `npm run test:all -- --write`.
- **Verify:** drill green; `/admin/pulse` shows a fresh backup age; suite green.

**Rollback:** delete the server. Nothing is pointed at it.

### Stage C — Cut the origin over (origin **and** database together)

> **Why two things change here, deliberately.** The app and its database have to move as one.
> An app on Hetzner talking to Neon in Ohio is a configuration that will never run in
> production — testing it would prove nothing about the target state while adding a second
> cutover and an Atlantic round-trip to every query. The coupling is contained because the
> layer in front is already proven and unchanged: Stage C flips *one setting in Cloudflare*,
> the origin address, against a stack that has been rehearsed end-to-end in Stage B.

- Final dump from Neon, restore to the box, **put Neon in read-only / stop writes** for the
  window so no order lands in the old database after the copy.
- Point the Cloudflare origin at the box.
- **Verify:** place a real order end-to-end; `req.ip` correct (§5); rate limiter correct (§5);
  gate still holds; backup age still fresh.

**Rollback:** point the origin back at Render. Neon still holds everything up to the freeze, so
the exposure is only orders placed in the window — which is why the window is short and
announced to nobody, because the store is still dark.

### Stage D — Settle, then decide the deletions

- Decommission Render. Keep Neon **read-only for 30 days** as a cold copy; it costs nothing and
  it is the un-delete of last resort while the new backups are still young.
- **The flake experiment** (§6).
- Update `LAUNCH.md` with real purge access (§5).

---

## 5 · Cloudflare acceptance tests

Each is a pass/fail gate, in the same style as the original gate work.

**Cache — gated HTML never reaches the edge.**
The gate already sends `Cache-Control: no-store` and `Vary: Cookie, Accept, Sec-Fetch-Dest`.
A Cache Rule must bypass cache for HTML regardless. Test: request `/` with and without the
preview cookie; assert `cf-cache-status` is `BYPASS` or `DYNAMIC`, **never `HIT`**, and assert a
previewer's real page is never served to a request without the cookie. That second one is the
failure that matters — it is the whole store leaking from one cached response.

**Origin lockdown — this is what makes `trust proxy` safe.**
The box's firewall accepts 443 **only from Cloudflare's IP ranges**. Without it anyone can hit
the origin IP directly, and a direct connection means the attacker controls every hop the app is
told to trust — a forged `X-Forwarded-For` would be believed. Origin lockdown is not hardening
on top of the proxy config; it is a precondition of it.

**Trust proxy — re-derived, then attacked.**
Cloudflare + Caddy is **2**, not the current 1. Two tests, both required:
1. `req.ip` differs between two real networks (home wifi, phone on mobile data);
2. a request carrying a spoofed `X-Forwarded-For` **fails to escape the rate limiter** — send
   the same forged header repeatedly and confirm it is still limited.
Test 2 is the one that catches a count set too high, and nothing else does.

**TLS — Full (strict), no half-secured hop.**
Cloudflare Origin CA certificate on Caddy. Origin CA is trusted only by Cloudflare, which is
correct here because only Cloudflare talks to the origin. Assert the origin rejects plain HTTP.

**Bot protections must not challenge real customers.**
Lebanese mobile traffic is CGNAT-heavy — the exact population these heuristics flag, and the
same reason the rate limiter was built CGNAT-aware in the first place. **Bot Fight Mode OFF**,
Security Level **Essentially Off** at launch. Raise it later against evidence, never
preventively. **Test: your phone, mobile data, no wifi — storefront and checkout, no challenge
page.** A customer who meets a CAPTCHA on the way to paying does not come back.

**Purge access — LAUNCH.md gets the procedure it never had.**
We own the zone now, so a purge is finally possible. The going-live procedure is updated to use
it, because the moment the gate comes down is exactly when a stale cached coming-soon page at
the edge would be most expensive.

---

## 6 · What the move lets us delete — and what has to prove it

The Neon connection ceiling is behind three things in this codebase. It dies with the move,
which makes the standing theory **testable for the first time**, and the proof decides the
deletions.

**The experiment:** on the box, against local Postgres, run `test-redemption.mjs` 20 times.

- **0 failures →** the ceiling is confirmed as the cause. `BATCH = 40` and the sequential
  `materialise` loop in `runSweep` both go, with the disappearance of the flake as the evidence.
- **Any failure →** the ceiling was not the cause, both stay, and we have a real bug to hunt
  with a reproduction we did not have before.

**`test-all.mjs` now prints the failing assertions rather than the tail**, so the next flake
produces a cause instead of a count. Without that this experiment could only ever produce
another number.

Also retired at cutover, as workarounds rather than decisions:

- product images living in `web/public/` because Render's disk is ephemeral — `UPLOAD_DIR` is
  already env-driven, so this is configuration, not code;
- the JSON backup path, replaced by `pg_dump` (§3);
- the sweep as an external ping — it becomes a local cron hitting `127.0.0.1`, so the shared
  secret stops crossing the network and the cold-start timeout advice becomes noise.

---

## 7 · Shopping list — your actions, in order

I cannot reach any of these accounts, and no secret should be pasted into our conversation.
What unblocks me is **one SSH key**, in step 3.

### 1 · Cloudflare account, and add the zone — *do not change nameservers yet*
Free plan. Add `tulipglam.com`; Cloudflare will import the existing DNS records and show you
two nameservers. **Check the imported records against Namecheap before continuing** — an import
that silently drops a record is how mail stops working.

### 2 · Namecheap → change the nameservers *(this starts Stage A)*
Replace the current nameservers with the two Cloudflare gave you. Propagation is usually under
an hour. Nothing about the site changes; Cloudflare simply starts sitting in front of Render.

### 3 · Hetzner account + one server *(this starts Stage B)*
- **Type:** Cloud, **CX22** — 2 vCPU (x86), 4 GB RAM, 40 GB NVMe.
  Sized against measurements, not guesses: the built site is **785 MB** (782 MB of it product
  images), plus the app, plus Postgres and its WAL. 40 GB leaves comfortable headroom.
  *ARM (CAX11) is cheaper for the same specs; I am recommending x86 to remove a whole class of
  "is there an arm64 build of this" problems during a migration. Take ARM if cost matters more.*
- **Location:** **Falkenstein or Nuremberg (Germany)** — Hetzner's closest sites to Lebanon.
- **Image:** Ubuntu LTS.
- **SSH key:** on your Windows machine run `ssh-keygen -t ed25519`, then paste the **public**
  key (`.pub` — the one that is safe to share) into Hetzner at creation.
- Then tell me the server's IP. **This is the step that unblocks me**: with the key on your
  machine, I can drive the box through your terminal without any credential entering our chat.

### 4 · Cloudflare R2 bucket + token *(needed for Stage B)*
- Bucket: `tulipglam-backups`.
- API token scoped to **that bucket only**, permissions **write and list — not delete**.
- R2 asks for a payment method even inside the free tier; expect that, it is not a mis-click.
- Put the token straight onto the box when we get there. Not into chat, not into the repo.

### 5 · Secrets, at the end of Stage B
`JWT_SECRET`, `ADMIN_KEY`, `PREVIEW_KEY`, `LOYALTY_SWEEP_SECRET` move from Render's Environment
tab to a `0600` file on the box. I will give you a script that prompts for each and writes them
with the right permissions — you type them, I never see them.

**Expect the server to refuse to boot if one is missed.** All four are guarded, and that refusal
is the migration working rather than the migration breaking.
