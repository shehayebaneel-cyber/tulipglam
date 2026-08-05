/** Pull the workflow's per-agent results out of its journal into .night/survey.json. */
import fs from "node:fs";
import path from "node:path";

const journal = process.argv[2];
const out = process.argv[3] || ".night/survey.json";

const rows = fs.readFileSync(journal, "utf8").trim().split("\n")
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

const results = rows.filter((x) => x.type === "result").map((x) => x.result ?? x.value ?? x.output);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ surveys: results }, null, 2));

const all = results.flatMap((s) => (s?.findings || []).map((f) => ({ key: s.key ?? "?", ...f })));
console.log(`saved ${all.length} findings from ${results.length} agents -> ${out}`);
const by = {};
for (const f of all) by[f.severity] = (by[f.severity] || 0) + 1;
console.log("by severity:", JSON.stringify(by));
for (const s of results) console.log(`  ${String(s?.key ?? "?").padEnd(18)} ${(s?.findings || []).length}`);
