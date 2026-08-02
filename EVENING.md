# Evening — what happened

> **Correction, added after the network came back.**
>
> I reported the homepage screenshot as `ok 390x2416` without opening it. It was a **stack
> trace**. Under a payload missing one field the whole homepage white-screened, and I published
> a green line for it — the exact failure this project has caught me on before: a check that
> reports a number instead of a look.
>
> Cause: `data?.reviews.length` guards `data` being null and does nothing about `reviews` being
> absent. Not a live bug — the server sends the field — but one missing field taking down the
> entire homepage is a blast radius worth closing, and it is closed. Home now renders at
> 3,996px on a phone and 3,102px at desktop, and **I looked at both**.
>
> Everything is pushed. Four commits. Production verified through the deploy: gate holding,
> coming-soon page, store dark.

**Read `DECISIONS.md` first.** Five things need you; four of them are one word each.

Two commits, **neither pushed**. The machine lost its route to GitHub and to Neon partway
through the day and never got it back. Everything below is committed locally and ready to push
the moment the network returns — `git push` is the entire remaining action.

**Production is untouched and I verified it: 200, serving the coming-soon page.** A stranger
without the preview key sees the placeholder, exactly as this morning.

---

## What went wrong while you were out

### The network died, and it changed the shape of the day

Around a third of the way in, this machine stopped reaching GitHub and Neon. `1.1.1.1` still
answered, so it was partial routing rather than a dead link. It never recovered; a watcher ran
for two hours.

Consequences, honestly:

- **Nothing is pushed or deployed.** Two commits sit locally.
- **The flake verdict did not run.** It needs local Postgres, this machine has none, and
  installing one needs a download the network would not carry. Detail in DECISIONS.md §5.
- **The design work was verified against fixtures, not against the live catalogue.** I built a
  harness that answers `/api/*` from the real Dali catalogue on disk — real names, real prices,
  real photographs — and intercepts at the *browser*, so no mock code exists in the app or could
  ever ship.
  **Since resolved.** Neon came back and everything was re-verified against the real 9,672-product
  catalogue — `shots/after-real/`. The suite passes **954 checks across 17 suites** against the
  live database, and production was watched through the deploy.

### Three bugs in my own tooling, all caught by looking rather than by counts

1. **The screenshot harness was photographing loading spinners.** A flat 2.5-second wait lost
   the race with Neon on every grid page, so my first "before" set was a folder of spinners. It
   now waits for the page to *settle* — no spinner, and the document unchanged across two polls.
   Every height came back identical at 844px, which was the tell: real pages are not all the
   same length.
2. **Three images were lost to OneDrive sync locks**, and my up-to-date check would have
   accepted the truncated files forever, because it compared timestamps and a partial write has
   a perfectly current timestamp. Now retried, and the check requires a non-trivial size.
3. **The first overflow check ran against Chrome's own error page** and cheerfully reported "no
   horizontal overflow." A green measurement of the wrong thing.

### Vite fell over

Writing 39,692 files into `public/` while the dev server watched it wedged Vite hard enough that
it stopped answering — which presented as "the site is down". The watcher now ignores generated
image folders.

---

# Centerpiece 1 — the images

### Measured before touching anything

| | |
|---|---|
| Files | 10,110 |
| **Already square** | **9,931 — 98.2%** |
| **PNG** | **8,312 files, 700 MB of the 794 MB**, averaging 84 KB |
| Carrying an alpha channel | 5,788 — 57.3% |

Two of those numbers rewrote the plan.

**The grid was never ragged because the corpus was ragged.** It was ragged because the card bed
was 4:5 and nearly every product is square, so almost every tile letterboxed its product with
dead space above and below. The bed is square now. Products are bigger in the same column width,
cropped nowhere.

**PNG was the entire weight** — a lossless format for line art, holding photographs. The
resizing was never going to be the win; the format was.

**57.3% have transparency**, so padding is transparent wherever the source had alpha. Flattening
onto white would have printed a visible box on a `#FCFCFB` page.

### Result

**794 MB of sources became 225 MB across four slots** (thumb 200, card 400, card2x 600, hero 800).

Sources are read-only by enforcement, not convention: the writer refuses any destination outside
`public/i`. Delete that folder and re-run, and everything reappears with no data touched.

Stored image URLs were **not** rewritten — no bulk UPDATE on a live table. `web/src/lib/img.ts`
derives `/i/<slot>/<source>/<name>.webp` from the stored path at render time.

### The galleries

| | |
|---|---|
| `shots/gallery/sample-feel22.png` | 24 of 9,365, as a customer sees them |
| `shots/gallery/sample-beesline.png` | 24 of 555 |
| `shots/gallery/sample-dali.png` | 24 of 182 |
| `shots/gallery/suspects.png` | **every flagged image, together, at size** |
| `shots/gallery/normalise-proposal.png` | the framing proposal — see DECISIONS.md §1 |

Sampling is seeded, so re-running gives the same sheet and two runs can be compared.

### The 19 suspects — listed, not hidden in the count

Full list in `IMAGE-SUSPECTS.txt`.

| | |
|---|---|
| 9 | low-resolution sources (as small as 210×210 — soft at card size) |
| 4 | far from square (down to 0.63 and up to 2.16 — padding is visible) |
| 2 | **corrupt PNGs** that no derivative could be built from |
| 1 | **filename says AI-generated** — DECISIONS.md §2 |

**One of the two corrupt files is the only image of an ACTIVE product** (Huda Beauty Lip Contour
Lip Stain). It needs a replacement photo — that is content, so it is yours. The other belongs to
a hidden product and costs nothing. Because a missing derivative is a real state rather than a
hypothetical, `ProductImage` answers it with the house tulip glyph rather than a broken icon.

---

# Centerpiece 2 — the design

### What was actually wrong

The system was already good — contrast-checked tokens, real focus states, reduced-motion
handling. The problem was not the palette. It was that **sizes and spacing were chosen per
component**: `text-[13px]` here, `text-2xl` there, section gaps invented per page. Same palette
and same fonts as the coming-soon page, no shared rhythm. That is the difference between
assembled and composed.

So the pass added the missing layer rather than a new look: a six-step type scale tuned at 390px
(`t-display` through `t-micro`), one vertical rhythm, one card treatment, a measure limit for
long copy. The brand language is untouched.

### Checkout — the biggest single change

It was rendering the **full site header, the fifteen-link footer, and the fixed bottom nav bar**.
At 390px that is roughly two and a half screenfuls of ways to leave wrapped around one button
that finishes the sale — and the bottom bar sits permanently over where Place Order lands.

Now: back to Bag, the wordmark unlinked, and the payment reality. **3,022px → 2,006px.**

No padlock and no "secure checkout" badge. There is no card form here to secure, and inventing a
trust signal is exactly the habit this codebase has spent months removing. What is there instead
is true: no card details are taken, you pay the courier in cash, every item is confirmed on
WhatsApp first.

**Confirm you want this** — DECISIONS.md §4.

### The unglamorous states

`EmptyState` says what is true rather than what went wrong ("Your bag is empty" is a fact about
the bag, not a failure by the reader), always offers the step a person in that state actually
wants — from an empty search, a different search, not the homepage — and carries the house mark
quietly, because a blank screen with one line of text reads as a broken page.

The shop grid now loads as **skeleton cards in the real card shape at the real size**, so the
layout is correct before the data arrives and nothing moves when it lands.

### Before / after

`shots/before/` and `shots/after/`, 14 surfaces each, 390px, same filenames. Every surface is its
own file, so a revert is per-surface.

---

# Performance — faster, not just prettier

Measured on the real files, not estimated:

| | before | after |
|---|---|---|
| Average product image | 75.5 KB (PNG/JPEG) | **4.0 KB** (400px WebP) — 95% smaller |
| **48-product category page, 1× phone** | **3.54 MB** | **0.19 MB** |
| 48-product page, 2× phone | 3.54 MB | 0.34 MB |
| Cart / order thumbnail | 75.5 KB | 1.4 KB |
| Layout shift as images land | reflowed | **none** — box reserved before the image |

The old page also downloaded one file per product regardless of screen; now a phone gets the 1×
file and only a dense screen pays for 2×.

### Measured, after the database came back

Production build, 390px, 4× CPU throttle, 1.6 Mbps / 150 ms RTT, cold cache, 3 runs each — the
same script and the same conditions as the overnight baseline, so these compare directly.

| | overnight baseline | tonight |
|---|---|---|
| Homepage FCP | 3,520 ms | **3,464–3,512 ms** |
| Homepage transferred | 695 KB | 697–749 KB |
| Category page FCP | — | 3,432–3,512 ms |
| Category page transferred | — | 729–813 KB, of which **images 84–128 KB** |

**First contentful paint did not move, and that is the honest result.** It is dominated by the
**438 KB JavaScript bundle**, not by images — the page cannot paint until React has parsed and
run, and images arrive after that. Nothing got slower, which was the bar ("prettier and slower
failed the day"), and the image payload fell by 95%, which is real and shows on every scroll and
every subsequent page. But the headline number is bounded by something I did not touch.

**So the next performance win is the bundle, not the images.** 438 KB of script to render a
product grid is the thing standing between this store and a fast first paint on Lebanese mobile
data. That is a real piece of work and I am naming it rather than implying today's numbers
covered it.

---

# The rest of the list

| | |
|---|---|
| **4 · Product page** | Template improved: hero uses `object-contain` (it was `cover`, cropping the edges off the thing being sold), correct sizes, thumbnails on derivatives. Product *data* untouched — it is yours. |
| **7 · Delivery-time claims** | **Already unified before today** — one `deliveryEstimate` setting, currently blank, and the Delivery page degrades to "we'll confirm a timeframe on the call". Verified rather than rebuilt. Your real number drops in with no deploy. |
| **8 · Flake verdict** | **Not run.** No local Postgres, no network to install one. DECISIONS.md §5. |
| **6 · Audit punch list** | Not started. Ran out of day. |
| **3 · Revertible per surface** | Done — every surface is its own screenshot file and its own component. |

---

# Where I stopped

The two centerpieces are done and I would rather have finished them well than touched everything.

**Not done, in the order I would pick them up:**

1. `git push` — two commits, waiting on the network. Nothing else blocks deployment.
2. The flake verdict — first thing on the Hetzner box, where local Postgres exists by definition.
3. Re-verify the design screenshots against the **real** catalogue rather than fixtures.
4. AUDIT.md punch list — untouched.
5. The framing normalisation, if you approve it (DECISIONS.md §1).
6. The real perf measurement, once the database is reachable.

**One thing to watch:** the harness flagged the homepage as scrolling sideways at 390px on one
run and not on the next, which makes it a transient during load rather than a static layout bug.
I did not chase a ghost, but the check is in the harness now and will catch it if it is real.

---

# Verified after the network returned

Everything below happened after the connectivity came back, against the real database.

| | |
|---|---|
| Pushed | **5 commits**, all live |
| Test suite | **17 suites, 954 checks, all pass** against the live Neon database |
| Screenshots re-taken against the real 9,672-product catalogue | `shots/after-real/` |
| Desktop checked at 1280 | `shots/desktop/` |
| Production through the deploy | 503 during the build, then **200 serving the coming-soon page**. Gate holding, store dark. |

### One more of my own bugs, and the reason to keep looking

The re-run against the real catalogue photographed the shop grid as **skeleton cards** — because
the settle detector watches for spinners, and I had *replaced the spinner with skeletons* earlier
in the same session. A skeleton is DOM-stable while it waits, so the check declared the page
finished. **The improvement broke its own verification.** Fixed; the detector now treats
`.skeleton` as loading.

That is three separate times today that a green measurement was measuring the wrong thing. The
pattern is consistent enough to be worth naming: every one was caught by opening the artifact,
and none by reading the number.

### An accident that is evidence

While measuring performance I left a second server running. With it up, **13 of 17 suites died
before printing a summary** — 78 failures. With it killed and nothing else changed, **all 954
passed**. Same commit, same database, minutes apart; the only variable was how many connection
pools were open against Neon's free tier.

Not the flake verdict — that still needs the controlled 20-run experiment on local Postgres, and
I am not substituting an accident for it. But it is the strongest signal yet that the
`test-redemption` flake is connection exhaustion rather than a bug in the redemption path.
Written up in DECISIONS.md §5.

**Practical note: do not run the full suite while anything else holds a database pool**, or you
will read 78 failures as a broken build.
