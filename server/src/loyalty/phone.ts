/**
 * Lebanese phone numbers → E.164, as a pure function.
 *
 * This is the identity key for the whole loyalty program, so it is written and tested before
 * anything is wired to it. The failure that matters is not rejection — it is the SAME human
 * normalising two different ways in two different places, which silently creates two accounts
 * holding half a balance each. Merging those afterwards means reconciling two ledgers by hand.
 *
 * Guarantees:
 *   - Pure. No I/O, no clock, no config.
 *   - Idempotent: normalise(normalise(x)) === normalise(x).
 *   - Total: every input returns a result; nothing throws.
 *   - Refuses rather than guesses. A number it cannot place with confidence is rejected with a
 *     reason, because a wrong match hands one customer another customer's purchase history.
 *
 * ── The Lebanese numbering plan ────────────────────────────────────────────────────
 * Country code 961. The national significant number (NSN) is 7 or 8 digits:
 *
 *   8 digits   mobile      70 71 76 78 79 81 …  + 6 subscriber digits
 *   7 digits   mobile      3                    + 6 subscriber digits
 *   7 digits   landline    1 4 5 6 7 8 9        + 6 subscriber digits   (Beirut is 1)
 *
 * Written locally with a leading zero — 03 123456, 70 123456, 01 234567 — which is a trunk
 * prefix, not part of the number, and is dropped in E.164.
 *
 * Length is what disambiguates 07 (a South Lebanon landline, 7 digits) from 70 (a mobile,
 * 8 digits). Both start with a 7. Getting that backwards is the classic bug here.
 */

/** The country calling code. Only Lebanon is supported — see `foreign` in the reason list. */
const LEBANON_CC = "961";

/**
 * Leading digits of an 8-digit mobile NSN.
 *
 * Deliberately a range check (7x / 8x) rather than a list of live operator prefixes. Operators
 * get new blocks allocated over time, and a hardcoded list quietly starts rejecting real
 * customers the day 82 is issued. An 8-digit NSN beginning 7 or 8 is a mobile in this plan.
 */
const MOBILE_8_LEADING = ["7", "8"];

/** Leading digit of a 7-digit NSN: 3 is the original mobile block, the rest are landline areas. */
const MOBILE_7_LEADING = "3";
const LANDLINE_7_LEADING = ["1", "4", "5", "6", "7", "8", "9"];

export type PhoneKind = "mobile" | "landline";

export type PhoneResult =
  | { ok: true; e164: string; nsn: string; kind: PhoneKind }
  | { ok: false; reason: PhoneReason; detail: string };

export type PhoneReason =
  /** Nothing usable in the input at all. */
  | "empty"
  /** Contains letters, so it is not a number someone mistyped — it is a different kind of value. */
  | "not-a-number"
  /** A country code that is not Lebanon's. */
  | "foreign"
  /** Right shape, wrong length for any Lebanese number. */
  | "bad-length"
  /** Correct length, but no valid Lebanese number starts with those digits. */
  | "bad-prefix";

/**
 * Everything that is decoration rather than digits, as CODE POINTS.
 *
 * Built from numbers rather than written as a literal character class, because a third of these
 * are INVISIBLE. A source file containing them literally is one careless editor, copy-paste or
 * reformat away from silently losing one — and then the same number normalises differently
 * depending on where it was pasted from, which is precisely the split-account bug this module
 * exists to prevent. The first draft of this file shipped exactly that: a zero-width space it
 * claimed to strip and did not.
 *
 * This form is also greppable and diffable. An invisible character in a regex is neither.
 */
const SEPARATOR_CODE_POINTS = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, // tab, LF, VT, FF, CR, space
  0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, // no-break space, and the en/em quad family
  0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, // three/four/six-per-em, figure, punct, thin
  0x200a, 0x202f, 0x205f, 0x3000, //                 hair, narrow no-break, medium math, ideographic
  0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, //         zero-width space/NJ/J/word-joiner/BOM - INVISIBLE
  0x00ad, //                                         soft hyphen - invisible until the line wraps
  0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, // hyphen, non-breaking hyphen, figure/en/em/bar
  0x2212, 0xfe63, 0xff0d, //                         minus sign, small and fullwidth hyphen-minus
  0x0028, 0x0029, 0x005b, 0x005d, //                 ( ) [ ]
  0x002e, 0x002c, 0x002d, 0x002f, 0x005c, //         . , - / backslash
];

const SEPARATORS = new RegExp(
  `[${SEPARATOR_CODE_POINTS.map((c) => "\\u" + c.toString(16).padStart(4, "0")).join("")}]`,
  "gu",
);

/** Arabic-Indic and Eastern Arabic-Indic digits, which a Lebanese keyboard can produce. */
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toAsciiDigit = (ch: string): string => {
  const code = ch.codePointAt(0)!;
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  return ch;
};

/**
 * Normalise one number.
 *
 * @param raw anything a human or a form might supply
 */
export function normaliseLebanesePhone(raw: string | null | undefined): PhoneResult {
  const input = String(raw ?? "");

  // 1. Strip decoration and translate non-ASCII digits, keeping a leading + if present.
  const cleaned = input.replace(ARABIC_DIGITS, toAsciiDigit).replace(SEPARATORS, "");

  if (cleaned === "") return fail("empty", "no digits in the input");

  const hadPlus = cleaned.startsWith("+");
  const body = hadPlus ? cleaned.slice(1) : cleaned;

  if (body === "") return fail("empty", "no digits after the +");
  if (!/^\d+$/.test(body)) return fail("not-a-number", `contains non-digits: ${trunc(input)}`);

  // 2. Peel the country code off, however it was written.
  //    "00" is the international access prefix used across Lebanon and most of the world.
  let afterCc = body;
  const hadZeroZero = afterCc.startsWith("00");
  if (hadZeroZero) afterCc = afterCc.slice(2);

  if (afterCc.startsWith(LEBANON_CC)) {
    afterCc = afterCc.slice(LEBANON_CC.length);
  } else if (hadPlus || hadZeroZero) {
    // An explicit international number that is not Lebanese. Rejected rather than mangled:
    // stripping a foreign country code and treating the remainder as local is how a French
    // mobile becomes someone else's Beirut landline.
    return fail("foreign", `country code is not +${LEBANON_CC}: ${trunc(input)}`);
  }

  if (afterCc === "") return fail("empty", `nothing left after the country code: ${trunc(input)}`);

  // 3. Drop the trunk prefix — local writing is 03 / 70 / 01, and that 0 is not part of the
  //    number. Tried as a CANDIDATE rather than applied unconditionally: "+961 03 123 456" is a
  //    common mistake that clearly means +9613123456, so the strip has to happen even after an
  //    explicit country code. But stripping when the result is not a valid number would turn a
  //    7-digit input into a 6-digit one and report a length error about digits the customer
  //    never typed. So: prefer the stripped form, keep the original if only that one is valid,
  //    and report against what they actually wrote when neither is.
  const candidates = afterCc.startsWith("0") ? [afterCc.slice(1), afterCc] : [afterCc];

  for (const nsn of candidates) {
    const kind = classify(nsn);
    if (kind) return { ok: true, e164: `+${LEBANON_CC}${nsn}`, nsn, kind };
  }

  const shown = afterCc;
  if (shown.length !== 7 && shown.length !== 8) {
    return fail("bad-length", `${shown.length} digits after the country code; Lebanese numbers have 7 or 8`);
  }
  return fail("bad-prefix", `no Lebanese number of ${shown.length} digits starts with "${shown.slice(0, 2)}"`);
}

/** The NSN's kind, or null if it is not a number in this plan. */
function classify(nsn: string): PhoneKind | null {
  if (nsn.length === 8) return MOBILE_8_LEADING.includes(nsn[0]) ? "mobile" : null;
  if (nsn.length === 7) {
    if (nsn[0] === MOBILE_7_LEADING) return "mobile";
    if (LANDLINE_7_LEADING.includes(nsn[0])) return "landline";
  }
  return null;
}

const fail = (reason: PhoneReason, detail: string): PhoneResult => ({ ok: false, reason, detail });
const trunc = (s: string) => (s.length > 32 ? `${s.slice(0, 32)}…` : s);

/**
 * The E.164 string, or "" if the number is unusable.
 *
 * For call sites that only need the key and have already decided what an unusable number means.
 * Anything that reports back to a human should use `normaliseLebanesePhone` and show the reason.
 */
export const toE164 = (raw: string | null | undefined): string => {
  const r = normaliseLebanesePhone(raw);
  return r.ok ? r.e164 : "";
};

/** Display form: "+961 81 643 633". Never stored — the stored value is always `e164`. */
export function formatLebanesePhone(raw: string | null | undefined): string {
  const r = normaliseLebanesePhone(raw);
  if (!r.ok) return String(raw ?? "");
  const { nsn } = r;
  const head = nsn.length === 8 ? nsn.slice(0, 2) : nsn.slice(0, 1);
  const rest = nsn.slice(head.length);
  return `+${LEBANON_CC} ${head} ${rest.slice(0, 3)} ${rest.slice(3)}`.trim();
}
