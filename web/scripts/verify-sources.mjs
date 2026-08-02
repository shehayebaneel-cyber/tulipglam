/**
 * Fail if anything under the product-image sources has changed without going through an import.
 *
 *     node scripts/verify-sources.mjs          # exits 1 on any difference
 *
 * Runs as the FIRST step of `npm run build`, so a modified source cannot become a deploy.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────
 *
 * `image-build.mjs` refuses to write outside `public/i`, and that guard is real — but it is a
 * rule one script chooses to obey. Nothing stopped a different script from writing under
 * `public/products/`, and on 2 Aug one of mine tried to: a test simulating a "changed supplier
 * image" rewrote a real source file. It failed, and it failed because Windows happened to have
 * the file open. Luck wearing a uniform.
 *
 * The lesson this repository already learned about test rows in the production database is that
 * the fix is to make the wrong thing structurally hard, not behaviourally avoided. This is that
 * treatment for the sources: the ONLY thing that may change them is an importer, because an
 * importer is the only thing that updates the manifest afterwards. Every other write — a script,
 * an editor, a stray `sharp().toFile()` — leaves a hash that does not match and stops the build.
 *
 * ── WHY THE MANIFEST, RATHER THAN A NEW MECHANISM ──────────────────────────────────
 *
 * `import-review/manifest.json` already holds a content hash of every source file, because the
 * import contact sheet needs to know what changed. Integrity and review are the same question
 * asked twice, so they share one answer rather than drifting apart as two.
 *
 * It is committed, so the baseline travels with the repository instead of living on one machine
 * — which is what makes this structural rather than a local habit. A filesystem ACL would be
 * stronger on this laptop and would not survive a clone, a CI runner, or the Hetzner box.
 *
 * ── THE LEGITIMATE PATH ────────────────────────────────────────────────────────────
 *
 * Refresh imagery -> run the importer -> `image-review.mjs` rebaselines the manifest and shows
 * you a contact sheet of what arrived. Sources changed, manifest changed, build passes, and you
 * SAW the new pictures. That is the whole intended loop, and nothing else reproduces it.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(HERE, "..", "public", "products");
const MANIFEST = path.resolve(HERE, "..", "..", "import-review", "manifest.json");

if (!fs.existsSync(MANIFEST)) {
  console.log("[verify-sources] no manifest yet — run image-review.mjs per source to baseline.");
  process.exit(0);
}
if (!fs.existsSync(SRC_ROOT)) {
  console.log("[verify-sources] no product sources on disk — nothing to verify.");
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const hashOf = (abs) => crypto.createHash("sha1").update(fs.readFileSync(abs)).digest("hex").slice(0, 16);

const problems = [];
let checked = 0;

for (const source of fs.readdirSync(SRC_ROOT)) {
  const dir = path.join(SRC_ROOT, source);
  if (!fs.statSync(dir).isDirectory()) continue;

  const expected = manifest[source];
  if (!expected) {
    problems.push(`${source}/  — a whole source directory with no baseline. Run: node scripts/image-review.mjs ${source}`);
    continue;
  }

  const onDisk = fs.readdirSync(dir);
  for (const f of onDisk) {
    checked++;
    const want = expected[f];
    if (!want) { problems.push(`${source}/${f}  — APPEARED without an import`); continue; }
    if (hashOf(path.join(dir, f)) !== want) problems.push(`${source}/${f}  — CONTENT CHANGED`);
  }
  for (const f of Object.keys(expected)) {
    if (!onDisk.includes(f)) problems.push(`${source}/${f}  — DELETED`);
  }
}

if (problems.length === 0) {
  console.log(`[verify-sources] ${checked} source images unchanged.`);
  process.exit(0);
}

console.error(`\n[verify-sources] REFUSING TO BUILD — ${problems.length} source image(s) changed outside an import.\n`);
for (const p of problems.slice(0, 25)) console.error(`  ${p}`);
if (problems.length > 25) console.error(`  …and ${problems.length - 25} more`);

console.error(`
  Product image sources are the one thing in this repository that cannot be regenerated.
  Everything else — derivatives, the database, the site — is rebuilt from them.

  If an importer just ran, it should have rebaselined the manifest and written a contact
  sheet. If it did not, run it for that source and LOOK at the sheet:

      cd web && node scripts/image-review.mjs <source>

  If you did not expect this, restore the files before doing anything else:

      git checkout -- web/public/products/
`);
process.exit(1);
