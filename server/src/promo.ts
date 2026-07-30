// Homepage promo resolution.
//
// The promo used to be hardcoded copy with settings as a fallback, which is how the live
// store ended up advertising "up to 30% off" on brands that had been deleted. The rule
// now: the server resolves the promo against real rows and returns null if anything about
// it cannot be backed up. The client renders whatever it is given and decides nothing.
//
// Refuses to render when:
//   * promoActive is not "true", or there is no title
//   * the scope is a brand/category that does not exist, is inactive, or is empty
//   * (discount line only) nothing in scope actually has a sale price
//
// Settings keys, all optional:
//   promoActive        "true" | "false"
//   promoTitle         headline — required
//   promoText          supporting line
//   promoDiscountText  e.g. "up to 30% off" — suppressed unless the scope really is on sale
//   promoScopeType     "" | "brand" | "category" | "sale"
//   promoScopeSlug     brand or category slug, required when scopeType is brand/category
//   promoCtaLabel      button text

import type { PrismaClient, Prisma } from "@prisma/client";

export type ResolvedPromo = {
  title: string;
  text: string;
  discountText: string;
  href: string;
  ctaLabel: string;
};

export type PromoResolution =
  | { promo: ResolvedPromo; reason: "" }
  | { promo: null; reason: string };

/** Products a shopper can actually see. Mirrors the storefront listing filter. */
const VISIBLE: Prisma.ProductWhereInput = { status: { in: ["active", "unavailable"] } };

export async function resolvePromo(db: PrismaClient, s: Record<string, string>): Promise<PromoResolution> {
  const val = (k: string) => (s[k] ?? "").trim();

  if (val("promoActive").toLowerCase() !== "true") return { promo: null, reason: "it is switched off." };

  const title = val("promoTitle");
  if (!title) return { promo: null, reason: "no promo title is set." };

  const scopeType = val("promoScopeType").toLowerCase();
  const scopeSlug = val("promoScopeSlug");

  let scope: Prisma.ProductWhereInput = VISIBLE;
  let href = "/shop";

  if (scopeType === "brand") {
    if (!scopeSlug) return { promo: null, reason: "the scope is set to a brand but no brand slug is given." };
    const brand = await db.brand.findUnique({ where: { slug: scopeSlug }, select: { id: true, active: true, name: true } });
    if (!brand) return { promo: null, reason: `the brand “${scopeSlug}” does not exist.` };
    if (!brand.active) return { promo: null, reason: `the brand “${brand.name}” is inactive.` };
    scope = { ...VISIBLE, brandId: brand.id };
    href = `/shop?brand=${encodeURIComponent(scopeSlug)}`;
  } else if (scopeType === "category") {
    if (!scopeSlug) return { promo: null, reason: "the scope is set to a category but no category slug is given." };
    const cat = await db.category.findUnique({ where: { slug: scopeSlug }, select: { id: true, active: true, name: true, children: { select: { id: true } } } });
    if (!cat) return { promo: null, reason: `the category “${scopeSlug}” does not exist.` };
    if (!cat.active) return { promo: null, reason: `the category “${cat.name}” is inactive.` };
    // departments hold no products directly — include children, same as the listing endpoint
    scope = { ...VISIBLE, categoryId: { in: [cat.id, ...cat.children.map((c) => c.id)] } };
    href = `/category/${encodeURIComponent(scopeSlug)}`;
  } else if (scopeType === "sale") {
    scope = { ...VISIBLE, saleCents: { not: null } };
    href = "/sale";
  }

  const inScope = await db.product.count({ where: scope });
  if (inScope === 0) {
    const what = scopeType === "brand" || scopeType === "category" ? `“${scopeSlug}”` : "the chosen scope";
    return { promo: null, reason: `${what} contains no visible products.` };
  }

  // A discount claim is only allowed if something in scope is genuinely marked down.
  // `saleCents != null` is a sound test for "on sale" because every write path stores
  // null unless the sale price is strictly below the base price (see productData()).
  const text = val("promoText");
  let discountText = val("promoDiscountText");
  const claimsDiscount = [discountText, title, text].some(mentionsDiscount);

  if (claimsDiscount) {
    const onSale = await db.product.count({ where: { AND: [scope, { saleCents: { not: null } }] } });
    if (onSale === 0) {
      // Suppressing just the discount field is not enough. The claim is often written into
      // the title or the body copy ("The Skincare Edit — up to 30% off"), and we must not
      // rewrite the owner's words to make them true. So the whole band stands down and the
      // Dashboard says why.
      if (mentionsDiscount(title) || mentionsDiscount(text)) {
        return { promo: null, reason: "the wording promises a discount but nothing in scope has a sale price." };
      }
      discountText = "";
    }
  }

  return {
    promo: { title, text, discountText, href, ctaLabel: val("promoCtaLabel") || "Shop now" },
    reason: "",
  };
}

/**
 * Does this copy promise money off? Catches "30% off", "up to 30%", "save $10", "half price",
 * "-20%". Used to refuse a promo whose wording cannot be backed by an actual sale price.
 */
function mentionsDiscount(s: string): boolean {
  if (!s) return false;
  const t = s.toLowerCase();
  return (
    /\d+\s*%/.test(t) ||
    /\bsave\b/.test(t) ||
    /\bhalf[- ]price\b/.test(t) ||
    /\b\d+\s*(off|reduction)\b/.test(t) ||
    /\boff\b/.test(t)
  );
}
