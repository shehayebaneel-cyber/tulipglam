/**
 * Build display derivatives for every product image.
 *
 *     node scripts/image-build.mjs              # dry run — reports, writes nothing
 *     node scripts/image-build.mjs --write      # build
 *     node scripts/image-build.mjs --write --force   # rebuild even if up to date
 *     node scripts/image-build.mjs --write --only feel22
 *
 * ── SOURCES ARE READ-ONLY, ALWAYS ──────────────────────────────────────────────────
 *
 * Everything under `public/products/` is opened for reading and never written, renamed or
 * removed. Output goes to `public/i/` and nowhere else, so a botched run is fixed by deleting
 * `public/i` and running this again. That is not a convention — it is enforced below: the
 * writer refuses any destination path that is not inside `public/i`.
 *
 * ── WHAT THE MEASUREMENTS SAID, AND WHAT THAT CHANGED ──────────────────────────────
 *
 * `image-scan.mjs` over all 10,110 files:
 *
 *   · 98.2% are ALREADY SQUARE. The grid is not ragged because the corpus is ragged — it is
 *     ragged because 179 files are not square and nothing pins the box. So this pads rather
 *     than crops: cropping 9,931 correct images to fix 179 would be vandalism at scale, and
 *     a cropped cosmetic loses the cap, the shade name, the part a customer is looking for.
 *   · 8,312 of them are PNG, 700 MB of the 794 MB total, averaging 84 KB. PNG is a lossless
 *     format meant for line art; these are photographs. This conversion is where the speed
 *     comes from, not the resizing.
 *   · 57.3% carry an ALPHA CHANNEL — transparent cut-outs. Flattening those onto white would
 *     print a visible white box on a #FCFCFB page, so transparency is preserved and the pad
 *     colour is transparent wherever the source had alpha.
 *
 * ── NEVER UPSCALE ──────────────────────────────────────────────────────────────────
 *
 * Most sources are 600x600, and the largest slot asks for 800. Enlarging a 600px photo to 800
 * invents detail that was never there and makes a bigger file that looks worse. Each slot is
 * capped at the source's own longest side, so the output is square and sharp, just sometimes
 * smaller than the slot's nominal size. The CSS box is a fixed square either way, so a smaller
 * file changes nothing about layout.
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(HERE, "..", "public", "products");
const OUT_ROOT = path.resolve(HERE, "..", "public", "i");

const WRITE = process.argv.includes("--write");
const FORCE = process.argv.includes("--force");
const onlyAt = process.argv.indexOf("--only");
const ONLY = onlyAt > -1 ? process.argv[onlyAt + 1] : null;

/**
 * The slots, and the CSS size each one actually renders at.
 *
 * Measured against the 390px viewport that is the design target, not chosen for roundness:
 *
 *   thumb  a cart / checkout / order line, ~72 CSS px  -> 200 covers 2.5x density
 *   card   a two-up grid cell, ~175 CSS px             -> 400 covers 2x, 600 covers 3x
 *   hero   the product page image, ~358 CSS px         -> 800 covers 2x
 *
 * `card` gets two widths because the product grid is the single most downloaded surface on the
 * site — it is what a category page is — and it is the one place a density switch pays for the
 * extra build time.
 */
const SLOTS = [
  { name: "thumb", size: 200 },
  { name: "card", size: 400 },
  { name: "card2x", size: 600 },
  { name: "hero", size: 800 },
];

const QUALITY = 78;

const files = [];
for (const src of fs.readdirSync(SRC_ROOT)) {
  const dir = path.join(SRC_ROOT, src);
  if (!fs.statSync(dir).isDirectory()) continue;
  if (ONLY && src !== ONLY) continue;
  for (const f of fs.readdirSync(dir)) files.push({ src, file: f, abs: path.join(dir, f) });
}

console.log(`${WRITE ? "BUILDING" : "DRY RUN"} — ${files.length} sources x ${SLOTS.length} slots\n`);

/** Refuse to write anywhere but `public/i`. The sources are the one thing that cannot be rebuilt. */
function assertSafe(dest) {
  const resolved = path.resolve(dest);
  if (!resolved.startsWith(OUT_ROOT + path.sep)) {
    throw new Error(`REFUSING to write outside public/i: ${resolved}`);
  }
}

/** `/products/feel22/foo.png` -> `/i/card/feel22/foo.webp`. Mirrored in web/src/lib/img.ts. */
const outPathFor = (slot, src, file) =>
  path.join(OUT_ROOT, slot, src, file.replace(/\.[a-z0-9]+$/i, "") + ".webp");

const suspects = [];
const flag = (rec, why, detail) => suspects.push({ ...rec, why, detail });

let built = 0, skipped = 0, failed = 0, srcBytes = 0, outBytes = 0;
const CONCURRENCY = 8;
let cursor = 0;

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (cursor < files.length) {
    const f = files[cursor++];
    const rec = { src: f.src, file: f.file };

    try {
      const meta = await sharp(f.abs).metadata();
      const stat = await fs.promises.stat(f.abs);
      srcBytes += stat.size;

      const w = meta.width ?? 0, h = meta.height ?? 0;
      const longest = Math.max(w, h);
      const ratio = w && h ? w / h : 1;

      // ── flags that are about the SOURCE, raised whether or not we rebuild ──────────
      //
      // Deliberately raised before any work: these are the images automation will quietly
      // mangle, and a count of "10,110 processed" would hide every one of them.
      if (longest < 300) flag(rec, "low-resolution source", `${w}x${h} — soft at card size`);
      if (ratio < 0.7 || ratio > 1.4) flag(rec, "far from square", `${w}x${h} (ratio ${ratio.toFixed(2)}) — padding will be visible`);
      if (/gemini|generated|midjourney|dall-?e|stable-?diffusion/i.test(f.file)) {
        flag(rec, "filename suggests AI-generated", f.file);
      }

      for (const slot of SLOTS) {
        const dest = outPathFor(slot.name, f.src, f.file);
        assertSafe(dest);

        // Up to date AND non-trivial. Size matters here: an interrupted write leaves a short
        // file whose mtime is perfectly current, so a date-only check would accept a truncated
        // image as finished and never rebuild it. 100 bytes is below any real WebP header.
        if (!FORCE && fs.existsSync(dest)) {
          const d = fs.statSync(dest);
          if (d.mtimeMs >= stat.mtimeMs && d.size > 100) { skipped++; outBytes += d.size; continue; }
        }
        if (!WRITE) { built++; continue; }

        // Never bigger than the source's own longest side — see the header note on upscaling.
        const cap = Math.min(slot.size, longest);
        const pad = meta.hasAlpha
          ? { r: 0, g: 0, b: 0, alpha: 0 }
          : { r: 255, g: 255, b: 255, alpha: 1 };

        await fs.promises.mkdir(path.dirname(dest), { recursive: true });

        /**
         * Retry a WRITE failure, not a decode failure.
         *
         * The first full run lost 3 files out of 40,000 to "unable to open for write: Invalid
         * argument" — not corrupt sources, and not the same files twice. This repository lives
         * inside a OneDrive folder, and OneDrive takes brief locks on files it is syncing; at
         * forty thousand writes in a few minutes, collisions are certain. Retrying clears them.
         *
         * A decode error (`libpng read error`) is a genuinely broken source and retrying it just
         * fails three times more slowly, so only write-side errors are retried.
         */
        let info, lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            info = await sharp(f.abs)
              .resize(cap, cap, { fit: "contain", background: pad, withoutEnlargement: false })
              .webp({ quality: QUALITY, effort: 4, alphaQuality: 90 })
              .toFile(dest);
            break;
          } catch (e) {
            lastErr = e;
            if (!/unable to open for write|EBUSY|EPERM|EACCES/i.test(String(e.message ?? e))) throw e;
            await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
          }
        }
        if (!info) throw lastErr;

        outBytes += info.size;
        built++;

        // ── flags that are about the OUTPUT ───────────────────────────────────────────
        if (slot.name === "card") {
          // A card that is one flat colour is a blank tile in a grid — the most visible
          // possible failure, and invisible in a success count.
          const stats = await sharp(dest).stats();
          const visible = stats.channels.slice(0, 3);
          const flat = visible.every((c) => c.stdev < 3);
          if (flat) flag(rec, "output is nearly one flat colour", `stdev ${visible.map((c) => c.stdev.toFixed(1)).join("/")}`);
          if (stats.isOpaque === false && stats.channels[3] && stats.channels[3].max === 0) {
            flag(rec, "output is fully transparent", "alpha max 0");
          }
          if (info.size > stat.size) {
            flag(rec, "derivative larger than source", `${(info.size / 1024).toFixed(0)}KB vs ${(stat.size / 1024).toFixed(0)}KB`);
          }
        }
      }
    } catch (e) {
      failed++;
      flag(rec, "FAILED to process", String(e.message ?? e).slice(0, 160));
    }
  }
}));

console.log(`built ${built}   skipped(up-to-date) ${skipped}   failed ${failed}`);
if (WRITE) {
  console.log(`\nsource total   ${(srcBytes / 1e6).toFixed(0)} MB`);
  console.log(`derivatives    ${(outBytes / 1e6).toFixed(0)} MB  (all ${SLOTS.length} slots)`);
}

// Deduped by file — one image with three problems is one line, not three.
const byFile = new Map();
for (const s of suspects) {
  const k = `${s.src}/${s.file}`;
  if (!byFile.has(k)) byFile.set(k, []);
  byFile.get(k).push(`${s.why}${s.detail ? ` (${s.detail})` : ""}`);
}

console.log(`\n══ ${byFile.size} SUSPECT IMAGES ══`);
console.log("Listed, not hidden in the count. Every one of these is a real file to look at.\n");
const grouped = new Map();
for (const s of suspects) grouped.set(s.why, (grouped.get(s.why) ?? 0) + 1);
for (const [why, n] of [...grouped].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${why}`);

if (WRITE || process.argv.includes("--list")) {
  const out = path.resolve(HERE, "..", "..", "IMAGE-SUSPECTS.txt");
  const lines = [...byFile.entries()].sort().map(([k, whys]) => `${k}\n    ${whys.join("\n    ")}`);
  fs.writeFileSync(out, `${byFile.size} suspect images, from ${files.length} sources\nGenerated by web/scripts/image-build.mjs\n\n${lines.join("\n")}\n`);
  console.log(`\nfull list -> IMAGE-SUSPECTS.txt`);
}
