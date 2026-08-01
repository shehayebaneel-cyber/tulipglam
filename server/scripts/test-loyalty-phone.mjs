/**
 * The Lebanese phone normaliser — src/loyalty/phone.ts
 *
 *     node --import tsx scripts/test-loyalty-phone.mjs
 *
 * Pure function, so this needs no server and no database. `--import tsx` is only there to load
 * the TypeScript module; no test runner is added, and the file follows the existing
 * scripts/test-*.mjs convention.
 *
 * This is the identity key for the entire loyalty program. The failure that costs money is not
 * a rejection — it is one human normalising two ways and ending up with two accounts holding
 * half a balance each. So the tests below are built around EQUIVALENCE CLASSES: every way a
 * single real number can be written must collapse to one string.
 */
import { readFileSync } from "node:fs";
import {
  normaliseLebanesePhone,
  toE164,
  formatLebanesePhone,
} from "../src/loyalty/phone.ts";

let pass = 0, fail = 0;
const ck = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${extra}`); }
};
const section = (t) => console.log(`\n${t}`);

/** Every spelling of one number must produce the same E.164. */
function equivalenceClass(label, expected, spellings) {
  const results = spellings.map((s) => ({ s, r: normaliseLebanesePhone(s) }));
  const bad = results.filter((x) => !x.r.ok || x.r.e164 !== expected);
  ck(
    `${label} — ${spellings.length} spellings all give ${expected}`,
    bad.length === 0,
    bad.map((x) => `${JSON.stringify(x.s)}→${x.r.ok ? x.r.e164 : x.r.reason}`).join("  "),
  );
}

// ════════════════════════════════════════════════════════════ the real number
section("The store's own number, written every way a customer might:");
equivalenceClass("81 643 633", "+96181643633", [
  "+96181643633",
  "96181643633",
  "0096181643633",
  "+961 81 643 633",
  "+961-81-643-633",
  "+961 81 643633",
  "961 81 643 633",
  "81643633",
  "081643633",
  "81 643 633",
  "81-643-633",
  "(81) 643 633",
  "  +961 81 643 633  ",
  "+961.81.643.633",
  "+961/81/643/633",
  "00 961 81 643 633",
]);

// ════════════════════════════════════════════════════════════ every mobile block
section("Every mobile prefix, local and international spellings:");
for (const [local, e164] of [
  ["03 123 456", "+9613123456"],
  ["70 123 456", "+96170123456"],
  ["71 123 456", "+96171123456"],
  ["76 123 456", "+96176123456"],
  ["78 123 456", "+96178123456"],
  ["79 123 456", "+96179123456"],
  ["81 123 456", "+96181123456"],
]) {
  const bare = local.replace(/\s/g, "");
  equivalenceClass(local, e164, [local, bare, bare.replace(/^0/, ""), `+961${bare.replace(/^0/, "")}`, `961${bare.replace(/^0/, "")}`]);
}

section("A prefix not yet allocated still normalises — operators get new blocks:");
{
  const r = normaliseLebanesePhone("82 123 456");
  ck("82xxxxxx is accepted as a mobile", r.ok && r.e164 === "+96182123456" && r.kind === "mobile",
    r.ok ? r.e164 : r.reason);
  ck("  ...because a hardcoded prefix list would reject real customers the day 82 is issued", true);
}

// ════════════════════════════════════════════════════════════ the classic trap
section("The 7-vs-70 trap — length is what disambiguates:");
{
  const landline = normaliseLebanesePhone("07 123 456");   // South Lebanon landline, 7 digits
  const mobile   = normaliseLebanesePhone("70 123 456");   // mobile, 8 digits
  ck("07 123456 is a 7-digit LANDLINE", landline.ok && landline.nsn === "7123456" && landline.kind === "landline",
    landline.ok ? `${landline.nsn} ${landline.kind}` : landline.reason);
  ck("70 123456 is an 8-digit MOBILE", mobile.ok && mobile.nsn === "70123456" && mobile.kind === "mobile",
    mobile.ok ? `${mobile.nsn} ${mobile.kind}` : mobile.reason);
  ck("  ...and they are DIFFERENT accounts", landline.ok && mobile.ok && landline.e164 !== mobile.e164,
    `${landline.ok && landline.e164} vs ${mobile.ok && mobile.e164}`);

  const landline8 = normaliseLebanesePhone("08 123 456");
  const mobile81  = normaliseLebanesePhone("81 123 456");
  ck("08 123456 is a Bekaa LANDLINE, not a mobile", landline8.ok && landline8.kind === "landline");
  ck("81 123456 is a MOBILE, not a Bekaa landline", mobile81.ok && mobile81.kind === "mobile");
  ck("  ...and they too are different accounts", landline8.ok && mobile81.ok && landline8.e164 !== mobile81.e164);
}

section("Landline area codes:");
for (const [local, e164, area] of [
  ["01 234 567", "+9611234567", "Beirut"],
  ["04 123 456", "+9614123456", "Metn"],
  ["05 123 456", "+9615123456", "Aley/Chouf"],
  ["06 123 456", "+9616123456", "North"],
  ["07 123 456", "+9617123456", "South"],
  ["08 123 456", "+9618123456", "Bekaa"],
  ["09 123 456", "+9619123456", "Keserwan"],
]) {
  const r = normaliseLebanesePhone(local);
  ck(`${local} (${area}) → ${e164}`, r.ok && r.e164 === e164 && r.kind === "landline", r.ok ? r.e164 : r.reason);
}

// ════════════════════════════════════════════════════════════ hostile input
section("Characters that arrive from phones, spreadsheets and WhatsApp:");
{
  const cases = [
    ["non-breaking spaces", "+961 81 643 633"],
    ["narrow no-break space", "+961 81 643 633"],
    ["en dash", "+961–81–643–633"],
    ["em dash", "+961—81—643—633"],
    ["figure dash", "+961‒81‒643‒633"],
    ["minus sign", "+961−81−643−633"],
    ["zero-width space", "+961​81643633"],
    ["Arabic-Indic digits", "+٩٦١٨١٦٤٣٦٣٣"],
    ["Eastern Arabic digits", "+۹۶۱۸۱۶۴۳۶۳۳"],
  ];
  for (const [label, input] of cases) {
    const r = normaliseLebanesePhone(input);
    ck(label, r.ok && r.e164 === "+96181643633", r.ok ? r.e164 : `${r.reason}: ${r.detail}`);
  }
}

section("Every invisible character, one at a time:");
{
  // The first draft of the normaliser claimed to strip these and did not — the zero-width space
  // fell straight through and the number was rejected as "not a number". These are named and
  // tested individually because a character you cannot see is one you cannot debug from a bug
  // report, and because a number carrying one must never key differently from the same number
  // without it.
  const invisible = {
    "zero-width space": 0x200b,
    "zero-width non-joiner": 0x200c,
    "zero-width joiner": 0x200d,
    "word joiner": 0x2060,
    "byte-order mark": 0xfeff,
    "soft hyphen": 0x00ad,
    "no-break space": 0x00a0,
    "narrow no-break space": 0x202f,
    "figure space": 0x2007,
    "ideographic space": 0x3000,
    "fullwidth hyphen-minus": 0xff0d,
    "minus sign": 0x2212,
  };
  for (const [name, cp] of Object.entries(invisible)) {
    const c = String.fromCodePoint(cp);
    const r = normaliseLebanesePhone(`+961${c}81${c}643${c}633`);
    ck(`${name} (U+${cp.toString(16).toUpperCase().padStart(4, "0")}) is stripped`,
      r.ok && r.e164 === "+96181643633", r.ok ? r.e164 : `${r.reason}: ${r.detail}`);
  }
  // The invariant those individual cases add up to.
  const withJunk = "​+ 961 81 643­633⁠";
  ck("a number wearing five of them at once still keys the same",
    normaliseLebanesePhone(withJunk).e164 === normaliseLebanesePhone("+96181643633").e164);
}

section("The source file itself contains no invisible characters:");
{
  // Belt and braces on the above. The separator class is built from code points precisely so a
  // reformat cannot silently drop one; this asserts nobody has since pasted a literal back in.
  const src = readFileSync(new URL("../src/loyalty/phone.ts", import.meta.url), "utf8");
  const found = [...src].filter((ch) => {
    const p = ch.codePointAt(0);
    return (p >= 0x200b && p <= 0x200f) || p === 0x2060 || p === 0xfeff ||
      p === 0x00ad || p === 0x00a0 || (p >= 0x2000 && p <= 0x200a) || p === 0x202f;
  });
  ck("phone.ts is free of literal invisible characters", found.length === 0,
    `${found.length} found — the class must stay built from SEPARATOR_CODE_POINTS`);
}

section("Rejected, with a reason — never guessed at:");
{
  const cases = [
    ["empty string", "", "empty"],
    ["only spaces", "   ", "empty"],
    ["null", null, "empty"],
    ["undefined", undefined, "empty"],
    ["just a plus", "+", "empty"],
    ["letters", "not a phone", "not-a-number"],
    ["email address", "someone@example.com", "not-a-number"],
    ["mixed letters and digits", "+961 81 ABC 633", "not-a-number"],
    ["French mobile", "+33612345678", "foreign"],
    ["UAE mobile", "+971501234567", "foreign"],
    ["Saudi mobile", "00966501234567", "foreign"],
    ["too short", "12345", "bad-length"],
    ["too long", "+961812345678901", "bad-length"],
    ["7 digits starting 0 after trunk strip", "+9610123456", "bad-prefix"],
    ["8-digit starting 2", "+96121234567", "bad-prefix"],
    ["8-digit starting 3", "+96131234567", "bad-prefix"],
  ];
  for (const [label, input, expected] of cases) {
    const r = normaliseLebanesePhone(input);
    ck(`${label} → ${expected}`, !r.ok && r.reason === expected, r.ok ? `accepted as ${r.e164}` : `got ${r.reason}`);
  }
  ck("nothing ever throws", true); // reaching here at all proves it
}

section("A foreign number is refused, not mangled into a Lebanese one:");
{
  const fr = normaliseLebanesePhone("+33612345678");
  ck("+33 6 12 34 56 78 is rejected", !fr.ok && fr.reason === "foreign", fr.ok ? fr.e164 : fr.reason);
  ck("  ...it does NOT become a Beirut number", !fr.ok || !String(fr.e164).startsWith("+9616"));
}

// ════════════════════════════════════════════════════════════ the invariants
section("Invariants:");
{
  const corpus = [
    "+96181643633", "96181643633", "081643633", "81643633", "03 123 456", "70123456",
    "01 234 567", "+961 79 000 001", "00961 76 555 444", "  +961-71-222-333  ",
    "+٩٦١٨١٦٤٣٦٣٣", "09 123 456",
  ];

  const notIdempotent = corpus.filter((s) => {
    const once = normaliseLebanesePhone(s);
    if (!once.ok) return false;
    const twice = normaliseLebanesePhone(once.e164);
    return !twice.ok || twice.e164 !== once.e164;
  });
  ck("idempotent — normalise(normalise(x)) === normalise(x)", notIdempotent.length === 0, notIdempotent.join(" "));

  const shapeWrong = corpus
    .map((s) => normaliseLebanesePhone(s))
    .filter((r) => r.ok && !/^\+961\d{7,8}$/.test(r.e164));
  ck("every accepted value matches ^\\+961\\d{7,8}$", shapeWrong.length === 0, shapeWrong.map((r) => r.e164).join(" "));

  const kindWrong = corpus
    .map((s) => normaliseLebanesePhone(s))
    .filter((r) => r.ok && r.kind !== "mobile" && r.kind !== "landline");
  ck("every accepted value has a kind", kindWrong.length === 0);

  // A pure function must not depend on call order or anything outside its argument.
  const twiceOver = corpus.map((s) => JSON.stringify(normaliseLebanesePhone(s)));
  const againReversed = [...corpus].reverse().map((s) => JSON.stringify(normaliseLebanesePhone(s))).reverse();
  ck("pure — same answers regardless of call order", twiceOver.join("|") === againReversed.join("|"));
}

section("Collision safety — distinct numbers must stay distinct:");
{
  // The whole point of the key. If any two real, different numbers collapse to one string,
  // two customers share a balance.
  const distinct = [
    "03123456", "70123456", "71123456", "76123456", "78123456", "79123456", "81123456",
    "01234567", "04123456", "05123456", "06123456", "07123456", "08123456", "09123456",
    "81643633", "81643634",
  ];
  const keys = distinct.map((s) => toE164(s));
  const unique = new Set(keys);
  ck(`${distinct.length} different numbers → ${unique.size} different keys`, unique.size === distinct.length,
    keys.filter((k, i) => keys.indexOf(k) !== i).join(" "));
  ck("  ...and none of them failed to normalise", !keys.includes(""));
}

section("Helpers:");
{
  ck("toE164 returns the key", toE164("081643633") === "+96181643633", toE164("081643633"));
  ck("toE164 returns \"\" for junk rather than throwing", toE164("nonsense") === "");
  ck("formatLebanesePhone is readable", formatLebanesePhone("81643633") === "+961 81 643 633", formatLebanesePhone("81643633"));
  ck("  ...for 7-digit numbers too", formatLebanesePhone("03123456") === "+961 3 123 456", formatLebanesePhone("03123456"));
  ck("  ...and echoes junk back unchanged", formatLebanesePhone("nonsense") === "nonsense");
}

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exit(fail ? 1 : 0);
