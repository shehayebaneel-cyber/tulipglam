# Decisions waiting on you

Forks where two answers were defensible, or where the call is yours rather than mine.
Nothing here has been applied.

---

## 1 · Product framing — the flea-market feel that survived uniform tiles

**This is the "deeper than sizing" question, with the sample you asked for.**

Making every tile the same size fixed the boxes and did not fix the shelf. Measuring 300 card
derivatives:

| | |
|---|---|
| Product content fills | **33% – 100%** of its tile |
| Median | 62% |
| Fill under 55% ("lost in the tile") | **26% of products** |
| Fill over 92% ("cramped") | 3% |

So a mascara floats in white space beside a boxed hair dryer that touches its own edges. That
three-to-one spread is what reads as jumble, and no amount of CSS fixes it — it is in the
photographs, where different suppliers left different margins.

**Sample: `shots/gallery/normalise-proposal.png`** — twelve products, today's version on top and
the proposal beneath, chosen as the tightest four, middle four and loosest four of 90 sampled.
Not a flattering selection.

### What I propose

Trim each image to its actual content, re-pad so content occupies **80%** of the tile, with a
**1.35× cap on enlargement**.

The cap is the important half. A product filling 33% of a 600px source is only ~200px of real
detail; scaling that to 80% of the tile is a 2.4× enlargement of pixels that were never
captured, and it turns to mush on exactly the phone screens this is for. Capped, those move
from 37% to 50% — better, honest, still soft-free.

### What I deliberately did NOT propose

**Equalising apparent product size.** A lipstick and a hair dryer should not occupy the same
area on a shelf. That is not tidiness, it is misinformation, and it ends with a customer at
their door holding something much smaller than they expected. Normalising the *framing* — the
dead margin a photographer left — is safe to automate. Normalising the *subject* is not.

### Your call

- **Run it** — I apply it to all three sources and rebuild; ~20 minutes, and reversible by
  deleting `public/i` and re-running the plain build.
- **Run it on Feel22 only** — 9,365 of the images and the worst offenders; leave Dali and
  Beesline, whose photography is already consistent.
- **Leave it** — the tiles are uniform, which was the main complaint, and this is polish.

I would run it on everything. It is derived output with the sources untouched, so the downside
is twenty minutes.

---

## 2 · The Beesline image that is AI-generated

`beesline/Gemini_Generated_Image_8hgb1o8hgb1o8hgb_e856851a-…png` is in the catalogue and on the
site. The filename is Google Gemini's own output convention.

I have not removed it — which product it belongs to and whether that was deliberate is yours to
know, and deleting a supplier image on suspicion is not my call. But an AI-generated photograph
of a real cosmetic is a product claim: it shows something that does not exist, and if a customer
receives a jar that does not match it, that is a returns conversation with no good answer.

**The homepage hero looks generated too** (`shots/before/home.png`). Same question, much higher
traffic. I have changed neither.

**Recommendation:** replace both with supplier photography. If a generated image is a deliberate
placeholder until real photography exists, say so and I will leave them and note it.

---

## 3 · Where the image sources live at deploy time

Sources are 724 MB and derivatives are 225 MB. Both currently sit under `web/public/`, so a
build ships **both** — about 1 GB of `dist`, of which the 724 MB is never requested by any page
now that everything renders from `/i/`.

- **Move sources to `web/product-sources/`** (outside the published folder). Deploy drops by
  ~724 MB. Sources stay in git, untouched, and the pipeline reads from the new path. Everything
  still renders because nothing references the originals any more.
- **Leave them.** Simpler, and 40 GB of Hetzner disk absorbs it.

I did not move them today: it is a 724 MB git operation and the verification it needs — proving
no surface requests an original — deserves a database I did not have. **Recommend doing it as
part of the Hetzner migration**, where the deploy size actually starts costing something.

---

## 4 · Checkout lost its navigation — confirm you want that

Checkout now renders a stripped shell: no site header, no footer, no bottom nav bar. Back to
Bag, the wordmark, and the cash-on-delivery reality. The page went from 3,022px to 2,006px tall
at 390px.

This is the standard move in commerce design, and I made it without asking because the previous
state — fifteen footer links and a fixed bottom bar sitting over the Place Order button — is
hard to defend. But it *is* a change to the one page where money happens, so: **say the word and
I put the shell back.** `shots/before/checkout.png` against `shots/after/checkout.png`.

---

## 5 · Not done, and why

**The flake verdict (your item 8) did not run.** It needs local Postgres. This machine has none,
Neon became unreachable partway through the day, and installing Postgres needs a download the
network would not carry. The experiment is unchanged and still correct — 20 runs, zero failures
confirms the ceiling and the accommodations go — it just needs a box that can reach a database.
**It is the first thing to run on the Hetzner server in migration Stage B**, where local Postgres
exists by definition.

I did not fake it with Neon, and I did not report a verdict I could not reach.

### But the theory got strong evidence tonight, by accident

I left a second server running while measuring performance — two Node processes plus 17 test
suites, all holding Prisma pools against Neon. The result:

| | |
|---|---|
| With the extra server running | **13 of 17 suites died before printing a summary**, 78 failed checks, one crashing with a Windows stack-overrun code |
| Extra server killed, nothing else changed | **17 suites, 954 checks, all pass** |

Same commit, same database, same command, minutes apart. The only variable was how many
connection pools were open.

That is not the verdict — the verdict needs the controlled 20-run experiment on local Postgres,
and I am not substituting an accident for it. But it is the clearest signal yet that the
`test-redemption` flake is **connection exhaustion rather than a bug in the redemption path**,
and it raises my confidence that `BATCH = 40` and the sequential `materialise` loop are
accommodations for Neon's free tier and will be safe to delete once Postgres is local.

It also means: **do not run the full suite while anything else is holding a pool.** Worth
knowing before someone reads 78 failures as a broken build.

---
---

# DECIDED — 2 August 2026

Owner's answers. §1 is the only one still open.

### §1 Framing normalisation — WAITS ON YOUR EYES

Sample gallery: **`shots/gallery/`**

| file | what it is |
|---|---|
| **`normalise-proposal.png`** | **the decision** — twelve products, today's version on top, proposal beneath. Tightest four, middle four, loosest four of 90 sampled. |
| `sample-feel22.png` | 24 of 9,365 ordinary card derivatives |
| `sample-beesline.png` | 24 of 555 |
| `sample-dali.png` | 24 of 182 |
| `suspects.png` | all 19 flagged images together, at size |

Full path: `c:\Users\sheha\OneDrive\Desktop\projects website\tulipglam\shots\gallery\`

### §2 AI images — RESOLVED, both ways

**The hero → decorative. Stays.** No change made.

**The Beesline image → a product stand-in.** `Proactive Strength Duo`, `hidden`, and that
photograph was its only one. Two things worth knowing:

1. **The supplier generated it, not us.** Its `src` in the catalogue is a Shopify CDN URL on
   Beesline's own store. This is a property of a feed we re-import, not a one-off in our data.
2. **Deleting the row would not have held.** `npm run import:beesline` recreates
   importer-owned rows — the lesson this codebase already learned.

So the rule went into code: `prisma/generated-images.ts`, wired into **all three importers**.
The catalogue JSON is deliberately left alone — it should stay an honest record of what the
supplier published. The live row was also removed so the database matches what a fresh import
now produces; product status untouched at `hidden`, because availability is your call.
Verified: 0 AI-named images remain, and ordinary supplier and swatch filenames do not match.

### §3 Image sources at deploy — ADOPTED AS YOU FRAMED IT

Nothing changes before the migration. **My option (a) — moving sources within the repo — was
exactly the Render-shaped interim you are rejecting, and I withdraw it.** It would have cost a
724 MB git operation to save deploy weight on a host we are leaving.

After the move: box disk is the working copy, R2 is the durable home beside the backups, and the
repo carries code.

**One consequence to plan for:** the build currently generates derivatives *from sources in the
repo*. Take the sources out and the build cannot rebuild them, so post-migration the derivative
directory has to persist on the box (cheap and natural there) or be restored from R2 at deploy.
That is a Stage B decision, not a today decision — flagging it so it does not surprise us.

### §4 Checkout navigation — APPROVED, stripped stays

No further action. Desktop holds at 1,192px.

### §5 The flake — signal, not verdict

Twenty controlled runs on local Postgres at the next quiet stretch. **Deletions execute on the
verdict only**: zero failures confirms the ceiling and `BATCH = 40` plus the sequential
`materialise` loop go; any failure keeps them and we have a reproduction.

---

# The 438 KB bundle — where the weight actually lives

Recorded so the next brief starts informed rather than re-deriving it.

**First contentful paint is owned by JavaScript, not images.** Measured on the production build
at 390px / 4x CPU / 1.6 Mbps: homepage FCP 3,464-3,512 ms, category page 3,432-3,512 ms. The
image work cut payload by 95% and moved FCP by nothing, because the page cannot paint until
React has parsed and executed — images arrive after that moment, not before it.

| | |
|---|---|
| **Script** | **438 KB** — the whole story |
| Font | 100 KB (self-hosted, 2 files, a variable weight range) |
| Image, above the fold | 84-128 KB (was ~450 KB for the same cards) |

What is already done and is *not* the remaining win: admin is code-split out (556 -> 433 KB),
`/api/site` no longer ships 405 brands, fonts are self-hosted and deduped to a weight range.

**What is left, in the order I would attack it:**

1. **Storefront pages are all eagerly imported** — deliberately, so a first visit does not
   render a spinner. That decision is worth revisiting *per route*: Track, Info, Rewards,
   Account and Password are not on the critical path and none of them is what a first-time
   visitor lands on.
2. **React Router + React 19 are the floor.** Whatever else goes, that floor stays, so measure
   it before promising a number.
3. **Measure before cutting.** There is no bundle analyser wired up in this repo, so the 438 KB
   is currently one opaque figure. The first task is a per-module breakdown, not a deletion —
   the image work only went well because it was measured first, and the same applies here.

**Do not treat this as an optimisation ticket.** It is the difference between a store that
paints in 3.5 s and one that paints in under 2 on the connection your customers actually have.
