/**
 * Run every suite and print what each one actually asserted.
 *
 *     npm run test:all            # no writes
 *     npm run test:all -- --write # + the suites that need real rows
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────
 *
 * The check counts in CLAUDE.md drifted. Three of them were wrong at once — a suite had grown
 * by one, another by twelve, a third had lost one — and the owner's objection is the right one:
 * a wrong number in the source of truth is how the NEXT session learns to distrust a green
 * suite. Once you are mentally discounting the documented figure, a suite that has quietly
 * stopped running looks exactly like one that has.
 *
 * So the counts stop being copied by hand. This prints them, and the totals line is what goes
 * in a commit message. If the file and this disagree, this is right.
 *
 * It is deliberately not a test runner. It shells out to the same standalone scripts you would
 * run individually, in the same order, with the same flags — so there is no second execution
 * path that could pass while the real one fails.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WRITE = process.argv.includes("--write");
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `needsWrite`: the suite is a no-op without real rows, so it is skipped rather than lying. */
const SUITES = [
  { file: "test-loyalty-ledger.mjs", needsWrite: true },
  { file: "test-loyalty-rewards.mjs", needsWrite: true },
  { file: "test-loyalty-phone.mjs", needsWrite: false },
  { file: "test-loyalty-admin.mjs", needsWrite: true },
  { file: "test-loyalty-hooks.mjs", needsWrite: true },
  // Needs --write: the gift-card refund, the outbox claim race and the starvation ceiling are
  // all assertions about what the DATABASE does under concurrency, and there is no honest way
  // to check them without rows. Without it the suite reports 30 of its 46 checks.
  { file: "test-verdicts.mjs", needsWrite: true },
  { file: "test-redemption.mjs", needsWrite: true },
  { file: "test-security.mjs", needsWrite: true },
  { file: "test-dispatch.mjs", needsWrite: true },
  { file: "test-outbox.mjs", needsWrite: true },
  { file: "test-observe.mjs", needsWrite: false },
  { file: "test-checkout-money.mjs", needsWrite: true },
  { file: "test-password-reset.mjs", needsWrite: true },
  { file: "test-coming-soon.mjs", needsWrite: false },
  { file: "test-gate-bypass.mjs", needsWrite: false },
  { file: "test-launch-list.mjs", needsWrite: true },
  { file: "test-product-requests.mjs", needsWrite: true },
  // Needs `web/dist`: in dev, Vite serves index.html and no head injection runs, so without a
  // build this suite reports a pass over a page that was never rendered the way production
  // renders it. Skipped loudly rather than counted.
  { file: "test-seo.mjs", needsWrite: false, needsBuild: true },
];

const run = (file, args) => new Promise((resolve) => {
  const child = spawn(process.execPath, ["--import", "tsx", path.join(HERE, file), ...args], {
    cwd: path.join(HERE, ".."),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  child.on("close", (code) => resolve({ code, out }));
});

let totalPassed = 0, totalFailed = 0, ran = 0, skipped = 0;
const rows = [];

for (const s of SUITES) {
  if (s.needsWrite && !WRITE) {
    rows.push([s.file, "—", "needs --write"]);
    skipped++;
    continue;
  }

  // Declared `needsBuild` and then never checked it, in the first version of this file — which
  // would have let a green line stand for a suite reading a page production never serves. The
  // whole point here is that the number means what it says.
  if (s.needsBuild && !existsSync(path.join(HERE, "..", "..", "web", "dist", "index.html"))) {
    rows.push([s.file, "—", "needs `npm run build` in web/"]);
    skipped++;
    continue;
  }

  const { code, out } = await run(s.file, s.needsWrite ? ["--write"] : []);

  /**
   * Counted from the suite's OWN output, not from its exit code.
   *
   * A script that dies before its summary line exits non-zero and reports nothing — which is
   * the failure mode this whole file exists to make visible. A missing count is printed as
   * `no summary` and treated as a failure, because a suite that produced no number did not
   * pass; it stopped.
   */
  const passed = Number(/(\d+) passed/.exec(out)?.[1] ?? NaN);
  const failed = Number(/(\d+) (?:FAILED|failed)/.exec(out)?.[1] ?? 0);

  if (Number.isNaN(passed)) {
    rows.push([s.file, "?", `no summary (exit ${code})`]);
    totalFailed++;
    // Show enough to diagnose it without dumping a whole suite.
    console.log(`\n── ${s.file} produced no summary ──\n${out.trim().split("\n").slice(-12).join("\n")}\n`);
    continue;
  }

  totalPassed += passed;
  totalFailed += failed;
  ran++;
  rows.push([s.file, String(passed), failed ? `${failed} FAILED` : code === 0 ? "" : `exit ${code}`]);

  /**
   * On failure, print the FAILING LINES — not the tail.
   *
   * The first version printed the last 20 lines, which for a suite that fails early is just the
   * summary: "3 FAILED, 7 passed" and no clue which three. That is a report you cannot act on,
   * and it matters more than usual here: `test-redemption.mjs` flakes, the standing theory is
   * Neon's connection ceiling, and that theory only becomes testable after the move to a local
   * Postgres. If a flake produces a count instead of a cause, the theory can never be confirmed
   * — and confirming it is what licenses deleting the accommodations built around it
   * (`BATCH = 40`, sequential materialisation).
   */
  if (failed || code !== 0) {
    const lines = out.split("\n");
    const failures = lines.filter((l) => /FAIL|Error|error:/.test(l));
    console.log(`\n── ${s.file} ──`);
    console.log(failures.length ? failures.join("\n") : lines.slice(-20).join("\n"));
    console.log("");
  }
}

const w = Math.max(...rows.map((r) => r[0].length));
console.log("");
for (const [file, count, note] of rows) {
  console.log(`  ${file.padEnd(w)}  ${count.padStart(4)}  ${note}`);
}
console.log(`  ${"".padEnd(w)}  ${"────".padStart(4)}`);
console.log(`  ${`${ran} suites`.padEnd(w)}  ${String(totalPassed).padStart(4)} checks${skipped ? `   (${skipped} skipped — run with --write)` : ""}`);
if (totalFailed) console.log(`\n  ${totalFailed} FAILED`);
console.log("");

process.exitCode = totalFailed ? 1 : 0;
