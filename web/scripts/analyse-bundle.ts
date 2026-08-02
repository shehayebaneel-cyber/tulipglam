import type { Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";

/**
 * Per-module breakdown of what ends up in the JavaScript bundle.
 *
 *     ANALYSE=1 npm run build      # writes bundle-report.txt alongside dist/
 *
 * ── MEASUREMENT ONLY ───────────────────────────────────────────────────────────────
 *
 * This deletes nothing and changes no output. First contentful paint on this store is owned by
 * the 438 KB script — the image work cut payload by 95% and moved FCP by nothing, because the
 * page cannot paint until React has parsed and run. So script weight is the next thing worth
 * attacking, and the image work went well precisely because it was measured before it was
 * touched. This is that step, and only that step.
 *
 * ── WHY NO ANALYSER DEPENDENCY ─────────────────────────────────────────────────────
 *
 * Vite 8 builds on Rolldown, and the established visualisers are written against Rollup's plugin
 * surface — adding one means betting on compatibility and carrying a dependency to answer a
 * question that gets asked twice a year. `generateBundle` already receives every chunk with its
 * module map and each module's rendered length, which is the number actually wanted. Reading
 * what the bundler already knows beats installing something to ask it.
 *
 * ── WHAT THE NUMBERS ARE, AND WHAT THEY ARE NOT ────────────────────────────────────
 *
 * **`renderedLength` here is PRE-minification.** The first version of this file asserted it was
 * post-minification and told the reader that removing a module saves roughly its figure. That
 * was wrong, and the bundle said so plainly: react-dom reported 449 KB while the entire chunk
 * containing it emits 438 KB. A module cannot be larger than the file it lives in.
 *
 * So the KB column is **relative weight, not a savings budget**. What it answers well is "which
 * modules dominate", which is the question being asked. To make that concrete, each chunk's
 * modules are also scaled by that chunk's own `emitted / sum(modules)` ratio, giving an estimated
 * share of real output bytes — clearly labelled as an estimate, because minification does not
 * compress every module equally and the scaling is an average, not a measurement.
 *
 * Gzip is deliberately not reported per module: gzip ratios differ per module and per-module
 * gzipped figures do not sum to the gzipped total, so reading them as a budget misleads in a
 * second, subtler way.
 */
export function analyseBundle(): Plugin {
  return {
    name: "tulipglam-analyse-bundle",
    apply: "build",

    generateBundle(_options, bundle) {
      type Row = { id: string; bytes: number; chunk: string };
      const rows: Row[] = [];
      const chunkTotals: { name: string; bytes: number }[] = [];

      for (const [fileName, out] of Object.entries(bundle)) {
        if (out.type !== "chunk") continue;
        chunkTotals.push({ name: fileName, bytes: out.code.length });
        for (const [id, mod] of Object.entries(out.modules ?? {})) {
          const bytes = (mod as { renderedLength?: number }).renderedLength ?? 0;
          if (bytes > 0) rows.push({ id, bytes, chunk: fileName });
        }
      }

      if (rows.length === 0) {
        this.warn("[analyse] the bundler exposed no module map — report skipped");
        return;
      }

      /** node_modules/<pkg> (scoped packages kept whole), or the source path. */
      const bucket = (id: string): string => {
        const norm = id.replace(/\\/g, "/");
        const nm = norm.lastIndexOf("node_modules/");
        if (nm === -1) {
          const src = norm.indexOf("/src/");
          return src === -1 ? norm : "src" + norm.slice(src + 4);
        }
        const after = norm.slice(nm + "node_modules/".length);
        const parts = after.split("/");
        return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
      };

      const byBucket = new Map<string, number>();
      for (const r of rows) byBucket.set(bucket(r.id), (byBucket.get(bucket(r.id)) ?? 0) + r.bytes);

      const total = [...byBucket.values()].reduce((a, b) => a + b, 0);
      const sorted = [...byBucket.entries()].sort((a, b) => b[1] - a[1]);
      const kb = (b: number) => (b / 1024).toFixed(1).padStart(7) + " KB";
      const pct = (b: number) => ((b / total) * 100).toFixed(1).padStart(5) + "%";

      const vendor = sorted.filter(([n]) => !n.startsWith("src"));
      const own = sorted.filter(([n]) => n.startsWith("src"));
      const sum = (xs: [string, number][]) => xs.reduce((a, [, b]) => a + b, 0);

      /**
       * Per-chunk scaling: emitted bytes / summed module bytes.
       *
       * Module lengths are pre-minification, so they overstate. Scaling by what the chunk
       * ACTUALLY emitted turns relative weight into an estimated share of real output — an
       * average, not a measurement, and labelled as such wherever it appears.
       */
      const chunkScale = new Map<string, number>();
      for (const c of chunkTotals) {
        const modSum = rows.filter((r) => r.chunk === c.name).reduce((a, r) => a + r.bytes, 0);
        chunkScale.set(c.name, modSum > 0 ? c.bytes / modSum : 1);
      }
      const realish = (r: Row) => r.bytes * (chunkScale.get(r.chunk) ?? 1);
      const bucketReal = new Map<string, number>();
      for (const r of rows) bucketReal.set(bucket(r.id), (bucketReal.get(bucket(r.id)) ?? 0) + realish(r));
      const est = (name: string) => ((bucketReal.get(name) ?? 0) / 1024).toFixed(1).padStart(7) + " KB";

      const out: string[] = [];
      out.push("TulipGlam — bundle composition");
      out.push("");
      out.push("MEASUREMENT ONLY — nothing here was changed or removed.");
      out.push("");
      out.push("The KB column is PRE-MINIFICATION source weight. It is NOT a savings budget:");
      out.push("react-dom reports more than the whole chunk it lives in. Read it as 'which");
      out.push("modules dominate'. The `est` column scales each module by its own chunk's");
      out.push("emitted/source ratio — an average, so an estimate, not a measurement.");
      out.push("");
      out.push(`  total module bytes   ${kb(total)}`);
      out.push(`  dependencies         ${kb(sum(vendor))}  ${pct(sum(vendor))}   ${vendor.length} packages`);
      out.push(`  our own source       ${kb(sum(own))}  ${pct(sum(own))}   ${own.length} files`);
      out.push("");
      out.push("EMITTED FILES (what actually crosses the network)");
      for (const c of chunkTotals.sort((a, b) => b.bytes - a.bytes).slice(0, 12)) {
        out.push(`  ${kb(c.bytes)}   ${c.name}`);
      }
      out.push("");
      out.push("DEPENDENCIES, heaviest first        (src weight / share / est. output)");
      for (const [name, bytes] of vendor.slice(0, 30)) out.push(`  ${kb(bytes)}  ${pct(bytes)}  est ${est(name)}   ${name}`);
      out.push("");
      out.push("OUR SOURCE, heaviest first          (src weight / share / est. output)");
      for (const [name, bytes] of own.slice(0, 30)) out.push(`  ${kb(bytes)}  ${pct(bytes)}  est ${est(name)}   ${name}`);
      out.push("");
      out.push("WHICH CHUNK EACH HEAVY MODULE LANDED IN");
      for (const r of rows.sort((a, b) => b.bytes - a.bytes).slice(0, 20)) {
        out.push(`  ${kb(r.bytes)}   ${r.chunk.padEnd(34)} ${bucket(r.id)}`);
      }

      const dest = path.resolve(process.cwd(), "..", "bundle-report.txt");
      fs.writeFileSync(dest, out.join("\n") + "\n");
      console.log(`\n[analyse] wrote bundle-report.txt — ${sorted.length} buckets, ${kb(total)} of module code\n`);
    },
  };
}
