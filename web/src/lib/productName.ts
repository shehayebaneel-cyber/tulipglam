/**
 * The part of a product's name worth showing when the brand is already on screen.
 *
 * ── THE PROBLEM, MEASURED ──────────────────────────────────────────────────────────
 *
 * **6,148 of 6,662 active products — 92.3% — have a name that starts with their own brand.**
 * "Huda Beauty Lip Contour Lip Stain For 12-Hour Wear", brand Huda Beauty. That is how the
 * suppliers' feeds are written and it is not wrong; it is just redundant next to a card that
 * already prints the brand on its own line.
 *
 * On a 390px card the title gets two lines. When the first line and a half is a brand the
 * reader has just read, the words that distinguish one product from another fall off the end.
 * Four different Yves Saint Laurent perfumes rendered as four identical-looking cards reading
 * "Yves Saint Laurent Le Vestiaire des Parfums…" — Lavalliere, Jumpsuit, Jumpsuit Vibrant
 * Magnolia and Lavalliere Luscious Fig, indistinguishable on the page they are sold from.
 *
 * That is worse than a duplicate bug, because it looks like one. My first reading of the
 * screenshot was that related products were repeating; the API said four distinct ids.
 *
 * ── DISPLAY ONLY ───────────────────────────────────────────────────────────────────
 *
 * `Product.name` is the owner's content and is not rewritten — no bulk UPDATE, no importer
 * change, nothing touched in the database. This trims for rendering, at the call site, only
 * where the brand is displayed alongside. The admin tables, order records and search all keep
 * the full stored name.
 */

/**
 * Strip a leading brand from a product name, or return it unchanged.
 *
 * Conservative on purpose — a name that becomes shorter or stranger is worse than a redundant
 * one, so it declines whenever the result would not obviously be an improvement:
 *
 *   · no brand, or the name does not start with it -> unchanged
 *   · the remainder is under 3 characters          -> unchanged ("Mavala Mavala" stays)
 *   · the remainder has no letter                  -> unchanged ("Chanel No 5" must not become "No 5"
 *                                                     if the brand happened to be "Chanel No")
 *
 * The match is case-insensitive and must be followed by whitespace, so brand "Dali" never
 * matches product "Dalimix" — only "Dali Cuticle Oil".
 */
export function nameWithoutBrand(name: string, brand: string | null | undefined): string {
  if (!name || !brand) return name;

  const n = name.trim();
  const b = brand.trim();
  if (b.length === 0 || n.length <= b.length) return name;
  if (n.slice(0, b.length).toLowerCase() !== b.toLowerCase()) return name;

  // Must be a word boundary: the character after the brand has to be whitespace or a separator,
  // otherwise "Dali" would eat the start of "Dalimix".
  const next = n[b.length];
  if (!/[\s–—-]/.test(next)) return name;

  const rest = n.slice(b.length).replace(/^[\s–—-]+/, "").trim();
  if (rest.length < 3) return name;
  if (!/[a-z]/i.test(rest)) return name;

  return rest;
}
