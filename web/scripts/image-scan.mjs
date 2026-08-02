/**
 * Measure the image corpus before touching a single file.
 *
 *     node scripts/image-scan.mjs            # summary
 *     node scripts/image-scan.mjs --json out.json
 *
 * Reads HEADERS ONLY — sharp's metadata() does not decode pixels — so ten thousand files take
 * seconds rather than minutes. Writes nothing anywhere.
 *
 * The point is to replace assumptions with numbers before designing the pipeline. The claim in
 * CLAUDE.md is that Feel22 ships "600x600 renditions ~81 KB each"; the file listing says 8,311
 * of the 10,110 files are PNG, which is not what a Shopify _600x600 rendition normally is. One
 * of those is wrong and the pipeline should not be designed on top of the wrong one.
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "products");
const jsonAt = process.argv.indexOf("--json");
const OUT = jsonAt > -1 ? process.argv[jsonAt + 1] : null;

const files = [];
for (const src of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, src);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) files.push({ src, file: f, abs: path.join(dir, f) });
}

console.log(`scanning ${files.length} files under web/public/products/…\n`);

const rows = [];
const CONCURRENCY = 16;
let cursor = 0, done = 0;

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (cursor < files.length) {
    const f = files[cursor++];
    try {
      const [m, stat] = await Promise.all([sharp(f.abs).metadata(), fs.promises.stat(f.abs)]);
      rows.push({
        src: f.src, file: f.file, bytes: stat.size,
        w: m.width, h: m.height, format: m.format,
        // An alpha channel on a product photo is usually a transparent cut-out. That decides
        // whether a letterboxed square needs a background colour or would look like a hole.
        alpha: !!m.hasAlpha,
        ratio: m.width && m.height ? +(m.width / m.height).toFixed(3) : null,
      });
    } catch (e) {
      rows.push({ src: f.src, file: f.file, error: String(e.message ?? e).slice(0, 120) });
    }
    if (++done % 2000 === 0) console.log(`  …${done}`);
  }
}));

const ok = rows.filter((r) => !r.error);
const bad = rows.filter((r) => r.error);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const pct = (n) => `${((n / ok.length) * 100).toFixed(1)}%`;

const bucket = (xs, key) => {
  const m = new Map();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`\n══ ${ok.length} readable, ${bad.length} unreadable ══\n`);

console.log("format          count      total MB   avg KB");
for (const [fmt, n] of bucket(ok, (r) => r.format)) {
  const these = ok.filter((r) => r.format === fmt);
  const mb = sum(these.map((r) => r.bytes)) / 1e6;
  console.log(`  ${fmt.padEnd(12)}${String(n).padStart(6)}${mb.toFixed(0).padStart(12)}${(mb * 1000 / n).toFixed(0).padStart(9)}`);
}

console.log("\ntop dimensions");
for (const [dim, n] of bucket(ok, (r) => `${r.w}x${r.h}`).slice(0, 12)) {
  console.log(`  ${dim.padEnd(14)}${String(n).padStart(6)}  ${pct(n)}`);
}

/**
 * The number that decides the whole grid problem.
 *
 * If everything were square the listings would already be uniform and the fix would be pure
 * compression. Anything else means a tall bottle sits beside a squat jar and the shelf reads as
 * a jumble no matter what CSS is applied to it.
 */
const squares = ok.filter((r) => r.w === r.h).length;
console.log(`\nsquare (w === h):     ${squares}  ${pct(squares)}`);
console.log(`portrait (h > w):     ${ok.filter((r) => r.h > r.w).length}`);
console.log(`landscape (w > h):    ${ok.filter((r) => r.w > r.h).length}`);
console.log(`with alpha channel:   ${ok.filter((r) => r.alpha).length}  ${pct(ok.filter((r) => r.alpha).length)}`);

const ratios = ok.filter((r) => r.ratio).map((r) => r.ratio).sort((a, b) => a - b);
const q = (p) => ratios[Math.floor(ratios.length * p)];
console.log(`\naspect ratio spread   min ${ratios[0]}  p05 ${q(0.05)}  median ${q(0.5)}  p95 ${q(0.95)}  max ${ratios[ratios.length - 1]}`);

console.log(`\nlargest single files`);
for (const r of [...ok].sort((a, b) => b.bytes - a.bytes).slice(0, 6)) {
  console.log(`  ${(r.bytes / 1e6).toFixed(1)} MB  ${r.w}x${r.h} ${r.format}  ${r.src}/${r.file}`);
}

console.log(`\nTOTAL ON DISK: ${(sum(ok.map((r) => r.bytes)) / 1e6).toFixed(0)} MB`);
if (bad.length) {
  console.log(`\nUNREADABLE (${bad.length}):`);
  for (const b of bad.slice(0, 20)) console.log(`  ${b.src}/${b.file} — ${b.error}`);
}

if (OUT) { fs.writeFileSync(OUT, JSON.stringify(rows, null, 1)); console.log(`\nwrote ${OUT}`); }
