/**
 * Contact sheets of the pipeline's real output.
 *
 *     node scripts/image-gallery.mjs
 *
 * Writes PNG sheets to shots/gallery/. Two kinds, and both matter:
 *
 *   sample-*.png   a random-but-seeded spread of ordinary output — what a customer sees
 *   suspects.png   every image the build flagged, together, at size
 *
 * ── WHY A SHEET AND NOT A COUNT ────────────────────────────────────────────────────
 *
 * "39,692 built, 5 failed" is the kind of number that hides everything interesting. Automation
 * at this scale fails in ways that pass every programmatic check: a product photographed against
 * a grey backdrop next to one on pure white, a bottle occupying a tenth of its tile beside a
 * tube that fills the frame. Nothing about those is detectable as an error and both look wrong
 * on a shelf. The only way to know is to put them side by side and look.
 *
 * Sampling is SEEDED so re-running produces the same sheet — a gallery that reshuffles every
 * run cannot be compared against the last one.
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_DIR = path.resolve(HERE, "..", "public", "i", "card");
const SUSPECTS = path.resolve(HERE, "..", "..", "IMAGE-SUSPECTS.txt");
const OUT = path.resolve(HERE, "..", "..", "shots", "gallery");
fs.mkdirSync(OUT, { recursive: true });

const CELL = 240;
const COLS = 6;
const PAD = 10;
const LABEL_H = 26;

/** Deterministic PRNG so the same sheet comes back on a re-run. */
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

async function sheet(files, outName, title) {
  if (!files.length) { console.log(`  (nothing for ${outName})`); return; }
  const rows = Math.ceil(files.length / COLS);
  const W = COLS * (CELL + PAD) + PAD;
  const H = rows * (CELL + PAD + LABEL_H) + PAD + 40;

  const composites = [];
  for (let i = 0; i < files.length; i++) {
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = PAD + col * (CELL + PAD);
    const y = 40 + PAD + row * (CELL + PAD + LABEL_H);
    try {
      // Flattened onto the page colour so transparent cut-outs are visible as they will be
      // on the site, rather than as a checkerboard or a black hole.
      const buf = await sharp(files[i].abs)
        .resize(CELL, CELL, { fit: "contain", background: { r: 252, g: 252, b: 251, alpha: 1 } })
        .flatten({ background: { r: 252, g: 252, b: 251 } })
        .png().toBuffer();
      composites.push({ input: buf, left: x, top: y });
    } catch { /* unreadable — the gap in the sheet is itself informative */ }

    const label = files[i].label.slice(0, 34);
    const svg = `<svg width="${CELL}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="15" font-family="monospace" font-size="11" fill="#6b6673">${label.replace(/[<&>]/g, "")}</text></svg>`;
    composites.push({ input: Buffer.from(svg), left: x, top: y + CELL + 2 });
  }

  const head = `<svg width="${W}" height="34" xmlns="http://www.w3.org/2000/svg">
    <text x="10" y="23" font-family="sans-serif" font-size="17" fill="#1a1a1e">${title.replace(/[<&>]/g, "")}</text></svg>`;
  composites.push({ input: Buffer.from(head), left: 0, top: 4 });

  await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(composites).png().toFile(path.join(OUT, outName));
  console.log(`  ${outName}  (${files.length} images)`);
}

// ── ordinary output, sampled per source ───────────────────────────────────────────────
const rand = seeded(20260802);
for (const src of fs.readdirSync(CARD_DIR)) {
  const dir = path.join(CARD_DIR, src);
  if (!fs.statSync(dir).isDirectory()) continue;
  const all = fs.readdirSync(dir);
  const picked = [];
  const want = Math.min(24, all.length);
  const seen = new Set();
  while (picked.length < want) {
    const i = Math.floor(rand() * all.length);
    if (seen.has(i)) continue;
    seen.add(i);
    picked.push({ abs: path.join(dir, all[i]), label: all[i].replace(/\.webp$/, "") });
  }
  await sheet(picked, `sample-${src}.png`, `${src} — 24 of ${all.length} card derivatives, as a customer sees them`);
}

// ── every flagged image, together ─────────────────────────────────────────────────────
if (fs.existsSync(SUSPECTS)) {
  const text = fs.readFileSync(SUSPECTS, "utf8");
  const entries = [...text.matchAll(/^([a-z0-9]+)\/(.+)$/gim)]
    .map((m) => ({ src: m[1], file: m[2].trim() }))
    .filter((e) => !e.file.startsWith(" "));
  const files = [];
  for (const e of entries) {
    const webp = path.join(CARD_DIR, e.src, e.file.replace(/\.[a-z0-9]+$/i, "") + ".webp");
    // A suspect with no derivative is one of the corrupt sources — show the SOURCE so the
    // sheet still says what the product looks like, or fails to.
    const orig = path.resolve(HERE, "..", "public", "products", e.src, e.file);
    const abs = fs.existsSync(webp) ? webp : orig;
    if (fs.existsSync(abs)) files.push({ abs, label: e.file });
    else files.push({ abs: "", label: `${e.file} (UNREADABLE)` });
  }
  await sheet(files.filter((f) => f.abs), "suspects.png", `${files.length} flagged images — every one, at size`);
}

console.log(`\n-> shots/gallery/`);
