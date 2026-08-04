/**
 * A contact sheet per shelf — the aisles, as a customer meets them.
 *
 *     node scripts/shelf-gallery.mjs
 *
 * Writes one PNG per category to `shots/shelves/`, plus an index. Reads only.
 *
 * ── WHY SHELVES AND NOT PRODUCTS ───────────────────────────────────────────────────
 *
 * The classification pass reads product NAMES. Names carry most of the signal here — they are
 * long and descriptive — but a rule that is subtly wrong is wrong across a whole shelf, and
 * that is invisible one product at a time. Twelve pictures of "Makeup > Lips" side by side
 * shows a stray shampoo instantly; the same shampoo in a list of a thousand names does not.
 *
 * So this is the picture check, done at the level where a wrong rule actually shows itself.
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "..", "..", "shots", "shelves");
const PRODUCTS = path.resolve(HERE, "..", "..", "products-shelves.json");

if (!fs.existsSync(PRODUCTS)) {
  console.error("Run the exporter first — products-shelves.json is missing.");
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const rows = JSON.parse(fs.readFileSync(PRODUCTS, "utf8"));
const byShelf = new Map();
for (const r of rows) {
  const k = `${r.dept} > ${r.cat}`;
  if (!byShelf.has(k)) byShelf.set(k, []);
  byShelf.get(k).push(r);
}

const CELL = 190, PAD = 10, LABEL = 30, COLS = 6, HEAD = 54;
const index = [];

for (const [shelf, items] of [...byShelf.entries()].sort((a, b) => b[1].length - a[1].length)) {
  // Up to 18 per shelf: enough to see whether the aisle is coherent, few enough to take in
  // at a glance. A sheet nobody can scan in five seconds is a sheet nobody scans.
  const shown = items.slice(0, 18);
  const rowsN = Math.ceil(shown.length / COLS);
  const W = COLS * (CELL + PAD) + PAD;
  const H = HEAD + rowsN * (CELL + LABEL + PAD) + PAD;
  const comps = [];

  for (let i = 0; i < shown.length; i++) {
    const x = PAD + (i % COLS) * (CELL + PAD);
    const y = HEAD + Math.floor(i / COLS) * (CELL + LABEL + PAD);
    const p = shown[i];
    // Read the generated card derivative, matching what the storefront actually serves.
    const rel = (p.img || "").replace(/^\/products\//, "");
    const file = rel ? path.resolve(HERE, "..", "public", "i", "card", rel.replace(/\.[a-z0-9]+$/i, ".webp")) : "";
    if (file && fs.existsSync(file)) {
      try {
        const buf = await sharp(file).resize(CELL, CELL, { fit: "contain", background: { r: 252, g: 252, b: 251, alpha: 1 } })
          .flatten({ background: { r: 252, g: 252, b: 251 } }).png().toBuffer();
        comps.push({ input: buf, left: x, top: y });
      } catch { /* unreadable derivative — the gap is itself worth seeing */ }
    }
    const label = p.name.slice(0, 30).replace(/[<&>]/g, "");
    comps.push({
      input: Buffer.from(`<svg width="${CELL}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="12" font-family="sans-serif" font-size="9" fill="#1a1a1e">${label}</text>
        <text x="0" y="24" font-family="sans-serif" font-size="8" fill="#6b6673">${(p.tags || "").slice(0, 44)}</text></svg>`),
      left: x, top: y + CELL + 2,
    });
  }

  comps.push({
    input: Buffer.from(`<svg width="${W}" height="${HEAD}" xmlns="http://www.w3.org/2000/svg">
      <text x="10" y="24" font-family="sans-serif" font-size="18" fill="#1a1a1e">${shelf.replace(/[<&>]/g, "")}</text>
      <text x="10" y="42" font-family="sans-serif" font-size="12" fill="#6b6673">${items.length} products${items.length > 18 ? ` — showing 18` : ""}   ·   second line under each is its filter tags</text></svg>`),
    left: 0, top: 4,
  });

  const safe = shelf.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const dest = path.join(OUT, `${safe}.png`);
  await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(comps).png().toFile(dest);
  index.push({ shelf, count: items.length, file: `${safe}.png` });
  console.log(`  ${String(items.length).padStart(4)}  ${shelf}`);
}

fs.writeFileSync(path.join(OUT, "_index.json"), JSON.stringify(index, null, 1));
console.log(`\n${index.length} shelf sheets -> shots/shelves/`);
