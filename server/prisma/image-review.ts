import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Put this import's new and changed imagery on a contact sheet, at the end of the run.
 *
 * ── WHY IT SHELLS OUT ──────────────────────────────────────────────────────────────
 *
 * `sharp` is a web devDependency — it is the image pipeline's tool and it has no business in
 * the server's production dependency tree, which runs on a box that only needs to serve. So the
 * sheet is built by `web/scripts/image-review.mjs` in a child process rather than by installing
 * a second copy of a native module on the server side.
 *
 * ── IT CANNOT FAIL AN IMPORT ───────────────────────────────────────────────────────
 *
 * By the time this runs, thousands of rows are already written and the catalogue is live. A
 * review sheet is a thing to LOOK at afterwards; if sharp is missing, or the folder moved, or
 * the child crashes, that is worth a warning and nothing more. Failing the import over it would
 * turn a helpful habit into a liability — which is the same reason it is not an approval gate.
 */
export function reviewImportedImages(source: string): void {
  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..", "..", "web", "scripts", "image-review.mjs",
  );

  try {
    const r = spawnSync(process.execPath, [script, source], { stdio: "inherit" });
    if (r.status !== 0) {
      console.warn(`\n  [image-review] could not build the review sheet (exit ${r.status}).`);
      console.warn(`  The import itself is fine. Run it by hand when convenient:`);
      console.warn(`      cd web && node scripts/image-review.mjs ${source}\n`);
    }
  } catch (e) {
    console.warn(`\n  [image-review] skipped: ${e instanceof Error ? e.message : String(e)}`);
    console.warn(`  The import itself is fine.\n`);
  }
}
