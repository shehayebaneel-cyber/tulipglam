/**
 * A contact sheet of every image an import brought in or changed.
 *
 *     node scripts/image-review.mjs beesline          # diff, build the sheet, update the baseline
 *     node scripts/image-review.mjs feel22 --peek     # diff and report only, baseline untouched
 *
 * Invoked automatically at the end of each importer. Writes to `import-review/`.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────
 *
 * `prisma/generated-images.ts` catches AI images by FILENAME, and that is a real guard for a
 * real family — the Gemini one came through Beesline's own feed, so this is a property of
 * supplier content and not a one-off. But no pattern recognises invention in general. The next
 * generated photograph will arrive under an ordinary product name and the filter will pass it,
 * because there is nothing in the string to catch.
 *
 * So the backstop is not a better pattern, it is EYES — at the exact door supplier content walks
 * through. Every import ends by putting its new and changed imagery on one sheet the owner can
 * flick through in a minute.
 *
 * ── DELIBERATELY NOT A GATE ────────────────────────────────────────────────────────
 *
 * The import proceeds regardless and this never fails it. An approval gate on a 9,373-product
 * catalogue would be ignored within two runs, and an ignored gate is worse than none because it
 * looks like a control. The promise here is smaller and keepable: **an invented photo survives at
 * most one import cycle instead of forever.**
 *
 * ── WHY A CONTENT HASH AND NOT A TIMESTAMP ─────────────────────────────────────────
 *
 * Re-downloading a catalogue rewrites every file, so mtime marks all ten thousand as changed and
 * the sheet becomes noise nobody opens. The hash answers the question actually being asked: is
 * this picture different from the one I already looked at.
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = process.argv[2];
const PEEK = process.argv.includes("--peek");

if (!SOURCE) {
  console.error("usage: image-review.mjs <source> [--peek]");
  process.exit(1);
}

const IMG_DIR = path.resolve(HERE, "..", "public", "products", SOURCE);
const OUT_DIR = path.resolve(HERE, "..", "..", "import-review");
const MANIFEST = path.join(OUT_DIR, "manifest.json");

/** How many make it onto a sheet. Past this the sheet stops being flickable in a minute. */
const MAX_ON_SHEET = 60;

if (!fs.existsSync(IMG_DIR)) {
  console.log(`[image-review] no image directory for ${SOURCE} — nothing to review`);
  process.exit(0);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const hashOf = (abs) => {
  const h = crypto.createHash("sha1");
  h.update(fs.readFileSync(abs));
  return h.digest("hex").slice(0, 16);
};

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const previous = manifest[SOURCE] ?? null;

const files = fs.readdirSync(IMG_DIR).sort();
const current = {};
for (const f of files) current[f] = hashOf(path.join(IMG_DIR, f));

/**
 * First run for a source records a baseline and produces no sheet.
 *
 * Everything would be "new", which for Feel22 is 9,373 images — a sheet nobody opens, which is
 * the same as no sheet but with a false sense of having looked. The existing catalogue has
 * already had eyes on it via `image-gallery.mjs`; this is about what arrives NEXT.
 */
if (!previous) {
  manifest[SOURCE] = current;
  if (!PEEK) fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  console.log(`[image-review] ${SOURCE}: baseline recorded for ${files.length} images.`);
  console.log(`[image-review] The next import will show what changed.`);
  process.exit(0);
}

const added = files.filter((f) => !(f in previous));
const changed = files.filter((f) => f in previous && previous[f] !== current[f]);
const removed = Object.keys(previous).filter((f) => !(f in current));
const interesting = [...added, ...changed];

console.log(`\n[image-review] ${SOURCE}: ${added.length} new, ${changed.length} changed, ${removed.length} gone`);

if (interesting.length === 0) {
  if (!PEEK) { manifest[SOURCE] = current; fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1)); }
  console.log(`[image-review] No new imagery to look at.`);
  process.exit(0);
}

// The full list always goes to text, even when the sheet is capped — so nothing is silently
// dropped just because it did not fit.
const listFile = path.join(OUT_DIR, `${SOURCE}-changed.txt`);
fs.writeFileSync(listFile,
  `${SOURCE} — ${added.length} new, ${changed.length} changed, ${removed.length} removed\n\n` +
  `NEW:\n${added.map((f) => "  " + f).join("\n") || "  (none)"}\n\n` +
  `CHANGED:\n${changed.map((f) => "  " + f).join("\n") || "  (none)"}\n\n` +
  `REMOVED:\n${removed.map((f) => "  " + f).join("\n") || "  (none)"}\n`);

const shown = interesting.slice(0, MAX_ON_SHEET);
const CELL = 200, PAD = 8, LABEL = 26, COLS = 8, HEAD = 50;
const rows = Math.ceil(shown.length / COLS);
const W = COLS * (CELL + PAD) + PAD;
const H = HEAD + rows * (CELL + LABEL + PAD) + PAD;

const comps = [];
for (let i = 0; i < shown.length; i++) {
  const x = PAD + (i % COLS) * (CELL + PAD);
  const y = HEAD + Math.floor(i / COLS) * (CELL + LABEL + PAD);
  try {
    const buf = await sharp(path.join(IMG_DIR, shown[i]))
      .resize(CELL, CELL, { fit: "contain", background: { r: 252, g: 252, b: 251, alpha: 1 } })
      .flatten({ background: { r: 252, g: 252, b: 251 } })
      .png().toBuffer();
    comps.push({ input: buf, left: x, top: y });
  } catch {
    // Unreadable source. The gap on the sheet is itself worth seeing.
  }
  const tag = added.includes(shown[i]) ? "NEW" : "CHANGED";
  const label = `${tag}  ${shown[i]}`.slice(0, 30).replace(/[<&>]/g, "");
  comps.push({
    input: Buffer.from(`<svg width="${CELL}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="14" font-family="monospace" font-size="10" fill="${tag === "NEW" ? "#6c2a55" : "#6b6673"}">${label}</text></svg>`),
    left: x, top: y + CELL + 2,
  });
}

const capped = interesting.length > MAX_ON_SHEET ? `  ·  showing ${MAX_ON_SHEET} of ${interesting.length} — full list in ${SOURCE}-changed.txt` : "";
comps.push({
  input: Buffer.from(`<svg width="${W}" height="${HEAD}" xmlns="http://www.w3.org/2000/svg">
    <text x="10" y="21" font-family="sans-serif" font-size="16" fill="#1a1a1e">${SOURCE} — ${added.length} new, ${changed.length} changed${capped}</text>
    <text x="10" y="39" font-family="sans-serif" font-size="12" fill="#6b6673">Anything here that is not a photograph of a real product needs deactivating before it sells.</text></svg>`),
  left: 0, top: 4,
});

const sheet = path.join(OUT_DIR, `${SOURCE}-review.png`);
await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite(comps).png().toFile(sheet);

if (!PEEK) {
  manifest[SOURCE] = current;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
}

console.log(`[image-review] LOOK AT THIS: import-review/${SOURCE}-review.png`);
if (capped) console.log(`[image-review] full list: import-review/${SOURCE}-changed.txt`);
