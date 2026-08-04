/**
 * Deciding which shelf a product belongs on, and which filters should find it.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────
 *
 * The catalogue came from three feeds with three different ideas of taxonomy. Categories were
 * placed by each importer's own rules and are mostly sound; **`concerns` and `attributes` were
 * empty on all 1,178 active products**, which means two of the storefront's filter groups had
 * nothing behind them at all. A customer opening "Good for" saw an empty list.
 *
 * ── THE VOCABULARY IS DERIVED FROM THE CATALOGUE, NOT FROM THE INDUSTRY ────────────
 *
 * Every tag below was chosen because it appears in at least six real product names, counted
 * before any of this was written. A beauty-industry template would have produced "cruelty-free",
 * "clean", "reef-safe" — plausible, filterable, and matching nothing, which is precisely the
 * failure this codebase spent an audit removing: a filter offering options that return zero
 * products is worse than no filter.
 *
 * ── NAMES, NOT PICTURES, AND SAYING SO ─────────────────────────────────────────────
 *
 * These rules read the product NAME. The names here are unusually descriptive — "Vichy 48 Hour
 * Mineral Spray Deodorant 125ml" — so they carry most of the signal. Pictures are checked at
 * the shelf level afterwards, by rendering contact sheets of each proposed shelf and looking at
 * them, which catches a systematically wrong rule far more reliably than glancing at a thousand
 * thumbnails one at a time would.
 *
 * ── CONSERVATIVE BY CONSTRUCTION ───────────────────────────────────────────────────
 *
 * A product that matches no rule keeps what it has. The default is always "leave it alone",
 * because the cost of moving something correct is the same as the cost of leaving something
 * wrong, and there are far more correct products than wrong ones.
 */

/** What a customer is trying to solve. Counts are occurrences in active product names. */
const CONCERNS: [string, RegExp][] = [
  ["hydration", /hydrat|moistur|nourish/i],            // 54
  ["brightening", /bright|glow|radian|illuminat|whiten/i], // 54 + 48
  /**
   * Dry SKIN, not a dry texture.
   *
   * `\bdry\b` tagged "Dry Feel Oil" and "Dry Touch" sunscreens as being for dryness — the exact
   * opposite of what those names mean, since a dry-feel product is describing how it sits on
   * the skin. Caught by looking at the Serums shelf sheet, where a gold body oil was sitting
   * under a concern it does not address.
   */
  ["dryness", /\bdry (skin|hair|scalp|lips?)\b|\bdryness\b|for dry\b|extra ?dry/i], // 30 -> narrowed
  ["anti-ageing", /anti.?ag|wrinkle|\blift(ing)?\b|firm/i], // 27
  ["damaged-hair", /damag|repair|reconstruct|breakage/i], // 18
  ["sensitive", /sensitiv|gentle|mild/i],               // 14
  ["frizz", /frizz|smooth(ing)?\b|straight/i],          // 10
  ["oily-acne", /oily|acne|blemish|anti.?pimple|purif|sebum/i], // 10
  ["soothing", /sooth|calm|comfort|relief/i],           // 9
  ["exfoliating", /exfoliat|scrub|peel(ing)?\b/i],      // 6
];

/** What the product IS, rather than what it fixes. */
const ATTRIBUTES: [string, RegExp][] = [
  ["gift-set", /gift ?set|\bset\b|\bpcs\b|\d ?pieces?\b/i], // 52
  ["long-wear", /24 ?h|48 ?h|long.?last|long.?wear|12.?hour|all.?day/i], // 28
  ["matte", /\bmatte\b/i],                              // 27
  ["travel-size", /\bmini\b|travel|purse|pocket/i],     // 27
  ["natural", /\bnatural\b|organic|\bbio\b|botanical/i], // 20
  ["spf", /\bspf\b|sun ?screen|\buv\b|sun ?protect/i],  // 19
  ["volumising", /volum|thicken|plump/i],               // 16
  ["vegan", /\bvegan\b/i],                              // 13
  ["waterproof", /waterproof|water.?resistant/i],       // 10
  ["fragrance-free", /fragrance.?free|unscented|perfume.?free/i], // 8
  ["refillable", /refill/i],                            // 7
];

export type Tags = { concerns: string[]; attributes: string[] };

/** Tags for one product, from its name. Empty arrays when nothing matches — never a guess. */
export function tagsFor(name: string): Tags {
  const n = name ?? "";
  return {
    concerns: CONCERNS.filter(([, re]) => re.test(n)).map(([tag]) => tag),
    attributes: ATTRIBUTES.filter(([, re]) => re.test(n)).map(([tag]) => tag),
  };
}

/**
 * Category corrections: a name that flatly contradicts the shelf it is on.
 *
 * Ordered, first match wins, and deliberately few. Each one is a phrase that can only mean one
 * thing — "shampoo" is never a fragrance — because a rule that is merely usually right will
 * move correct products, and there are a hundred correct products for every misplaced one.
 *
 * `notIn` stops a rule firing on a shelf where the word is normal: "Lip Balm" contains "balm"
 * but belongs in Lips, and a body balm does not belong there.
 */
const CATEGORY_RULES: { slug: string; test: RegExp; notIn?: string[]; why: string }[] = [
  // ── Most specific first. The list is a PRECEDENCE order, not a search order. ──────
  //
  // A first version matched the first rule that fired and would have made twenty of its
  // twenty-eight moves worse: "Infallible Foundation SPF" to Sunscreen, "Serum Lipstick" to
  // Serums, "Lifter Serum Concealer" to Serums. Every one of those names contains a real
  // signal — it is just not the signal that decides the shelf. The most specific noun wins,
  // so a lipstick that mentions serum is still a lipstick.

  /**
   * FRAGRANCE FIRST, above every makeup word.
   *
   * "Mugler Angel Blush Eau de Parfum" and "Lattafa Badee Al Oud Noble Blush" are perfumes
   * whose NAMES contain "blush". A makeup rule reading for that word moved both onto the face
   * shelf. "Eau de parfum" is unambiguous in a way no makeup noun can override, so it is
   * settled before anything else gets to look.
   *
   * `notIn` lists all three fragrance shelves: which one is right depends on audience, which
   * is already correct on every one of the 402 fragrances, so this rule must never move a
   * perfume between them.
   */
  { slug: "perfume-unisex", test: /eau de (parfum|toilette|cologne)|\bedp\b|\bedt\b|\bparfum\b/i, notIn: ["perfume-her", "perfume-him", "perfume-unisex", "body-mist"], why: "it is a fragrance" },

  // Hair, above face: "Magic Retouch Hair Roots Concealer" is a hair product that happens to
  // contain the word concealer.
  { slug: "hair-styling", test: /hair ?(roots?|colou?r|dye|spray|gel|mousse|wax)\b|root ?touch/i, notIn: ["hair-styling", "hair-treatments", "shampoo", "conditioner"], why: "it is a hair-styling product" },

  // Makeup product types — what the product IS, so they outrank ingredient or benefit words
  // appearing later in a long marketing name.
  { slug: "lips", test: /lipstick|lip ?gloss|lip ?liner|lip ?balm|lip ?stain|lip ?care|lip ?tint/i, notIn: ["lips"], why: "it is a lip product" },
  // Brows belong with eyes, and "eyebrow concealer" contains both words.
  { slug: "eyes", test: /mascara|eyeliner|eye ?shadow|\bbrow\b|eyebrow|\bkohl\b/i, notIn: ["eyes"], why: "it is an eye-makeup product" },
  { slug: "face", test: /foundation|concealer|\bblush\b|\bbronzer\b|\bhighlighter\b|face ?powder|\bprimer\b/i, notIn: ["face"], why: "it is a face-makeup product" },
  { slug: "nail-colors", test: /nail ?polish|nail ?colou?r|nail ?lacquer|nail ?enamel/i, notIn: ["nail-colors"], why: "it is a nail colour" },

  // Unambiguous single-purpose products.
  { slug: "shampoo", test: /\bshampoo\b/i, notIn: ["shampoo"], why: "it is a shampoo" },
  { slug: "conditioner", test: /\bconditioner\b/i, notIn: ["conditioner"], why: "it is a conditioner" },
  { slug: "deodorant", test: /\bdeodorant\b|\bdeo\b|anti.?perspirant/i, notIn: ["deodorant"], why: "it is a deodorant" },
  { slug: "oral-care", test: /toothpaste|toothbrush|mouthwash|\bdental\b/i, notIn: ["oral-care"], why: "it is oral care" },

  /**
   * Sunscreen means a product whose JOB is sun protection.
   *
   * Not "contains SPF". A day cream with SPF30 is a moisturiser, a foundation with SPF is
   * foundation, and a lip balm with SPF15 is lip care — matching `\bspf ?\d` moved all three
   * onto the sunscreen shelf. The word has to name the product, not an ingredient list.
   */
  { slug: "sunscreen", test: /sun ?screen|sun ?block|sun ?protect|\bsun (cream|fluid|lotion|milk|spray|stick)\b|after ?sun ?screen/i, notIn: ["sunscreen", "after-sun", "suntan"], why: "it is a sunscreen" },

  { slug: "masks", test: /\bface mask\b|\bsheet mask\b|\bclay mask\b/i, notIn: ["masks"], why: "it is a face mask" },

  /**
   * Serum last, and only when nothing more specific claimed the product.
   *
   * "Serum" is the most over-used word in this catalogue — it appears on lipsticks, concealers,
   * foundations and sunscreens as a texture claim. By the time this rule is reached, anything
   * that is really one of those has already been placed.
   */
  { slug: "serums", test: /\bserum\b/i, notIn: ["serums", "hair-treatments", "eye-care", "sunscreen"], why: "it is a face serum" },
];

export type CategoryVerdict = { slug: string; why: string } | null;

/**
 * A corrected category, or null to leave it where it is.
 *
 * `currentSlug` is passed so a rule can decline when the product is already somewhere the word
 * is legitimate — the difference between "this is wrong" and "this word appears".
 */
export function categoryFor(name: string, currentSlug: string): CategoryVerdict {
  for (const r of CATEGORY_RULES) {
    if (!r.test.test(name)) continue;

    /**
     * The FIRST rule that matches decides the product's type. Full stop.
     *
     * The original `continue`d here when the product was already on an acceptable shelf, which
     * let a LESS specific rule further down claim it instead. That is how "Maybelline Serum
     * Lipstick" — correctly filed under Lips — fell past the lip rule and landed in Serums, and
     * how "Lifter Serum Concealer" left Face for the same place. Both were already right.
     *
     * Matching means "this is what the product is". If it is already shelved accordingly there
     * is nothing to do, and nothing further to consider.
     */
    if (r.notIn?.includes(currentSlug)) return null;
    return { slug: r.slug, why: r.why };
  }
  return null;
}

/** Tag vocabularies, exported so the report can list exactly what a customer can filter by. */
export const CONCERN_TAGS = CONCERNS.map(([t]) => t);
export const ATTRIBUTE_TAGS = ATTRIBUTES.map(([t]) => t);
