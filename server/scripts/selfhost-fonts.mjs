/**
 * Pull the two brand faces off Google Fonts and host them ourselves.
 *
 *     node scripts/selfhost-fonts.mjs
 *
 * ── WHY ────────────────────────────────────────────────────────────────────────────
 *
 * `<link rel="stylesheet" href="https://fonts.googleapis.com/...">` is render-blocking AND on
 * another origin. Before a single word appears, the browser must resolve fonts.googleapis.com,
 * do a TLS handshake, fetch the CSS, discover fonts.gstatic.com inside it, resolve THAT, do a
 * second handshake, and only then start the font files. At the 150 ms round trip a Lebanese
 * mobile connection actually has, those handshakes alone are most of a second of blank screen —
 * before any bytes of type have moved.
 *
 * Self-hosted, the files come off a connection that is already open, and the CSS is inlined.
 *
 * It is also a privacy improvement the store gets for free: no visitor's IP is handed to a
 * third party in order to read the shop's own name.
 *
 * ── WEIGHTS ────────────────────────────────────────────────────────────────────────
 *
 * Only the weights the design actually uses, and only the latin + latin-ext subsets. The
 * original request asked for five weights of Hanken Grotesk and three cuts of Fraunces
 * including an italic that nothing on the site sets. That is 100 KB of type for a page whose
 * whole job is to look fast.
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("../web/public/fonts");
const CSS_OUT = path.resolve("../web/src/fonts.css");

// A modern UA so Google serves woff2 rather than ttf.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/**
 * What the site genuinely uses.
 *
 * Hanken Grotesk: 400 body, 500 medium, 600 semibold, 700 bold. 800 was requested and is used
 * nowhere — dropped.
 * Fraunces: 400 and 500 only. The italic cut was requested and is never set.
 */
const FAMILIES = [
  { name: "Hanken Grotesk", css: "Hanken+Grotesk:wght@400;500;600;700", weights: [400, 500, 600, 700] },
  { name: "Fraunces", css: "Fraunces:opsz,wght@9..144,400;9..144,500", weights: [400, 500] },
];

const WANT_SUBSETS = new Set(["latin", "latin-ext"]);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const blocks = [];
  let bytes = 0;

  for (const fam of FAMILIES) {
    const url = `https://fonts.googleapis.com/css2?family=${fam.css}&display=swap`;
    const css = await (await fetch(url, { headers: { "user-agent": UA } })).text();

    /**
     * Google's CSS is a run of @font-face blocks, each preceded by a `/* subset *\/` comment.
     *
     * BOTH FACES ARE VARIABLE. For a variable font Google emits ONE file per subset with a
     * weight RANGE — `font-weight: 400 700` — not one file per weight. The first version of
     * this script matched the first number of that range and downloaded the identical file
     * four times under four names: 460 KB of fonts where Google was serving 100.
     *
     * So: dedupe by URL, and keep the range verbatim.
     */
    const parts = css.split("/*").slice(1);
    /** url -> { subset, unicodeRange, weights[] }. One entry per FILE, not per declaration. */
    const files = new Map();

    for (const part of parts) {
      const subset = part.slice(0, part.indexOf("*/")).trim();
      if (!WANT_SUBSETS.has(subset)) continue;

      const block = part.slice(part.indexOf("*/") + 2);
      const src = block.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1];
      const weight = block.match(/font-weight:\s*([0-9\s]+?);/)?.[1]?.trim();
      const italic = /font-style:\s*italic/.test(block);
      const range = block.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
      if (!src || !weight || italic) continue;

      const entry = files.get(src) ?? { subset, range, weights: [] };
      for (const w of weight.split(/\s+/)) entry.weights.push(Number(w));
      files.set(src, entry);
    }

    for (const [src, entry] of files) {
      const wanted = entry.weights.filter((w) => fam.weights.includes(w));
      if (wanted.length === 0) continue;
      const lo = Math.min(...wanted), hi = Math.max(...wanted);

      const slug = `${fam.name.toLowerCase().replace(/\s+/g, "-")}-${entry.subset}.woff2`;
      const buf = Buffer.from(await (await fetch(src, { headers: { "user-agent": UA } })).arrayBuffer());
      fs.writeFileSync(path.join(OUT, slug), buf);
      bytes += buf.length;

      blocks.push(
        `@font-face {\n` +
        `  font-family: '${fam.name}';\n` +
        `  font-style: normal;\n` +
        // A RANGE, because this is one variable file covering every weight. Emitting a single
        // weight here — which an earlier version of this script did, by deduping on the URL and
        // keeping the first declaration — leaves 500/600/700 with no real face, so the browser
        // fakes bold by smearing the 400. It looks almost right, which is the problem.
        `  font-weight: ${lo === hi ? lo : `${lo} ${hi}`};\n` +
        // swap, so text is readable in the fallback face immediately rather than invisible
        // while the real one downloads. On a slow connection that is the difference between
        // reading the shop's name at one second and at three.
        `  font-display: swap;\n` +
        `  src: url('/fonts/${slug}') format('woff2');\n` +
        // unicode-range keeps latin-ext on disk and OFF the wire for a customer who never
        // types a character that needs it.
        (entry.range ? `  unicode-range: ${entry.range};\n` : "") +
        `}`,
      );
      console.log(`  ${slug.padEnd(34)} weight ${(lo === hi ? String(lo) : `${lo}-${hi}`).padEnd(9)} ${(buf.length / 1024).toFixed(1)} KB`);
    }
  }

  fs.writeFileSync(
    CSS_OUT,
    `/*\n` +
    ` * Self-hosted brand faces. Generated by server/scripts/selfhost-fonts.mjs — do not edit by hand.\n` +
    ` *\n` +
    ` * These used to load from fonts.googleapis.com, which put two DNS lookups and two TLS\n` +
    ` * handshakes on the render-blocking path before a single word could appear. At the 150 ms\n` +
    ` * round trip a Lebanese mobile connection has, that was most of a second of blank screen.\n` +
    ` *\n` +
    ` * Only the weights the design uses: Hanken Grotesk 400/500/600/700, Fraunces 400/500.\n` +
    ` * The 800 weight and the Fraunces italic were requested and used nowhere.\n` +
    ` */\n\n` + blocks.join("\n\n") + "\n",
  );

  console.log(`\n  ${blocks.length} faces, ${(bytes / 1024).toFixed(0)} KB total -> web/public/fonts/`);
  console.log(`  CSS written to web/src/fonts.css`);
}

main().catch((e) => { console.error(e); process.exit(1); });
