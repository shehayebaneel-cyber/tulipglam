# Catalogue sweep

_2026-08-05 11:57 UTC_

**Read-only.** This file is the only thing `--write` writes. No product, category or brand row
was read-modified-written by the sweep that produced it, and every duplicate below is a
recommendation for a human — nothing has been merged, hidden or deleted.

**9,672 products** — dali 37, beesline 308, feel22 9,327.

Status — hidden 8,105, active 1,178, unavailable 389.

| Finding | Count |
| --- | --- |
| 1. cross-feed duplicate clusters, same brand | 0 |
|      …with 2+ active rows (competing today) | 0 |
| 2. same title, different brand (not duplicates) | 24 |
| 3. brand rows split across feeds (matcher is blind here) | 1 |
| 4. below threshold 0.5–0.8 (68 same-brand) | 882 |
| 5. active with no image | 1 |
| 6. zero / negative / absurd price | 126 |
| 7. unusable names | 0 |
| 8. active in an inactive category | 0 |
| 9. active, brand not on the allowlist | 0 |

## 1. CROSS-FEED DUPLICATES, SAME BRAND (recommendation only — nothing is merged) — 0

Symmetric Jaccard >= 0.8, brand-prefix and volume stripped, bundle-only-matches-bundle,
compared only inside one Brand row. The exact rule prisma/import-feel22.ts skips on, applied to the
rows that exist NOW instead of at import time. 2,798,462 cross-feed pairs compared.
0 matching pairs -> 0 clusters.

ZERO IS A RESULT, NOT AN EMPTY CHECK — the same score finds 24 cross-brand pairs and
882 near misses on this same run, so the matcher is demonstrably firing. Read it as: the
import-time skip did its job and left no same-brand cross-feed duplicate above the threshold behind.
It does NOT mean the feeds stopped overlapping. Where the overlap actually sits is sections 3
and 4: a maker filed under two Brand rows, and same-brand pairs scoring just under 0.8.

_None._

## 2. SAME TITLE, DIFFERENT BRAND — NOT duplicates, and deliberately no keep recommendation — 24

The same score, run across Brand rows instead of inside one. It is listed and not acted on
because most of it is a generic product name colliding: strip the vendor prefix and the volume
and a dozen makers all sell {micellar, water}. Scoring 1.00 here means the TITLES are the same,
which is not the same claim as the products being the same — only a shared brand makes that claim.

No KEEP is offered on purpose. Picking one would recommend deleting another maker's real listing,
which is the containment mistake wearing a different costume: a rule that looks decisive and is wrong.
Read it as a shelf-quality signal — several near-identical names on one shelf — not as a merge queue.
2 of these pairs are both active.

| SCORE | BOTH ACTIVE | A ID | A BRAND | A NAME | A PRICE | B ID | B BRAND | B NAME | B PRICE |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.00 |  | 30 | Dali | Cuticle Oil | $2.75 | 5945 | Mavala | Mavala Cuticle Oil 10ml | $16.65 |
| 1.00 |  | 33 | Dali | Lip Butter Balm | $4.99 | 5589 | Palladio | Palladio Butter Lip Balm | $10.82 |
| 1.00 |  | 35 | Dali | Liquid Lipstick | $4.50 | 9377 | Anastasia Bever… | Anastasia Beverly Hills Liquid Lipsti… | $32.37 |
| 1.00 |  | 40 | Dali | Concealer | $5.50 | 8146 | Samer Khouzami | Samer Khouzami The Concealer | $45.00 |
| 1.00 |  | 40 | Dali | Concealer | $5.50 | 10695 | Rosy The Panda | Rosy The Panda Concealer | $27.20 |
| 1.00 |  | 45 | Dali | White Nail Polish | $2.50 | 5916 | Mavala | Mavala White 49 Nail Polish 14ml | $12.54 |
| 1.00 |  | 47 | Dali | Black Nail Polish | $2.50 | 5915 | Mavala | Mavala Black 48 Nail Polish 14ml | $12.54 |
| 1.00 |  | 54 | Dali | Compact Powder | $5.00 | 2072 | Rosy The Panda | Rosy The Panda Compact Powder | $31.08 |
| 1.00 |  | 54 | Dali | Compact Powder | $5.00 | 10728 | Flormar | Flormar C.Powder Compact Powder | $19.98 |
| 1.00 |  | 57 | Dali | Micellar Cleansing Water | $2.10 | 2354 | Flormar | Flormar Micellar Cleansing Water | $13.32 |
| 1.00 |  | 57 | Dali | Micellar Cleansing Water | $2.10 | 3715 | Clarins | Clarins Cleansing Micellar Water 200 … | $39.41 |
| 1.00 | yes | 57 | Dali | Micellar Cleansing Water | $2.10 | 9565 | Beesline | Beesline 3 in 1 Micellar Cleansing Wa… | $1.79 |
| 1.00 | yes | 61 | Dali | Cleansing Gel | $5.00 | 2459 | Jacadi | Jacadi Cleansing Gel 400ml | $37.00 |
| 1.00 |  | 61 | Dali | Cleansing Gel | $5.00 | 4956 | Heliabrine | Heliabrine Cleansing Gel | $20.00 |
| 1.00 |  | 61 | Dali | Cleansing Gel | $5.00 | 10715 | Topicrem | Topicrem PV/DS Cleansing Gel 200ml | $21.00 |
| 1.00 |  | 64 | Dali | Coconut Body Lotion | $3.50 | 3947 | D'Elites | D'Elites Body Lotion Coconut 236ml | $10.00 |
| 1.00 |  | 140 | Beesline | Micellar Water 400ml+100ml for Free | $3.72 | 2683 | Frezyderm | Frezyderm Micellar Water 200ml | $15.00 |
| 1.00 |  | 140 | Beesline | Micellar Water 400ml+100ml for Free | $3.72 | 4516 | Soskin | Soskin Micellar Water 100ml | $10.00 |
| 1.00 |  | 140 | Beesline | Micellar Water 400ml+100ml for Free | $3.72 | 5879 | Elementre | Elementre Micellar Water 200ml | $23.00 |
| 1.00 |  | 140 | Beesline | Micellar Water 400ml+100ml for Free | $3.72 | 7715 | Soskin | Soskin Micellar Water 250ml | $18.00 |
| 1.00 |  | 210 | Beesline | After Sun Lotion | $7.32 | 5003 | Clipp | Clipp After Sun Lotion 200ml | $6.66 |
| 1.00 |  | 213 | Beesline | After Sun Milk | $7.32 | 7085 | Pupa Milano | Pupa Milano After Sun Milk 400ml | $31.00 |
| 1.00 |  | 373 | Beesline | Body Lotion | $5.82 | 3290 | Oils Of Nature | Oils Of Nature Body Lotion 250 ml | $11.00 |
| 1.00 |  | 373 | Beesline | Body Lotion | $5.82 | 10825 | Hola Cosmetics | Hola Cosmetics Body Lotion | $20.00 |

## 3. COVERAGE — where a cross-feed duplicate can be found at all — 1

Section 1 only compares inside one Brand row, so this is the entire search space it has.
Listed because a small number in section 1 is explained here, and is not by itself evidence
that the feeds do not overlap.

Brand rows carrying products from more than one feed — the ONLY rows section 1 can compare:
  Beesline (beesline) — 351 products: 308 from beesline, 43 from feel22

The table below is DIFFERENT Brand rows whose names look like the same maker, carrying different
feeds — so section 1 is structurally blind to them and anything duplicated there was imported
twice and is still sitting in the catalogue. Detected on the brand NAMES (one name's tokens are a
subset of the other's), deliberately a check about brands rather than a second product matcher.
The smaller side's product names are printed underneath, because these are the rows a human
should actually open.

| BRAND A | FEEDS A | N | BRAND B | FEEDS B | N |
| --- | --- | --- | --- | --- | --- |
| Dali | dali | 37 | Dali Cosmetics | feel22 | 9 |

```
Dali Cosmetics (dali-cosmetics) — every product:
ID     SOURCE  STATUS       NAME                                   PRICE  IMG  VAR
─────  ──────  ───────────  ─────────────────────────────────────  ─────  ───  ───
5629   feel22  active       Dali Lip Butter Balm Peach Sorbet      $4.99  1    0
7095   feel22  unavailable  Dali Lip Butter Balm Vanilla Cake      $4.99  1    0
10809  feel22  active       Dali Lip Butter Balm Pink Meringue     $4.99  1    0
10810  feel22  active       Dali Lip Butter Balm Cotton Candy      $4.99  1    0
10811  feel22  active       Dali Lip Butter Balm Strawberry        $4.99  1    0
10812  feel22  unavailable  Dali Lip Butter Balm Raspberry Jam     $4.99  1    0
10813  feel22  active       Dali Lip Butter Balm Salted Caramel    $4.99  1    0
10814  feel22  unavailable  Dali Lip Butter Balm Watermelon Sugar  $4.99  1    0
10815  feel22  active       Dali Lip Butter Balm Cherry Glaze      $4.99  1    0
```

## 4. BELOW THRESHOLD (0.5–0.8) — NOT duplicates, shown so the threshold is auditable — 882

These scored under the rule and are therefore NOT reported as duplicates anywhere above. They are
here so 0.8 can be judged against real rows rather than trusted, and so the SAME-BRAND ones
(68 of 882) are visible — those are the pairs closest to being a missed duplicate.

Lowering the threshold is NOT the conclusion to draw. The band is dominated by generic names, and
0.75 already includes pairs like a Dali nail polish against a Mavala nail polish remover. There is
also a whole shape the score cannot reach at any threshold worth using: Feel22 lists each shade as
its own product while we list one product with shade variants, so the shade words push a genuine
pair below even this floor. Section 3 finds those by brand instead, which is the honest way to.

| SCORE | SAME BRAND | A ID | A SOURCE | A NAME | B ID | B SOURCE | B NAME |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.75 | yes | 133 | beesline | Whitening Roll-on Deodorant - Fragrance-Fre… | 9559 | feel22 | Beesline Whitening Roll-On Deodorant |
| 0.75 | yes | 201 | beesline | Lip Care - Coolips SPF15 | 4611 | feel22 | Beesline Lip Care Coolips 4g |
| 0.75 | yes | 214 | beesline | Kids Cream SPF50 | 4457 | feel22 | Beesline Kids Sunscreen Cream Spf50 60ml |
| 0.75 | yes | 220 | beesline | 3in1 Micellar Cleansing Water - 750ml | 9565 | feel22 | Beesline 3 in 1 Micellar Cleansing Water |
| 0.75 | yes | 308 | beesline | Hair 9 Oils Mask | 6295 | feel22 | Beesline Express 9 Oils Hair Mask |
| 0.75 | yes | 309 | beesline | Facial Lifting Mask | 2225 | feel22 | Beesline Express Facial Lifting Mask |
| 0.67 | yes | 140 | beesline | Micellar Water 400ml+100ml for Free | 7439 | feel22 | Beesline Micellar Water 400ml + 100ml Free … |
| 0.67 | yes | 140 | beesline | Micellar Water 400ml+100ml for Free | 9565 | feel22 | Beesline 3 in 1 Micellar Cleansing Water |
| 0.67 | yes | 202 | beesline | 100% Natural Lip Balm - Choco Orange (1+1) | 4531 | feel22 | Beesline 100% Natural Lip Balm - Chocolate … |
| 0.67 | yes | 203 | beesline | 100% Natural Lip Balm - Propolis & Coco (1+… | 4532 | feel22 | Beesline 100% Natural Lip Balm - Propolis &… |
| 0.67 | yes | 283 | beesline | 100% Natural Lip Balm - Propolis & Coco | 4532 | feel22 | Beesline 100% Natural Lip Balm - Propolis &… |
| 0.67 | yes | 284 | beesline | 100% Natural Lip Balm - Choco Orange | 4531 | feel22 | Beesline 100% Natural Lip Balm - Chocolate … |
| 0.60 | yes | 118 | beesline | Whitening Roll-On Deodorant - Cool Breeze (… | 9559 | feel22 | Beesline Whitening Roll-On Deodorant |
| 0.60 | yes | 120 | beesline | WHITENING ROLL-ON DEODORANT - SPORT PULSE O… | 9559 | feel22 | Beesline Whitening Roll-On Deodorant |
| 0.60 | yes | 121 | beesline | Whitening Roll-on Deodorant - Invisible Tou… | 9559 | feel22 | Beesline Whitening Roll-On Deodorant |
| 0.60 | yes | 122 | beesline | Whitening Roll-on Deodorant - Cotton Candy … | 9559 | feel22 | Beesline Whitening Roll-On Deodorant |
| 0.60 | yes | 123 | beesline | Whitening Roll-On Deodorant - Beauty Pearl … | 9559 | feel22 | Beesline Whitening Roll-On Deodorant |
| 0.60 | yes | 124 | beesline | Whitening Roll-on Deodorant - Green Forest … | 9559 | feel22 | Beesline Whitening Roll-On Deodorant |
| 0.60 | yes | 126 | beesline | Whitening Roll-On Deodorant - Hair Delaying… | 9559 | feel22 | Beesline Whitening Roll-On Deodorant |
| 0.60 | yes | 127 | beesline | Whitening Roll-on Deodorant - Pacific Islan… | 9559 | feel22 | Beesline Whitening Roll-On Deodorant |
| 0.60 | yes | 133 | beesline | Whitening Roll-on Deodorant - Fragrance-Fre… | 9639 | feel22 | Beesline Whitening Roll-On Deodorant - 11 S… |
| 0.60 | yes | 134 | beesline | Whitening Roll-on Deodorant - Elder Rose (1… | 9559 | feel22 | Beesline Whitening Roll-On Deodorant |
| 0.60 | yes | 136 | beesline | Whitening Roll-On Deodorant - Arabian Oud (… | 9559 | feel22 | Beesline Whitening Roll-On Deodorant |
| 0.60 | yes | 141 | beesline | Whitening Facial Soap (1+1) | 8838 | feel22 | Beesline Whitening Facial Soap (4 Scents Av… |
| 0.60 | yes | 211 | beesline | Dry Feel Oil | 6942 | feel22 | Beesline Brown Tan Dry Feel Oil 150 ml |
| 0.60 | yes | 212 | beesline | Carrot Suntan Oil | 4464 | feel22 | Beesline Pure Carrot Suntan Oil SPF10 200 ML |
| 0.60 | yes | 215 | beesline | Whitening Makeup Remover | 8420 | feel22 | Beesline Lip & Eye Whitening Makeup Remover |
| 0.60 | yes | 239 | beesline | 3in1 Micellar Cleansing Water - Fragrance F… | 9565 | feel22 | Beesline 3 in 1 Micellar Cleansing Water |
| 0.60 | yes | 253 | beesline | 3in1 Micellar Cleansing Water - Rose 100ml | 9565 | feel22 | Beesline 3 in 1 Micellar Cleansing Water |
| 0.60 | yes | 260 | beesline | 3in1 Micellar Cleansing Water - Rose 400ml | 9565 | feel22 | Beesline 3 in 1 Micellar Cleansing Water |
| 0.60 | yes | 319 | beesline | Ultrascreen Active SPF50 | 4461 | feel22 | Beesline Ultrascreen Cream Active Protectio… |
| 0.60 | yes | 348 | beesline | Whitening Facial Soap | 8838 | feel22 | Beesline Whitening Facial Soap (4 Scents Av… |
| 0.60 | yes | 351 | beesline | Whitening Facial Wash | 6177 | feel22 | Beesline Perfect Radiance Whitening Facial … |
| 0.60 | yes | 363 | beesline | Lip Care - Rose | 4612 | feel22 | Beesline Lip Care Soothing Jouri Rose 4.5 g |
| 0.60 | yes | 368 | beesline | Corn Remover Solution | 4530 | feel22 | Beesline Corn Remover Solution Rich in Prop… |
| 0.57 | yes | 349 | beesline | Whitening Day Cream SPF30 | 4610 | feel22 | Beesline Whitening Day Cream SPF30 - For Dr… |
| 0.50 | yes | 101 | beesline | Carrot Suntan Oil SPF 10 1+1 | 4464 | feel22 | Beesline Pure Carrot Suntan Oil SPF10 200 ML |
| 0.50 | yes | 118 | beesline | Whitening Roll-On Deodorant - Cool Breeze (… | 9639 | feel22 | Beesline Whitening Roll-On Deodorant - 11 S… |
| 0.50 | yes | 120 | beesline | WHITENING ROLL-ON DEODORANT - SPORT PULSE O… | 9639 | feel22 | Beesline Whitening Roll-On Deodorant - 11 S… |
| 0.50 | yes | 121 | beesline | Whitening Roll-on Deodorant - Invisible Tou… | 9639 | feel22 | Beesline Whitening Roll-On Deodorant - 11 S… |
| 0.50 | yes | 122 | beesline | Whitening Roll-on Deodorant - Cotton Candy … | 9639 | feel22 | Beesline Whitening Roll-On Deodorant - 11 S… |
| 0.50 | yes | 123 | beesline | Whitening Roll-On Deodorant - Beauty Pearl … | 9639 | feel22 | Beesline Whitening Roll-On Deodorant - 11 S… |
| 0.50 | yes | 124 | beesline | Whitening Roll-on Deodorant - Green Forest … | 9639 | feel22 | Beesline Whitening Roll-On Deodorant - 11 S… |
| 0.50 | yes | 126 | beesline | Whitening Roll-On Deodorant - Hair Delaying… | 9639 | feel22 | Beesline Whitening Roll-On Deodorant - 11 S… |
| 0.50 | yes | 127 | beesline | Whitening Roll-on Deodorant - Pacific Islan… | 9639 | feel22 | Beesline Whitening Roll-On Deodorant - 11 S… |
| 0.50 | yes | 134 | beesline | Whitening Roll-on Deodorant - Elder Rose (1… | 9639 | feel22 | Beesline Whitening Roll-On Deodorant - 11 S… |
| 0.50 | yes | 136 | beesline | Whitening Roll-On Deodorant - Arabian Oud (… | 9639 | feel22 | Beesline Whitening Roll-On Deodorant - 11 S… |
| 0.50 | yes | 175 | beesline | Natural Fragrance-Free Lip Balm | 4531 | feel22 | Beesline 100% Natural Lip Balm - Chocolate … |
| 0.50 | yes | 175 | beesline | Natural Fragrance-Free Lip Balm | 4532 | feel22 | Beesline 100% Natural Lip Balm - Propolis &… |
| 0.50 | yes | 190 | beesline | Lip Care - Flavour Free (1+1) | 4611 | feel22 | Beesline Lip Care Coolips 4g |
| 0.50 | yes | 204 | beesline | 100% Natural Lip Balm - Cherry (1+1) | 4531 | feel22 | Beesline 100% Natural Lip Balm - Chocolate … |
| 0.50 | yes | 204 | beesline | 100% Natural Lip Balm - Cherry (1+1) | 4532 | feel22 | Beesline 100% Natural Lip Balm - Propolis &… |
| 0.50 | yes | 213 | beesline | After Sun Milk | 7020 | feel22 | Beesline After Sun Repairing Milk - Tan Ext… |
| 0.50 | yes | 216 | beesline | Whitening Toner | 4459 | feel22 | Beesline Whitening Facial Glow Toner |
| 0.50 | yes | 281 | beesline | Age Defense Fluid SPF50+ - Tinted - Medium | 8842 | feel22 | Beesline Age Defense Tinted Facial Fluid Su… |
| 0.50 | yes | 282 | beesline | 100% Natural Lip Balm - Cherry | 4531 | feel22 | Beesline 100% Natural Lip Balm - Chocolate … |
| 0.50 | yes | 282 | beesline | 100% Natural Lip Balm - Cherry | 4532 | feel22 | Beesline 100% Natural Lip Balm - Propolis &… |
| 0.50 | yes | 285 | beesline | Age Defense Fluid SPF50+ - Tinted - Light | 8842 | feel22 | Beesline Age Defense Tinted Facial Fluid Su… |
| 0.50 | yes | 297 | beesline | Whitening Facial Soap-Papaya | 8838 | feel22 | Beesline Whitening Facial Soap (4 Scents Av… |
| 0.50 | yes | 298 | beesline | Whitening Facial Soap - Redberry | 8838 | feel22 | Beesline Whitening Facial Soap (4 Scents Av… |
| 0.50 | yes | 313 | beesline | Honey Soap | 6674 | feel22 | Beesline Honey Moisturizing Soap - Fragranc… |
| 0.50 | yes | 338 | beesline | Whitening Intimate Wash | 4460 | feel22 | Beesline Whitening Anti-Microbial Gentle In… |
| 0.50 | yes | 347 | beesline | Whitening Facial Exfoliating Soap | 8838 | feel22 | Beesline Whitening Facial Soap (4 Scents Av… |
| 0.50 | yes | 359 | beesline | Day Cream SPF25 - Dry Skin | 4610 | feel22 | Beesline Whitening Day Cream SPF30 - For Dr… |
| 0.50 | yes | 360 | beesline | Lip Care - Cherry | 4611 | feel22 | Beesline Lip Care Coolips 4g |
| 0.50 | yes | 361 | beesline | Lip Care - Strawberry | 4611 | feel22 | Beesline Lip Care Coolips 4g |
| 0.50 | yes | 363 | beesline | Lip Care - Rose | 4611 | feel22 | Beesline Lip Care Coolips 4g |
| 0.50 | yes | 374 | beesline | Lip Care - Flavor Free | 4611 | feel22 | Beesline Lip Care Coolips 4g |
| 0.75 |  | 33 | dali | Lip Butter Balm | 5078 | feel22 | Rimmel Oh My Gloss! Butter Me Up Lip Balm |
| 0.75 |  | 33 | dali | Lip Butter Balm | 9160 | feel22 | Oils Of Nature Cocoa Lip Balm Butter 8 g |
| 0.75 |  | 43 | dali | Red Nail Polish | 9600 | feel22 | Essie Really Red 60 Nail Polish |
| 0.75 |  | 45 | dali | White Nail Polish | 2549 | feel22 | Mavala White Mini Nail Polish |
| 0.75 |  | 47 | dali | Black Nail Polish | 2576 | feel22 | Mavala Black Mini Nail Polish |
| 0.75 |  | 50 | dali | Blue Nail Polish | 5935 | feel22 | Mavala Nail Polish Remover Blue 100ml |
| 0.75 |  | 57 | dali | Micellar Cleansing Water | 3912 | feel22 | Salma Baby Micellar Cleansing Water |
| 0.75 |  | 57 | dali | Micellar Cleansing Water | 10450 | feel22 | SVR Physiopure Cleansing Micellar Water |
| 0.75 |  | 64 | dali | Coconut Body Lotion | 3869 | feel22 | Palmer's Coconut Oil Body Lotion 250ml |
| 0.75 |  | 64 | dali | Coconut Body Lotion | 6983 | feel22 | Yves Rocher Sensual Body Lotion - Coconut |
| 0.75 |  | 204 | beesline | 100% Natural Lip Balm - Cherry (1+1) | 6440 | feel22 | Khan El Kaser Lip Balm Cherry 70ml |
| 0.75 |  | 220 | beesline | 3in1 Micellar Cleansing Water - 750ml | 57 | dali | Micellar Cleansing Water |
| 0.75 |  | 220 | beesline | 3in1 Micellar Cleansing Water - 750ml | 2354 | feel22 | Flormar Micellar Cleansing Water |
| 0.75 |  | 220 | beesline | 3in1 Micellar Cleansing Water - 750ml | 3715 | feel22 | Clarins Cleansing Micellar Water 200 ml |
| 0.75 |  | 230 | beesline | Anti-Wrinkle & Radiance Serum | 2291 | feel22 | Revilin Anti-Wrinkle Serum |
| 0.75 |  | 282 | beesline | 100% Natural Lip Balm - Cherry | 6440 | feel22 | Khan El Kaser Lip Balm Cherry 70ml |
| 0.67 |  | 30 | dali | Cuticle Oil | 7758 | feel22 | Koa Cuticle Oil Pen |
| 0.67 |  | 30 | dali | Cuticle Oil | 9161 | feel22 | Oils Of Nature Nail Cuticle Oil 15ml |
| 0.67 |  | 30 | dali | Cuticle Oil | 9793 | feel22 | Potion Kitchen Nailed it Cuticle Oil |
| 0.67 |  | 31 | dali | Eye Pencil | 4207 | feel22 | Pupa Milano Vamp! Eye Pencil |
| 0.67 |  | 31 | dali | Eye Pencil | 4588 | feel22 | Pupa Milano Multiplay Eye Pencil |
| 0.67 |  | 31 | dali | Eye Pencil | 7176 | feel22 | Wibo Incredible Eye Pencil |
| 0.67 |  | 33 | dali | Lip Butter Balm | 4260 | feel22 | Solushes Lip Balm 5g |
| 0.67 |  | 33 | dali | Lip Butter Balm | 6471 | feel22 | Laki Beauty Lip Balm |
| 0.67 |  | 33 | dali | Lip Butter Balm | 8354 | feel22 | The AloeLab Lip Balm 4.7ml |
| 0.67 |  | 35 | dali | Liquid Lipstick | 8790 | feel22 | Essence 8H Matte Liquid Lipstick |
| 0.67 |  | 36 | dali | Creamy Blush | 2356 | feel22 | Flormar Blossom Creamy Blush |
| 0.67 |  | 37 | dali | Top Coat | 8222 | feel22 | Essie Good To Go Top Coat |
| 0.67 |  | 38 | dali | Base Coat | 4999 | feel22 | Seche Clear Base Coat 15ml |
| 0.67 |  | 38 | dali | Base Coat | 5940 | feel22 | Mavala 002 Protective Base Coat 10ml |
| 0.67 |  | 52 | dali | Trio Palette | 8555 | feel22 | The Balm Tropics Trio Palette |
| 0.67 |  | 53 | dali | Lip Pencil Waterproof | 8963 | feel22 | Bassam Fattouh Lip Pencil |
| 0.67 |  | 57 | dali | Micellar Cleansing Water | 2683 | feel22 | Frezyderm Micellar Water 200ml |
| 0.67 |  | 57 | dali | Micellar Cleansing Water | 4325 | feel22 | Alphanova Cleansing Water 400ml |
| 0.67 |  | 57 | dali | Micellar Cleansing Water | 4516 | feel22 | Soskin Micellar Water 100ml |
| 0.67 |  | 57 | dali | Micellar Cleansing Water | 5879 | feel22 | Elementre Micellar Water 200ml |
| 0.67 |  | 57 | dali | Micellar Cleansing Water | 7715 | feel22 | Soskin Micellar Water 250ml |
| 0.67 |  | 60 | dali | Cleansing Milk | 3442 | feel22 | Uriage Gentle Cleansing Milk 250ml |
| 0.67 |  | 60 | dali | Cleansing Milk | 3616 | feel22 | Round Lab 1025 Dokdo Cleansing Milk 200ml |
| 0.67 |  | 60 | dali | Cleansing Milk | 3714 | feel22 | Clarins Velvet Cleansing Milk |
| 0.67 |  | 60 | dali | Cleansing Milk | 7067 | feel22 | Declare Gentle Cleansing Milk |
| 0.67 |  | 61 | dali | Cleansing Gel | 2642 | feel22 | Bioderma Hydrabio Cleansing Gel |
| 0.67 |  | 61 | dali | Cleansing Gel | 2816 | feel22 | M.A.D Delicate Cleansing Gel 200ml |
| 0.67 |  | 61 | dali | Cleansing Gel | 4136 | feel22 | Uriage Hyseac Cleansing Gel |
| 0.67 |  | 61 | dali | Cleansing Gel | 5148 | feel22 | Round Lab 1025 Dokdo Cleansing Gel |
| 0.67 |  | 61 | dali | Cleansing Gel | 6869 | feel22 | Clarins Purifying Cleansing Gel 125ml |
| 0.67 |  | 61 | dali | Cleansing Gel | 8953 | feel22 | Mustela Stelatopia Cleansing Gel 200ml |
| 0.67 |  | 61 | dali | Cleansing Gel | 9241 | feel22 | ACM Sebionex Cleansing Gel 200 ml |
| 0.67 |  | 61 | dali | Cleansing Gel | 11016 | feel22 | Collistar Purifying Cleansing Gel 200ml |
| 0.67 |  | 63 | dali | Walnut Body Scrub | 7711 | feel22 | Soskin Body Scrub With A.H.A. 150ml |
| 0.67 |  | 63 | dali | Walnut Body Scrub | 10823 | feel22 | Hola Cosmetics Body Scrub |
| 0.67 |  | 64 | dali | Coconut Body Lotion | 3290 | feel22 | Oils Of Nature Body Lotion 250 ml |
| 0.67 |  | 64 | dali | Coconut Body Lotion | 10825 | feel22 | Hola Cosmetics Body Lotion |
| 0.67 |  | 65 | dali | Cleansing Balm | 3959 | feel22 | Beauty Of Joseon Radiance Cleansing Balm |
| 0.67 |  | 65 | dali | Cleansing Balm | 5185 | feel22 | Bioderma Cicabio Cleansing Balm |
| 0.67 |  | 65 | dali | Cleansing Balm | 5682 | feel22 | Laki Beauty Radiance Cleansing Balm |
| 0.67 |  | 83 | beesline | Keratin Conditioner | 5515 | feel22 | Tresemme Conditioner Pro Keratin 180ml |
| 0.67 |  | 115 | beesline | Super Hydrating Serum | 2808 | feel22 | Retinol Skincare Super Serum |
| 0.67 |  | 115 | beesline | Super Hydrating Serum | 4129 | feel22 | Revuele Hydrating Serum 30ml |
| 0.67 |  | 123 | beesline | Whitening Roll-On Deodorant - Beauty Pearl … | 2245 | feel22 | Nivea Pearl & Beauty Roll-On For Women Deod… |
| 0.67 |  | 140 | beesline | Micellar Water 400ml+100ml for Free | 57 | dali | Micellar Cleansing Water |
| 0.67 |  | 140 | beesline | Micellar Water 400ml+100ml for Free | 2354 | feel22 | Flormar Micellar Cleansing Water |
| 0.67 |  | 140 | beesline | Micellar Water 400ml+100ml for Free | 3426 | feel22 | Diadermine Moisturizing Micellar Water |
| 0.67 |  | 140 | beesline | Micellar Water 400ml+100ml for Free | 3715 | feel22 | Clarins Cleansing Micellar Water 200 ml |
| 0.67 |  | 140 | beesline | Micellar Water 400ml+100ml for Free | 4123 | feel22 | Isdin Isdinceutics Micellar Water 400 Ml |
| 0.67 |  | 140 | beesline | Micellar Water 400ml+100ml for Free | 4673 | feel22 | Antati Oasis Micellar Water 150ml |
| 0.67 |  | 140 | beesline | Micellar Water 400ml+100ml for Free | 5164 | feel22 | Lierac Cleanser Micellar Water |
| 0.67 |  | 140 | beesline | Micellar Water 400ml+100ml for Free | 8005 | feel22 | Delia Moisturizing Micellar Water 500ml |
| 0.67 |  | 140 | beesline | Micellar Water 400ml+100ml for Free | 8878 | feel22 | Clarins Re-Move Micellar Water 200ML |
| 0.67 |  | 140 | beesline | Micellar Water 400ml+100ml for Free | 9170 | feel22 | Oils Of Nature Micellar Rose Water 250 ml |
| 0.67 |  | 140 | beesline | Micellar Water 400ml+100ml for Free | 11209 | feel22 | Swiss Image Refreshing Micellar Water |
| 0.67 |  | 224 | beesline | Dandruff Shampoo 750ml | 2794 | feel22 | Ecrinal Anti-Dandruff Shampoo 200ml |
| 0.67 |  | 229 | beesline | Super Hydrating Serum | 2808 | feel22 | Retinol Skincare Super Serum |
| 0.67 |  | 229 | beesline | Super Hydrating Serum | 4129 | feel22 | Revuele Hydrating Serum 30ml |
| 0.67 |  | 313 | beesline | Honey Soap | 4016 | feel22 | Sophia's Beauty Soap Honey Love |
| 0.67 |  | 357 | beesline | Eye Serum | 2846 | feel22 | Soskin Eye Care Serum 30ml |
| 0.67 |  | 357 | beesline | Eye Serum | 5564 | feel22 | Madica Swiss Eye Lifting Serum 15ml |
| 0.67 |  | 357 | beesline | Eye Serum | 8283 | feel22 | Shantel Eye Recovery Serum 15ml |
| 0.67 |  | 357 | beesline | Eye Serum | 8353 | feel22 | The AloeLab 5% Caffeine Eye Serum 30ml |
| 0.67 |  | 357 | beesline | Eye Serum | 8386 | feel22 | Biosar Serenvit Eye Serum 30ml |
| 0.67 |  | 357 | beesline | Eye Serum | 8584 | feel22 | Vitayes Perfector Eye Serum |
| 0.67 |  | 358 | beesline | Night Cream | 7707 | feel22 | Ailyak Night Cream Cucumber |
| 0.67 |  | 358 | beesline | Night Cream | 9038 | feel22 | Face Facts Hydrating Night Cream 50ml |
| 0.67 |  | 373 | beesline | Body Lotion | 64 | dali | Coconut Body Lotion |
| 0.67 |  | 373 | beesline | Body Lotion | 3928 | feel22 | D'Elites Body Lotion Oud 236ml |
| 0.67 |  | 373 | beesline | Body Lotion | 3933 | feel22 | D'Elites Body Lotion Bombastic 236ml |
| 0.67 |  | 373 | beesline | Body Lotion | 3941 | feel22 | D'Elites Body Lotion Vanilla 236ml |
| 0.67 |  | 373 | beesline | Body Lotion | 3946 | feel22 | D'Elites Body Lotion Raspberry 236ml |
| 0.67 |  | 373 | beesline | Body Lotion | 3947 | feel22 | D'Elites Body Lotion Coconut 236ml |
| 0.67 |  | 373 | beesline | Body Lotion | 4359 | feel22 | Khan El Kaser Bridal Body Lotion 250ml |
| 0.67 |  | 373 | beesline | Body Lotion | 6022 | feel22 | Clipp Body Lotion Q10 |
| 0.67 |  | 373 | beesline | Body Lotion | 6463 | feel22 | Khan El Kaser Body Lotion Myrrh 250ml |
| 0.67 |  | 373 | beesline | Body Lotion | 6464 | feel22 | Khan El Kaser Body Lotion Lily 250ml |
| 0.67 |  | 373 | beesline | Body Lotion | 6465 | feel22 | Khan El Kaser Body Lotion Lavender 250ml |
| 0.67 |  | 373 | beesline | Body Lotion | 6466 | feel22 | Khan El Kaser Body Lotion Glow 250ml |
| 0.67 |  | 373 | beesline | Body Lotion | 6467 | feel22 | Khan El Kaser Body Lotion Baylasan 250ml |
| 0.67 |  | 373 | beesline | Body Lotion | 9489 | feel22 | Bio-Oil Moisturizing Body Lotion |
| 0.67 |  | 373 | beesline | Body Lotion | 9756 | feel22 | D'Elites Body Lotion Lust 236ml |
| 0.67 |  | 373 | beesline | Body Lotion | 11091 | feel22 | Bepanthen Derma Replenishing Body Lotion |
| 0.67 |  | 373 | beesline | Body Lotion | 11093 | feel22 | Bepanthen Derma Restoring Body Lotion |
| 0.60 |  | 33 | dali | Lip Butter Balm | 5556 | feel22 | Palmer's Cocoa Butter Lip Balm SPF15 |
| 0.60 |  | 33 | dali | Lip Butter Balm | 10811 | feel22 | Dali Lip Butter Balm Strawberry |
| 0.60 |  | 41 | dali | Nude Nail Polish | 4934 | feel22 | Samoa Never Nude Très Sage No.244 Nail Poli… |
| 0.60 |  | 44 | dali | Pink Nail Polish | 5926 | feel22 | Mavala South Beach Pink 168 Nail Polish 14ml |
| 0.60 |  | 47 | dali | Black Nail Polish | 2325 | feel22 | Flormar Nail Enamel 313 Black Minimalism Na… |
| 0.60 |  | 50 | dali | Blue Nail Polish | 2571 | feel22 | Mavala Deep Blue Mini Nail Polish |
| 0.60 |  | 50 | dali | Blue Nail Polish | 2575 | feel22 | Mavala Blue Mint Mini Nail Polish |
| 0.60 |  | 57 | dali | Micellar Cleansing Water | 7037 | feel22 | Cosrx Low pH Niacinamide Micellar Cleansing… |
| 0.60 |  | 57 | dali | Micellar Cleansing Water | 7094 | feel22 | Avène Cleansing Micellar Water For Oily Ski… |
| 0.60 |  | 210 | beesline | After Sun Lotion | 7266 | feel22 | Dermedic Sunbrella Cooling After Sun Lotion… |
| 0.60 |  | 210 | beesline | After Sun Lotion | 7367 | feel22 | A-Derma Protect AH Lotion After Sun 250ml |
| 0.60 |  | 213 | beesline | After Sun Milk | 2928 | feel22 | Bioderma Photoderm Refreshing After Sun Mil… |
| 0.60 |  | 213 | beesline | After Sun Milk | 5460 | feel22 | Pupa Super After Sun Milk |
| 0.60 |  | 220 | beesline | 3in1 Micellar Cleansing Water - 750ml | 3912 | feel22 | Salma Baby Micellar Cleansing Water |
| 0.60 |  | 220 | beesline | 3in1 Micellar Cleansing Water - 750ml | 10450 | feel22 | SVR Physiopure Cleansing Micellar Water |
| 0.60 |  | 239 | beesline | 3in1 Micellar Cleansing Water - Fragrance F… | 57 | dali | Micellar Cleansing Water |
| 0.60 |  | 239 | beesline | 3in1 Micellar Cleansing Water - Fragrance F… | 2354 | feel22 | Flormar Micellar Cleansing Water |
| 0.60 |  | 239 | beesline | 3in1 Micellar Cleansing Water - Fragrance F… | 3715 | feel22 | Clarins Cleansing Micellar Water 200 ml |
| 0.60 |  | 253 | beesline | 3in1 Micellar Cleansing Water - Rose 100ml | 57 | dali | Micellar Cleansing Water |
| 0.60 |  | 253 | beesline | 3in1 Micellar Cleansing Water - Rose 100ml | 2354 | feel22 | Flormar Micellar Cleansing Water |
| 0.60 |  | 253 | beesline | 3in1 Micellar Cleansing Water - Rose 100ml | 3715 | feel22 | Clarins Cleansing Micellar Water 200 ml |
| 0.60 |  | 253 | beesline | 3in1 Micellar Cleansing Water - Rose 100ml | 9170 | feel22 | Oils Of Nature Micellar Rose Water 250 ml |
| 0.60 |  | 260 | beesline | 3in1 Micellar Cleansing Water - Rose 400ml | 57 | dali | Micellar Cleansing Water |
| 0.60 |  | 260 | beesline | 3in1 Micellar Cleansing Water - Rose 400ml | 2354 | feel22 | Flormar Micellar Cleansing Water |
| 0.60 |  | 260 | beesline | 3in1 Micellar Cleansing Water - Rose 400ml | 3715 | feel22 | Clarins Cleansing Micellar Water 200 ml |
| 0.60 |  | 260 | beesline | 3in1 Micellar Cleansing Water - Rose 400ml | 9170 | feel22 | Oils Of Nature Micellar Rose Water 250 ml |
| 0.60 |  | 302 | beesline | Hair Straight & Silky Mask | 6823 | feel22 | Kocostar Happy Hair Straight Mask |
| 0.60 |  | 312 | beesline | Daily Use Shampoo | 7630 | feel22 | Gamarde Gentle For Daily Use Soft Shampoo |
| 0.57 |  | 359 | beesline | Day Cream SPF25 - Dry Skin | 10029 | feel22 | Clarins Extra Firming Day Cream Dry Skin 50… |
| 0.50 |  | 30 | dali | Cuticle Oil | 5944 | feel22 | Mavala Mavapen Cuticle Oil Pen |
| 0.50 |  | 30 | dali | Cuticle Oil | 8227 | feel22 | Essie Apricot Cuticle Oil Cuticle Care |
| 0.50 |  | 30 | dali | Cuticle Oil | 8329 | feel22 | Atelier Beautanique Heal Cuticle & Nail Oil… |

_… and 682 more rows not listed._

## 5. ACTIVE PRODUCTS WITH NO IMAGE — 1

Live on the storefront with nothing but a ProductGlyph silhouette where the product should be.

| ID | SOURCE | BRAND | NAME | PRICE | CATEGORY | SLUG |
| --- | --- | --- | --- | --- | --- | --- |
| 10954 | feel22 | Lattafa | Lattafa Sheikh Shuyukh Supreme Eau De Parfum … | $18.78 | perfume-him | lattafa-sheikh-shuyukh-supreme-eau-de-p… |

## 6. ZERO, NEGATIVE OR ABSURD PRICES — 126

Zero or negative: 102 (0 active).
Negative specifically: 0.
Above $1000.00: 24 (0 active).

The $1000.00 bound is picked from the data, not from taste: nothing at all sits between
the dearest honest row and the first broken one, and the bound sits in that gap. The five dearest
rows it does NOT flag are printed underneath so the choice can be checked rather than believed.

Separately: 13 rows sit at exactly $500.00 — the flat placeholder
Beesline's own store publishes. Not flagged above (it is inside any defensible bound), listed because
it is a known signature rather than a price.

| ID | PRICE | SOURCE | BRAND | NAME | STATUS |
| --- | --- | --- | --- | --- | --- |
| 95 | $0.00 | beesline | Beesline | Suntan Jelly + Suntan Jelly Gold (1+1) | hidden |
| 96 | $0.00 | beesline | Beesline | Ultrascreen Cream Invisible Sunfilter SPF50 | hidden |
| 97 | $0.00 | beesline | Beesline | Instant Bright Micellar Water (400 ml + 100 m… | hidden |
| 98 | $0.00 | beesline | Beesline | Whitening Intimate Wash + Sensifresh Intimate… | hidden |
| 99 | $0.00 | beesline | Beesline | Whitening Intimate Wash + Whitening Sensitive… | hidden |
| 100 | $0.00 | beesline | Beesline | Whitening Sensitive Zone Cream (1+1) | hidden |
| 1974 | $0.00 | feel22 | Kiehl's | Kiehl's Brown Packette Bag Gift | hidden |
| 1975 | $0.00 | feel22 | SkinCeuticals | SkinCeuticals P-Tiox Serum 4ml GIFT | hidden |
| 1976 | $0.00 | feel22 | SkinCeuticals | SkinCeuticals Vitamin C E Ferulic Serum 4ml G… | hidden |
| 1977 | $0.00 | feel22 | SkinCeuticals | SkinCeuticals Phyto Corrective Serum 4ml GIFT | hidden |
| 1978 | $0.00 | feel22 | SkinCeuticals | SkinCeuticals Tote Bag GIFT | hidden |
| 1983 | $0.00 | feel22 | MAC | MAC Lustreglass Hug Me Lipstick GIFT | hidden |
| 2028 | $0.00 | feel22 | Anastasia Beverly… | Anastasia Beverly Hills Random Lip Gloss Delu… | hidden |
| 2029 | $0.00 | feel22 | Pupa Milano | Pupa I'm Matt Lipstick GIFT | hidden |
| 2034 | $0.00 | feel22 | Kérastase | Kérastase Travel size Resistance fondant Exte… | hidden |
| 2042 | $0.00 | feel22 | Feel22 | Feel22 May Pouch GIFT Ordinary | hidden |
| 2046 | $0.00 | feel22 | Clinique | Clinique Play With Color Chubby Sticks Pouch … | hidden |
| 2053 | $0.00 | feel22 | Avène | Avène Summer 2026 Beach Towel GIFT | hidden |
| 2064 | $0.00 | feel22 | Bio-Oil | Bio-Oil Hydrating Dry skin Gel GIFT | hidden |
| 2065 | $0.00 | feel22 | Estee Lauder | Estee Lauder Double Wear Foundation Pump GIFT | hidden |
| 2073 | $0.00 | feel22 | Bepanthen Derma | Bepanthen Derma Random Travel Size GIFT | hidden |
| 2129 | $0.00 | feel22 | Clinique | Clinique Pop Plush In Black Honey GIFT | hidden |
| 2162 | $0.00 | feel22 | Garnier | Garnier Micellar Anniversary Pink Tumbler GIFT | hidden |
| 2260 | $0.00 | feel22 | Vichy | Vichy Dercos Anti dandruff Shampoo 50ml (Rewa… | hidden |
| 2261 | $0.00 | feel22 | L'Oréal Paris | L'Oréal Paris Hydra Genius Aloe Water and Hya… | hidden |
| 2262 | $0.00 | feel22 | Maybelline | Maybelline New York Super Stay Vinyl Ink Long… | hidden |
| 2263 | $0.00 | feel22 | Garnier | Garnier Fast Bright Vitamin C + Niacinamide S… | hidden |
| 2264 | $0.00 | feel22 | Garnier | Garnier Micellar Water Facial Cleanser and Ma… | hidden |
| 2284 | $0.00 | feel22 | Khan El Kaser | Khan El Kaser Body Lotion - Random Scent (Rew… | hidden |
| 2286 | $0.00 | feel22 | Maybelline | Maybelline Color Rivals Eyeshadow Palette Duo… | hidden |
| 3107 | $0.00 | feel22 | Breakfree | Breakfree Under Eye Hydrogel Patch (Reward) | hidden |
| 3791 | $0.00 | feel22 | La Roche-Posay | La Roche-Posay Mini Effaclar Gel Moussant 50m… | hidden |
| 3795 | $0.00 | feel22 | Feel22 | Schwarzkopf Gliss Ultimate Repair Shampoo 400… | hidden |
| 3796 | $0.00 | feel22 | Clearasil | Clearasil 5in1 Wash (Reward) | hidden |
| 3797 | $0.00 | feel22 | Clearasil | Clearasil Rapid Action Wash (Reward) | hidden |
| 3798 | $0.00 | feel22 | Clearasil | Clearasil 5 in 1 Pads (Reward) | hidden |
| 3799 | $0.00 | feel22 | Clearasil | Clearasil Rapid Action Pads (Reward) | hidden |
| 3800 | $0.00 | feel22 | Milton | Milton Laundry Tablets (Reward) | hidden |
| 4521 | $0.00 | feel22 | Avène | Avène Activ CG Serum 10ml (Rewards) | hidden |
| 4522 | $0.00 | feel22 | Avène | Avène Micellar Lotion 100ml (Rewards) | hidden |
| 4541 | $0.00 | feel22 | Garnier | Garnier Fast Bright Vitamin C Brightening Tis… | hidden |
| 4542 | $0.00 | feel22 | Garnier | Garnier Fast Bright Vitamin C + Niacinamide S… | hidden |
| 4543 | $0.00 | feel22 | Garnier | Garnier Micellar Water Facial Cleanser and Ma… | hidden |
| 4544 | $0.00 | feel22 | L'Oréal Paris | L'Oréal Paris Elvive Extraordinary Hair Oil T… | hidden |
| 4747 | $0.00 | feel22 | L'Oréal Paris | L'Oréal Paris Coupon Redeemable For One Limit… | hidden |
| 4825 | $0.00 | feel22 | Garnier | Garnier Kiwi Sticker Sheet GIFT | hidden |
| 4826 | $0.00 | feel22 | Women'Secret | Women'Secret Body Mist Random Scent 250ml GIFT | hidden |
| 4864 | $0.00 | feel22 | Clinique | Clinique Moisture Surge 30ml GIFT | hidden |
| 4886 | $0.00 | feel22 | L'Oréal Professio… | L'Oréal Professionnel Vitamino Color 10 in 1 … | hidden |
| 4936 | $0.00 | feel22 | Neutrogena DC | Neutrogena Yellow Branded Textured Pouch GIFT | hidden |
| 4937 | $0.00 | feel22 | Mercedes | Mercedes Passport holder + Luggage tag + Ipad… | hidden |
| 5245 | $0.00 | feel22 | Laki Beauty | Laki Lip Balm Clear (Rewards) | hidden |
| 5258 | $0.00 | feel22 | L'Oréal Paris | L'Oreal Paris Panorama Mascara (Rewards) | hidden |
| 5399 | $0.00 | feel22 | L'Oréal Paris | L'Oréal Paris Glycolic Bright Dark Spot Brigh… | hidden |
| 6256 | $0.00 | feel22 | Maybelline | Maybelline Sky High (Reward) | hidden |
| 6257 | $0.00 | feel22 | L'Oréal Paris | L'Oréal Paris Hyaluron Spray (Reward) | hidden |
| 6268 | $0.00 | feel22 | Garnier | Garnier Vit C Serum (Reward) | hidden |
| 6269 | $0.00 | feel22 | L'Oréal Paris | L'Oréal Paris Hair Oil (Reward) | hidden |
| 6366 | $0.00 | feel22 | L'Oréal Paris | L'Oréal Paris Infaillible  Lip Crayon 108 (Re… | hidden |
| 7476 | $0.00 | feel22 | Lancôme | Lancôme Free Genifique Serum 5ml | hidden |
| 7477 | $0.00 | feel22 | Phyto | Phyto Color Shampoo Gift 100ml | hidden |
| 7478 | $0.00 | feel22 | Mustela | Mustela Sac De Place Rayures Beach Bag Gift | hidden |
| 7479 | $0.00 | feel22 | Lierac | Lierac Instit Pouch Gift | hidden |
| 7480 | $0.00 | feel22 | Kocostar | Kocostar Free Eye Patch - Random | hidden |
| 7482 | $0.00 | feel22 | Elementre | Elementre Free Pouch + Cleansing Gel 75ml | hidden |
| 7483 | $0.00 | feel22 | Eucerin | Eucerin Free Dermopurifyer Triple Effect Clea… | hidden |
| 7484 | $0.00 | feel22 | Giorgio Armani | Giorgio Armani Silk Foundation GIFT | hidden |
| 7485 | $0.00 | feel22 | Cicabiafine | Cicabiafine Free Extra Dry Moisturising Hand … | hidden |
| 7486 | $0.00 | feel22 | Dermedic | Dermedic Transparent Orange Pouch GIFT | hidden |
| 7487 | $0.00 | feel22 | Clinique | Clinique 5pcs Minis Gift Box | hidden |
| 7488 | $0.00 | feel22 | Yves Saint-Laurent | Yves Saint-Laurent Mini Rouge Pure Couture Li… | hidden |
| 7489 | $0.00 | feel22 | Yves Saint-Laurent | Yves Saint-Laurent XMAS 25 Mirror Gift | hidden |
| 7490 | $0.00 | feel22 | Yves Saint-Laurent | Yves Saint-Laurent Y Men Eau De Parfum 10ml G… | hidden |
| 7491 | $0.00 | feel22 | Viktor and Rolf | Viktor and Rold Black Mouse Pad GIFT | hidden |
| 7492 | $0.00 | feel22 | Valentino | Valentino Black Dopp Case Gift | hidden |
| 7493 | $0.00 | feel22 | Valentino | Valentino Pink Tote Bag Gift | hidden |
| 7494 | $0.00 | feel22 | Ralph Lauren | Ralph Lauren World Of Polo Travel Kit GIFT | hidden |
| 7495 | $0.00 | feel22 | Prada | Prada Keychain Luna Rossa Ocean GIFT | hidden |
| 7496 | $0.00 | feel22 | Prada | Prada Paradox Essence For Women 7ml Gift | hidden |
| 7497 | $0.00 | feel22 | Thierry Mugler | Mugler Beige Jute Bag GIFT | hidden |
| 7498 | $0.00 | feel22 | Lancôme | Lancome Scented Candle Jar Gift | hidden |
| 7499 | $0.00 | feel22 | Kiehl's | Kiehl's Duffle Bag 25 GIFT | hidden |
| 7500 | $0.00 | feel22 | Cetaphil | Cetaphil Mini Moisturizing Lotion 29ml Gift | hidden |
| 7513 | $0.00 | feel22 | Phyto | Phyto Nourishment Shampoo 100ml Gift | hidden |
| 7519 | $0.00 | feel22 | Soskin | Soskin Hand Fan Random Color GIFT | hidden |
| 7536 | $0.00 | feel22 | Elementre | Elementre AHA Foamer 40ml Gift | hidden |
| 7537 | $0.00 | feel22 | Pupa Milano | Pupa Milano Random Full Size Gift | hidden |
| 7647 | $0.00 | feel22 | Miu Miu | Miu Miu Black and White Pouch GIFT | hidden |
| 7659 | $0.00 | feel22 | La Roche-Posay | La Roche-Posay Anthelios UVMune (Reward) | hidden |
| 9964 | $0.00 | feel22 | Schwarzkopf | Schwarzkopf Ultimate Repair Oil 200ml (Reward) | hidden |
| 9965 | $0.00 | feel22 | Magnolia | Magnolia Body Splash - Random Scent (Reward) | hidden |
| 9966 | $0.00 | feel22 | Shiseido | Shiseido Global Suncare Blue Expert Sun Lotio… | hidden |
| 9967 | $0.00 | feel22 | Azalia | Azalia Hair Serum (Reward) | hidden |
| 9968 | $0.00 | feel22 | D'Elites | D'Elites Hand Cream - Random (Reward) | hidden |
| 9969 | $0.00 | feel22 | Cetaphil | Cetaphil Sun Liposomal Lotion SPF 50+ 50ml (R… | hidden |
| 9971 | $0.00 | feel22 | Cetaphil | Cetaphil Sun Light Gel SPF 50+ 50ml (Reward) | hidden |
| 10191 | $0.00 | feel22 | Dr Pawpaw | Dr Pawpaw Lip Scrub & Nourish 16g (Rewards) | hidden |
| 11040 | $0.00 | feel22 | Eucerin | Eucerin Free Pouch | hidden |
| 11140 | $0.00 | feel22 | Mancode | Mancode Deodorant Spray - Random Scent (Rewar… | hidden |
| 11162 | $0.00 | feel22 | Revuele | Revuele Ceramide Restorative Hand Cream 80ml … | hidden |
| 11163 | $0.00 | feel22 | Revuele | Revuele Hyaluron Acid Splash Mask 250ml (Rewa… | hidden |
| 11164 | $0.00 | feel22 | Revuele | Revuele Cream Butter Argan Oil Hand & Body 5 … | hidden |
| 132 | $22000.00 | beesline | Beesline | Whitening Roll-On Deo, Silver Power - 45°C - … | hidden |
| 254 | $89500.00 | beesline | Beesline | Suntan Oil + After Sun Cooling Lotion | hidden |
| 312 | $127985.00 | beesline | Beesline | Daily Use Shampoo | hidden |
| 302 | $136935.00 | beesline | Beesline | Hair Straight & Silky Mask | hidden |
| 128 | $248000.00 | beesline | Beesline | Whitening Roll-on Deo Super Dry, Silver Power… | hidden |
| 130 | $248000.00 | beesline | Beesline | Whitening Roll-on Deo Zero Aluminum, Silver P… | hidden |
| 137 | $248000.00 | beesline | Beesline | Whitening Roll-on Deo Super Dry, Silver Power… | hidden |
| 138 | $248000.00 | beesline | Beesline | Whitening Roll-On Deo  Super Dry, Silver Powe… | hidden |
| 321 | $252390.00 | beesline | Beesline | Mud Mask | hidden |
| 362 | $259550.00 | beesline | Beesline | Lip Care - Pearly Candy SPF 10 | hidden |
| 239 | $353525.00 | beesline | Beesline | 3in1 Micellar Cleansing Water - Fragrance Fre… | hidden |
| 371 | $375005.00 | beesline | Beesline | Beeswax Ointment | hidden |
| 300 | $596070.00 | beesline | Beesline | Deo Whitening Antiperspirant - Fragrance-Free | hidden |
| 322 | $596070.00 | beesline | Beesline | Deo Whitening Antiperspirant - Beauty Pearl | hidden |
| 323 | $596070.00 | beesline | Beesline | Deo Whitening Antiperspirant - Sport Pulse | hidden |
| 324 | $596070.00 | beesline | Beesline | Deo Whitening Antiperspirant - Pacific Islands | hidden |
| 325 | $596070.00 | beesline | Beesline | Deo Whitening - Indian Bakhour | hidden |
| 326 | $596070.00 | beesline | Beesline | Deo Whitening Antiperspirant - Arabian Oud | hidden |
| 327 | $596070.00 | beesline | Beesline | Deo Whitening Antiperspirant - Invisible Touch | hidden |
| 328 | $596070.00 | beesline | Beesline | Deo Whitening - Green Forest | hidden |
| 329 | $596070.00 | beesline | Beesline | Deo Whitening Antiperspirant - Cotton Candy | hidden |
| 330 | $596070.00 | beesline | Beesline | Deo Whitening Antiperspirant - Elder Rose | hidden |
| 354 | $596070.00 | beesline | Beesline | Deo Whitening Antiperspirant - Cool Breeze | hidden |
| 352 | $767910.00 | beesline | Beesline | Whitening Serum SPF30 | hidden |

```
Dearest rows NOT flagged (the bound is above all of these):
PRICE    STATUS  SOURCE  BRAND   NAME
───────  ──────  ──────  ──────  ──────────────────────────────────────────────────
$735.00  hidden  feel22  Dyson   Dyson Airwarp Co-anda2x™ Multi-Styler And Dryer S…
$735.00  hidden  feel22  Dyson   Dyson Airwarp Co-anda2x™ multi-styler and dryer S…
$735.00  hidden  feel22  Dyson   Dyson Airwarp Co-anda2x™ Multi-Styler And Dryer S…
$666.00  hidden  feel22  Beurer  Beurer Permanent Hair Removal - IPL 10000+
$626.00  hidden  feel22  Dyson   Dyson Airwarp ID MultiStyler & Dryer Straight To …
```

## 7. EMPTY, WHITESPACE-ONLY OR BRAND-ONLY NAMES — 0

Three ways a name fails to name a product: it is blank, it is exactly a brand name, or the
importer's own normalisation reduces it to nothing (the title restated the maker and a volume).
Names are printed JSON-quoted so trailing and doubled whitespace is visible.

_None._

## 8. ACTIVE PRODUCTS IN AN INACTIVE CATEGORY — 0

Unreachable — a retired department is not browsable — but they still count as active everywhere
a status is counted, and search and direct links can still reach them. Either the section comes
back or the products stop being active; the current state says neither.

_None._

## 9. ACTIVE PRODUCTS WHOSE BRAND IS NOT ON THE ALLOWLIST — 0

prisma/brands-we-sell.txt lists 65 brands. applyBrandAllowlist() hides everything else,
so anything here escaped that pass: added after it ran, or reactivated by hand since.
Products with no brand at all are included — the shop cannot claim a curated range and also
list something it cannot name the maker of.

_None._
