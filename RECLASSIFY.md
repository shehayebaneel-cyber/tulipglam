# Filters for every active product — 4 Aug 2026

1,178 active products. Categories reviewed, filter tags built from nothing.

Every change is logged with its previous value. **Undo the whole pass:**

```
cd server && npx tsx scripts/reclassify.ts --undo reclassify-2026-08-04193337
```

Untouched, as instructed: names, photographs, prices, descriptions, and every hidden product.

---

## The headline: two filter groups had nothing behind them

**`concerns` and `attributes` were empty on all 1,178 active products.** The storefront has
"Good for" and "Attributes" filter groups and both returned an empty list — the filter existed,
the data did not.

| | before | after |
|---|---|---|
| products with a concern tag | **0** | **232** |
| products with an attribute tag | **0** | **221** |
| category moves | — | **13** |

Categories were already largely right — the three importers each did rule-based placement — so
the honest finding is that **the shelves were not the problem; the filters were.**

## What a customer can now filter by

Every tag below was chosen because it appears in at least six real product names, counted before
any rule was written. Nothing was imported from a beauty-industry template, because a filter
offering options that return zero products is the exact failure the July audit removed.

**Good for:** brightening 99 · hydration 68 · dryness 23 · sensitive 18 · anti-ageing 18 ·
damaged-hair 18 · oily-acne 14 · frizz 13 · soothing 12 · exfoliating 6

**Attributes:** long-wear 60 · gift-set 53 · volumising 27 · matte 26 · spf 19 · natural 19 ·
vegan 13 · waterproof 10 · fragrance-free 8 · refillable 7 · travel-size 2

## Per-shelf before/after

22 of 34 shelves are unchanged. The 12 that moved:

| shelf | before | after | |
|---|---|---|---|
| Deodorant | 98 | 101 | +3 |
| Makeup > Face | 76 | 78 | +2 |
| Hair > Conditioner | 36 | 38 | +2 |
| Makeup > Lips | 82 | 83 | +1 |
| Hair > Shampoo | 43 | 44 | +1 |
| Skincare > Serums | 29 | 30 | +1 |
| Fragrance > For Him | 154 | 153 | −1 |
| Makeup > Eyes | 71 | 70 | −1 |
| Makeup > Brushes & Tools | 23 | 22 | −1 |
| Skincare > Moisturisers | 34 | 32 | −2 |
| Sun Care > Sunscreen | 25 | 23 | −2 |
| Kids & Baby | 8 | 5 | −3 |

The clearest wins: two Lancôme **deodorants** were filed under Moisturisers, a Calvin Klein
**deodorant stick** under Fragrance > For Him, a Ruby Rose **powder blush** under Brushes &
Tools, and three Johnson's **shampoos and conditioners** under Kids & Baby.

## Additions to the taxonomy

**None.** Everything fitted the existing shelves, so nothing was invented.

One shelf is a candidate and I did **not** act on it: **Makeup > Lips holds 83 products** —
32 lipsticks, 32 balms and lip care, 8 glosses, 4 liners, 4 stains. That is the "eighty
lipsticks and no lipstick filter" case. Splitting it into *Lipstick* and *Lip Care* would work
within the two-level taxonomy, but it changes navigation and SEO for a shelf that is currently
coherent, so it is a proposal rather than something done quietly. Say the word.

## Flag list — 2 items, both genuine coin-flips

| product | placed | was |
|---|---|---|
| Bassam Fattouh **Inner Highlighter** Set of 4 Pieces | Face | Eyes |
| Maybelline **Cloudtopia Blush for Cheeks and Lip** Mousse | Face | Lips |

Both names carry two product types. "Inner highlighter" could mean inner-corner eye highlighter;
"blush for cheeks and lip" is genuinely both. I placed each by the primary noun and flagged it.

## Untagged — 777 products, and mostly correct

`reclassify-untagged.json` lists every product no filter will find. **Most are fragrances**, and
a perfume has no honest answer to "good for" — that is correct output, not a gap. Worth a skim
rather than a work item.

## What the picture check found

The rules read product **names**. To check them against reality I rendered a contact sheet per
shelf — `shots/shelves/`, 34 sheets — and looked at the aisles as a customer meets them. A rule
that is subtly wrong is wrong across a whole shelf, which is visible in twelve pictures side by
side and invisible one product at a time.

It found two real defects:

1. **"Dry Feel Oil" was tagged `dryness`** — the opposite of what the name means, since a
   dry-feel product describes how it sits on skin. The rule now requires "dry skin/hair/scalp/
   lips", which dropped the tag from 30 products to 23. **Fixed.**
2. **"L'Oréal Elvive Hyaluron" sits in Skincare > Serums** — Elvive is a *hair* line. Not fixed:
   catching it needs brand-line knowledge rather than a word rule, and I would rather tell you
   than invent a rule I cannot verify across 1,178 products. **Left in place, listed here.**

## The three rule iterations, because the first two were wrong

The dry run is the reason this shipped 13 moves instead of 28 bad ones.

- **First pass, 28 moves — about 20 would have made things worse.** `\bspf ?\d` matched every
  product *containing* SPF, so "Infallible Foundation SPF" and "Whitening Day Cream SPF30" were
  headed for the Sunscreen shelf. A cream with SPF is a moisturiser.
- **Second pass, 21 moves — a fall-through bug.** When a rule matched but the product was
  already correctly shelved, it continued to a *less specific* rule. That is how "Maybelline
  **Serum** Lipstick" — correctly in Lips — landed in Serums, and "Lifter **Serum** Concealer"
  left Face for the same place. A matched rule now decides the type and stops.
- **Third pass, 13 moves,** every one defensible. Fragrance was also promoted above every makeup
  word, because "Mugler Angel **Blush** Eau de Parfum" is a perfume.

## Undo

Every change recorded its previous value in `ProductAssignmentLog` — 466 rows under pass
`reclassify-2026-08-04193337`.

**Tested, not assumed.** I applied the pass, ran the undo, confirmed concerns and attributes
returned to 0 across all 1,178, then re-applied. The log keeps reverted rows rather than
deleting them, so "what did this pass do" stays answerable afterwards.

```
# put the whole pass back
cd server && npx tsx scripts/reclassify.ts --undo reclassify-2026-08-04193337
```

For one product, find its row in `ProductAssignmentLog` and write `oldValue` back — the row
carries the product id, the field, both values and the reason the classifier chose it.
