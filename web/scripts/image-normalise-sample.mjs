/**
 * SAMPLE ONLY — proposed framing normalisation, shown side by side against what ships today.
 *
 *     node scripts/image-normalise-sample.mjs
 *
 * Writes shots/gallery/normalise-proposal.png. Touches nothing else, changes no derivative,
 * and is not wired into the build. It exists so the framing question can be decided by looking
 * rather than by argument.
 *
 * ── THE PROBLEM, MEASURED ──────────────────────────────────────────────────────────
 *
 * Across 300 sampled card derivatives, the product's own content occupies between 33% and 100%
 * of its tile, median 62%. A quarter of them fill under 55%. So a mascara floats in white space
 * beside a boxed hair dryer that fills its frame, and the shelf reads as jumble even though
 * every tile is now exactly the same size. Uniform boxes were necessary and are not sufficient.
 *
 * ── WHAT THIS PROPOSES ─────────────────────────────────────────────────────────────
 *
 * Trim each image to its actual content, then re-pad so the content occupies a consistent share
 * of the tile — with two limits that matter:
 *
 *   TARGET_FILL 0.80   what a product should occupy. Chosen near the current p90 rather than at
 *                      the maximum, so the common case moves a little and nothing ends up
 *                      touching its own edges.
 *
 *   MAX_UPSCALE 1.35   the honesty limit. A product filling 33% of a 600px source is only about
 *                      200px of real pixels; blowing that to 80% of the tile is a 2.4x
 *                      enlargement of detail that was never captured, and it shows as mush on
 *                      the exact phone screens this is meant to serve. Past this cap the image
 *                      is left closer to where it was and listed instead.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────
 *
 * It does not equalise apparent product SIZE. A lipstick and a hair dryer should not occupy the
 * same area on a shelf — that is not tidiness, it is misinformation, and a customer who orders
 * expecting the sizes they saw is a customer at the door with a complaint. Normalising the
 * FRAMING (how much dead margin the photographer left) is a different thing from normalising
 * the SUBJECT, and only the first is safe to automate.
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD = path.resolve(HERE, "..", "public", "i", "card", "feel22");
const OUT = path.resolve(HERE, "..", "..", "shots", "gallery");
fs.mkdirSync(OUT, { recursive: true });

const TILE = 400;
const TARGET_FILL = 0.80;
const MAX_UPSCALE = 1.35;

async function normalise(file) {
  const src = path.join(CARD, file);
  const flat = await sharp(src).flatten({ background: "#ffffff" }).toBuffer();
  const { data, info } = await sharp(flat).trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });

  const contentLong = Math.max(info.width, info.height);
  const want = TILE * TARGET_FILL;
  const scale = Math.min(want / contentLong, MAX_UPSCALE);
  const capped = scale === MAX_UPSCALE && want / contentLong > MAX_UPSCALE;

  const w = Math.round(info.width * scale);
  const h = Math.round(info.height * scale);
  const out = await sharp(data).resize(w, h)
    .extend({
      top: Math.floor((TILE - h) / 2), bottom: Math.ceil((TILE - h) / 2),
      left: Math.floor((TILE - w) / 2), right: Math.ceil((TILE - w) / 2),
      background: "#ffffff",
    })
    .png().toBuffer();
  return { out, before: contentLong / TILE, after: Math.max(w, h) / TILE, capped };
}

// The spread, not a flattering selection: the tightest, the loosest, and the middle.
let s = 20260802; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const all = fs.readdirSync(CARD);
const measured = [];
const seen = new Set();
while (measured.length < 90 && seen.size < all.length) {
  const i = Math.floor(rnd() * all.length);
  if (seen.has(i)) continue;
  seen.add(i);
  try {
    const { info } = await sharp(path.join(CARD, all[i])).flatten({ background: "#ffffff" })
      .trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
    measured.push({ file: all[i], fill: Math.max(info.width, info.height) / TILE });
  } catch { /* uniform image */ }
}
measured.sort((a, b) => a.fill - b.fill);
const chosen = [measured[0], measured[1], measured[2], measured[3],
  measured[Math.floor(measured.length / 2) - 1], measured[Math.floor(measured.length / 2)],
  measured[Math.floor(measured.length / 2) + 1], measured[Math.floor(measured.length / 2) + 2],
  measured[measured.length - 4], measured[measured.length - 3], measured[measured.length - 2], measured[measured.length - 1]];

const CELL = 200, PAD = 8, LABEL = 30, HEAD = 52;
const W = chosen.length * (CELL + PAD) + PAD;
const H = HEAD + 2 * (CELL + LABEL) + 3 * PAD;
const comps = [];

for (let i = 0; i < chosen.length; i++) {
  const x = PAD + i * (CELL + PAD);
  const before = await sharp(path.join(CARD, chosen[i].file))
    .flatten({ background: "#fcfcfb" }).resize(CELL, CELL, { fit: "contain", background: "#fcfcfb" }).png().toBuffer();
  comps.push({ input: before, left: x, top: HEAD });

  const { out, after, capped } = await normalise(chosen[i].file);
  const afterImg = await sharp(out).flatten({ background: "#fcfcfb" }).resize(CELL, CELL, { fit: "contain", background: "#fcfcfb" }).png().toBuffer();
  comps.push({ input: afterImg, left: x, top: HEAD + CELL + LABEL + PAD });

  const cap = `<svg width="${CELL}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="13" font-family="monospace" font-size="11" fill="#6b6673">fill ${(chosen[i].fill * 100).toFixed(0)}% → ${(after * 100).toFixed(0)}%${capped ? " (capped)" : ""}</text></svg>`;
  comps.push({ input: Buffer.from(cap), left: x, top: HEAD + 2 * CELL + LABEL + 2 * PAD });
}

const head = `<svg width="${W}" height="${HEAD}" xmlns="http://www.w3.org/2000/svg">
  <text x="10" y="20" font-family="sans-serif" font-size="16" fill="#1a1a1e">Framing proposal — TOP: shipping today   BOTTOM: normalised to 80% fill (max 1.35x upscale)</text>
  <text x="10" y="38" font-family="sans-serif" font-size="12" fill="#6b6673">Tightest four, middle four, loosest four of 90 sampled. SAMPLE ONLY — nothing was changed.</text></svg>`;
comps.push({ input: Buffer.from(head), left: 0, top: 0 });

await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite(comps).png().toFile(path.join(OUT, "normalise-proposal.png"));

console.log(`wrote shots/gallery/normalise-proposal.png`);
console.log(`  ${chosen.filter((c) => c.fill < 0.55).length} of the 12 shown currently fill under 55%`);
