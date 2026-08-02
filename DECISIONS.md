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
