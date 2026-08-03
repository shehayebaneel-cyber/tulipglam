/**
 * Product requests — validation, storage, and the operator view.
 *
 *     node --import tsx scripts/test-product-requests.mjs --write
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 *  The database is shared with production. --write creates only rows it made itself,
 *  on a reserved phone range, and deletes them in a `finally` that is allowed to run.
 * ══════════════════════════════════════════════════════════════════════════════════
 *
 * Every assertion is written from the sentence stating the requirement, above the check.
 */
const { PrismaClient } = await import("@prisma/client");
const { validateRequest, createRequest, requestSummary } = await import("../src/productRequests.ts");

const WRITE = process.argv.includes("--write");
let pass = 0, fail = 0;
const ck = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${ok ? "" : "  " + x}`); };
const section = (t) => console.log(`\n${t}`);

const db = new PrismaClient();
const made = [];
const TAG = "+9617150099"; // reserved range for this file's rows

try {

section('"a request needs something to look for, and a way to reply" — and nothing else:');
{
  ck("a plain description is enough", validateRequest({ wanted: "that pink Huda lipstick from TikTok", phone: "03123456" }) === null);
  ck("no note required", validateRequest({ wanted: "Vichy Mineral 89", phone: "03123456" }) === null);
  ck("no email required", validateRequest({ wanted: "Vichy Mineral 89", phone: "03123456", email: "" }) === null);
  ck("nothing wanted is rejected", !!validateRequest({ wanted: "", phone: "03123456" })?.wanted);
  ck("no phone is rejected", !!validateRequest({ wanted: "Serum", phone: "" })?.phone);
}

section('"that doesn\'t look like a Lebanese number" — the check that was silently inert:');
{
  // `normaliseLebanesePhone` returns a RESULT OBJECT. The first version tested it for
  // truthiness, which an object always satisfies, so every phone passed. These assert the
  // rejection actually happens rather than that the function was called.
  ck("nonsense is rejected", !!validateRequest({ wanted: "Serum", phone: "abcdef" })?.phone);
  ck("too short is rejected", !!validateRequest({ wanted: "Serum", phone: "12345" })?.phone);
  ck("a local number is accepted", !validateRequest({ wanted: "Serum", phone: "03 123 456" })?.phone);
  ck("an E.164 number is accepted", !validateRequest({ wanted: "Serum", phone: "+96181643633" })?.phone);
}

section("A bad email is refused; an absent one is fine:");
{
  ck("absent is fine", !validateRequest({ wanted: "Serum", phone: "03123456", email: "" })?.email);
  ck("malformed is refused", !!validateRequest({ wanted: "Serum", phone: "03123456", email: "nope@" })?.email);
  ck("valid is accepted", !validateRequest({ wanted: "Serum", phone: "03123456", email: "a@b.co" })?.email);
}

section("Length caps — a public text field is somebody's upload slot:");
{
  ck("an over-long request is refused", !!validateRequest({ wanted: "x".repeat(201), phone: "03123456" })?.wanted);
  ck("an over-long note is refused", !!validateRequest({ wanted: "Serum", note: "x".repeat(601), phone: "03123456" })?.note);
}

if (WRITE) {
  section("Stored the way the rest of the system stores a phone:");
  {
    const r = await createRequest(db, {
      wanted: "  Huda Beauty Lip Contour  ", note: "  shade Trendsetter ",
      phone: "03 150 099", email: "  TEST@Tulipglam-test.invalid ",
      source: "search", searchTerm: "huda lip contour",
    });
    made.push(r.id);
    const row = await db.productRequest.findUnique({ where: { id: r.id } });

    // The loyalty programme keys accounts by E.164. Storing a request any other way means the
    // same person's requests and orders cannot be recognised as the same person later.
    ck("the phone is normalised to E.164", row.phone.startsWith("+961"), row.phone);
    ck("what they wanted is trimmed", row.wanted === "Huda Beauty Lip Contour", `"${row.wanted}"`);
    ck("the email is lowercased", row.email === "test@tulipglam-test.invalid", row.email);
    ck("the entry point is recorded", row.source === "search");
    ck("the search term is kept — the catalogue gap in their words", row.searchTerm === "huda lip contour");
    ck("it starts open", row.status === "open");
    ck("and unhandled", row.handledAt === null);
  }

  section("An unknown entry point cannot be injected through the body:");
  {
    const r = await createRequest(db, { wanted: "Test B", note: "", phone: "03150098", email: "", source: "javascript:alert(1)", searchTerm: "" });
    made.push(r.id);
    const row = await db.productRequest.findUnique({ where: { id: r.id } });
    ck("an unrecognised source falls back to 'page'", row.source === "page", row.source);
  }

  section("A long search term is capped before storage, not after:");
  {
    const r = await createRequest(db, { wanted: "Test C", note: "", phone: "03150097", email: "", source: "search", searchTerm: "y".repeat(500) });
    made.push(r.id);
    const row = await db.productRequest.findUnique({ where: { id: r.id } });
    ck("capped at 120 characters", row.searchTerm.length === 120, String(row.searchTerm.length));
  }

  section("The operator view answers the question that matters — who is waiting longest:");
  {
    const s = await requestSummary(db);
    ck("open requests are counted", s.open >= 3, String(s.open));
    ck("the oldest open age is reported", typeof s.oldestOpenDays === "number", String(s.oldestOpenDays));
    ck("repeated asks surface as a signal", Array.isArray(s.topTerms));
  }
} else {
  console.log("\n  skip  storage checks need --write");
}

} catch (e) {
  fail++;
  console.log(`\n  FAIL  unexpected: ${e.stack?.split("\n").slice(0, 4).join("\n        ")}`);
} finally {
  // Runs to completion. No process.exit() above it — that is how test rows reached production.
  if (made.length) await db.productRequest.deleteMany({ where: { id: { in: made } } });
  const left = await db.productRequest.count({ where: { phone: { startsWith: TAG } } });
  console.log(`\n  cleanup: ${left} test rows left behind (want 0)`);
  if (left) fail++;
  await db.$disconnect();
}

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exitCode = fail ? 1 : 0;
