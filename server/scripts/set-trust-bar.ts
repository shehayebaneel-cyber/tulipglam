/**
 * Turn the homepage trust bar off, or back on.
 *
 *     npx tsx scripts/set-trust-bar.ts            # dry run — prints, changes nothing
 *     npx tsx scripts/set-trust-bar.ts --off --write
 *     npx tsx scripts/set-trust-bar.ts --defaults --write   # restore the shipped three
 *
 * ── WHY A SCRIPT FOR ONE SETTING ───────────────────────────────────────────────────
 *
 * The database is shared with production and every write is instantly live, so this repository's
 * standing rule is that data changes go through a dry-run-by-default script that prints what it
 * would do. One row is no exception — it is the row that decides what three claims the homepage
 * makes about the business.
 *
 * ── OFF IS A VALUE, NOT AN ABSENCE ─────────────────────────────────────────────────
 *
 * `trustItems` unset means "never configured" and shows the shipped defaults. `trustItems` set
 * to an empty string means "the owner said no" and shows nothing. Writing the empty string is
 * therefore a real edit, not a deletion, and `--defaults` puts the original three back verbatim.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const WRITE = process.argv.includes("--write");
const OFF = process.argv.includes("--off");
const DEFAULTS = process.argv.includes("--defaults");

/** Verbatim copies of the shipped defaults, so `--defaults` restores rather than reinvents. */
const SHIPPED = [
  "Cash on delivery|Pay when it arrives, anywhere in Lebanon",
  "Check your order anytime|Track by order number, no login needed",
  "Sourced to order|We confirm every item with you before dispatch",
].join("\n");

async function main() {
  const row = await db.setting.findUnique({ where: { key: "trustItems" } });
  const current = row?.value ?? null;

  console.log(`current trustItems: ${current === null ? "(not set — homepage shows the shipped defaults)" : current === "" ? '(set to empty — bar hidden)' : JSON.stringify(current)}`);

  if (!OFF && !DEFAULTS) {
    console.log("\nNothing asked for. Pass --off or --defaults (add --write to apply).");
    return;
  }

  const next = OFF ? "" : SHIPPED;
  console.log(`\nwould set trustItems to: ${next === "" ? "(empty string — the bar disappears)" : "\n  " + next.split("\n").join("\n  ")}`);

  if (!WRITE) { console.log("\nDry run. Re-run with --write to apply."); return; }

  await db.setting.upsert({ where: { key: "trustItems" }, create: { key: "trustItems", value: next }, update: { value: next } });
  console.log(`\napplied. Reversible: npx tsx scripts/set-trust-bar.ts --${OFF ? "defaults" : "off"} --write`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  // finally, with no process.exit() above it — that pattern once left test rows in production.
  .finally(async () => { await db.$disconnect(); });
