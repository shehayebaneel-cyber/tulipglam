import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// ------------------------------------------------------------------ categories
const CATEGORIES = [
  { slug: "makeup", name: "Makeup", blurb: "Lips, eyes, face & cheeks", glyph: "lipstick", tint: "#f7e9ef", sortOrder: 1 },
  { slug: "skincare", name: "Skincare", blurb: "Serums, creams & treatments", glyph: "dropper", tint: "#e9f0ee", sortOrder: 2 },
  { slug: "bath-body", name: "Bath & Body", blurb: "Wash, scrub & nourish", glyph: "tube", tint: "#eff0e6", sortOrder: 3 },
  { slug: "hair", name: "Hair", blurb: "Care, repair & style", glyph: "bottle", tint: "#eeeaf3", sortOrder: 4 },
  { slug: "fragrance", name: "Fragrance", blurb: "Eau de parfum & mists", glyph: "mist", tint: "#f3ece4", sortOrder: 5 },
  { slug: "gift-sets", name: "Gift Sets", blurb: "Curated, ready to give", glyph: "jar", tint: "#f5e9f0", sortOrder: 6 },
];

// ------------------------------------------------------------------ brands
const BRANDS = [
  { slug: "lame", name: "Lâme", blurb: "Modern colour, effortless finish", featured: true },
  { slug: "aureli", name: "Aureli", blurb: "Science-led skincare", featured: true },
  { slug: "novi", name: "Novi", blurb: "Active treatments that work", featured: true },
  { slug: "seul", name: "Seul", blurb: "Salon hair, at home", featured: true },
  { slug: "maison-ivelle", name: "Maison Ivelle", blurb: "French perfumery", featured: true },
  { slug: "botanique", name: "Botanique", blurb: "Clean, plant-based rituals", featured: true },
  { slug: "rouge-co", name: "Rouge & Co", blurb: "Blush, glow & flush", featured: true },
  { slug: "lys", name: "Lys", blurb: "Everyday softness", featured: true },
];

type Seed = {
  name: string; brand: string | null; cat: string; price: number; sale?: number;
  glyph: string; tint: string; best?: boolean; newp?: boolean;
  concerns?: string; attributes?: string;
  short: string; desc: string; how?: string; ingredients?: string;
  shades?: [string, string][]; // [label, hex]
  sizes?: string[];
  reviews?: { author: string; rating: number; title?: string; text: string }[];
};

const P: Seed[] = [
  // ---------------- makeup
  { name: "Velvet Matte Lipstick", brand: "lame", cat: "makeup", price: 22, glyph: "lipstick", tint: "#f7e2e6", best: true,
    attributes: "vegan,cruelty-free", short: "Weightless matte colour that lasts.",
    desc: "A creamy-to-matte bullet that glides on in one stroke and stays put for hours without drying. Richly pigmented, comfortable, never cakey.",
    how: "Line and fill from the centre of the lips outward. Blot and reapply for a deeper finish.",
    ingredients: "Ricinus Communis Seed Oil, Candelilla Wax, Mica, Vitamin E.",
    shades: [["Rosewood", "#9b5b5b"], ["Brick", "#a4432f"], ["Mauve Muse", "#7d5566"], ["Nude Petal", "#c98d7a"], ["Cherry Noir", "#6d1f2a"]],
    reviews: [{ author: "Rana K.", rating: 5, title: "My everyday nude", text: "Rosewood is the perfect my-lips-but-better. Doesn't dry out at all." },
              { author: "Léa M.", rating: 4, text: "Beautiful colour payoff, transfers a little on cups but I expect that." }] },
  { name: "Second-Skin Foundation", brand: "lame", cat: "makeup", price: 34, glyph: "bottle", tint: "#f3e7dd",
    short: "Medium, buildable coverage with a natural finish.",
    desc: "A breathable foundation that evens tone without masking skin. Blends seamlessly and wears for a full day.",
    how: "Apply a few drops with a damp sponge or brush, building where needed.",
    shades: [["Porcelain", "#f0d9c4"], ["Sand", "#e6c4a4"], ["Honey", "#c9a079"], ["Amber", "#b07d52"], ["Chestnut", "#8a5a3a"], ["Espresso", "#5f3c28"]] },
  { name: "Cloud Blush", brand: "rouge-co", cat: "makeup", price: 19, glyph: "compact", tint: "#f7dfe0", newp: true,
    short: "Soft-focus flush in a whipped gel-cream.",
    desc: "A cushiony blush that melts into skin for a lit-from-within flush. A little goes a long way.",
    shades: [["Peony", "#d98a86"], ["Coral", "#e08a5f"], ["Plum Wine", "#8a5a6e"]] },
  { name: "Lengthening Mascara", brand: "lame", cat: "makeup", price: 18, glyph: "tube", tint: "#e8e6ef", best: true,
    short: "Clump-free length and lift, all day.",
    desc: "A tapered brush separates and extends every lash. Smudge-resistant, flake-free formula." },
  { name: "Precision Liquid Eyeliner", brand: "seul", cat: "makeup", price: 15, glyph: "tube", tint: "#e6e6ea",
    short: "Ultra-fine felt tip for a crisp line.",
    desc: "Intense, matte-black ink that dries fast and stays put. The flexible tip draws a hairline flick or a bold wing." },
  { name: "Glow Highlighter Compact", brand: "rouge-co", cat: "makeup", price: 24, glyph: "compact", tint: "#f5ead9",
    short: "A finely-milled, skin-like glow.",
    desc: "Reflects light softly for a dewy highlight, never glittery.",
    shades: [["Champagne", "#e7c9a0"], ["Rose Gold", "#e0a998"], ["Moonstone", "#e9dfe0"]] },
  { name: "Brow Define Pencil", brand: "lame", cat: "makeup", price: 14, glyph: "lipstick", tint: "#ece3d8",
    short: "Fine tip + spoolie for natural brows.",
    desc: "A slim, retractable pencil that draws hair-like strokes, with a spoolie to blend.",
    shades: [["Taupe", "#8a7461"], ["Ash Brown", "#6f5a48"], ["Soft Black", "#33291f"]] },
  { name: "Lip Oil Gloss", brand: "lame", cat: "makeup", price: 16, sale: 12, glyph: "dropper", tint: "#f7dde6", newp: true,
    short: "A tinted, non-sticky lip treatment.",
    desc: "Nourishing lip oil with a glass-like shine and a whisper of colour.",
    shades: [["Clear", "#f4e9ec"], ["Rose", "#d98aa0"], ["Berry", "#9c4a63"]] },

  // ---------------- skincare
  { name: "Hydra-Plump Serum", brand: "aureli", cat: "skincare", price: 38, glyph: "dropper", tint: "#e3eff0", best: true,
    concerns: "hydration,dullness", attributes: "vegan,clean",
    short: "Multi-weight hyaluronic acid for deep hydration.",
    desc: "Five molecular weights of hyaluronic acid hydrate every layer for a plump, dewy finish. Lightweight and layer-friendly.",
    how: "Apply 3–4 drops to damp skin morning and night, before moisturiser.",
    ingredients: "Aqua, Sodium Hyaluronate, Panthenol, Glycerin.",
    sizes: ["30ml", "50ml"],
    reviews: [{ author: "Maya S.", rating: 5, title: "Skin drinks it up", text: "My skin looks so much plumper within a week. No stickiness." }] },
  { name: "Vitamin C Brightening Serum", brand: "novi", cat: "skincare", price: 42, sale: 34, glyph: "dropper", tint: "#f3ecd9", newp: true,
    concerns: "brightening,dullness,dark-spots", attributes: "clean",
    short: "15% stabilised vitamin C for radiance.",
    desc: "Brightens, evens tone and defends against daily stress with a stable vitamin C complex.",
    how: "Use 3–4 drops each morning before SPF.",
    sizes: ["30ml"] },
  { name: "Ceramide Barrier Moisturiser", brand: "aureli", cat: "skincare", price: 30, glyph: "jar", tint: "#e9efe6",
    concerns: "hydration,barrier,sensitivity",
    short: "Rich ceramide cream that repairs the barrier.",
    desc: "Ceramides and fatty acids restore a compromised barrier for calm, resilient skin.",
    sizes: ["50ml"] },
  { name: "Gentle Gel Cleanser", brand: "botanique", cat: "skincare", price: 22, glyph: "tube", tint: "#e6f0ea",
    concerns: "sensitivity", attributes: "clean,vegan",
    short: "A pH-balanced daily cleanser.",
    desc: "Lifts makeup and impurities without stripping. Leaves skin soft, never tight.",
    sizes: ["150ml"] },
  { name: "Overnight Retinol Mask", brand: "novi", cat: "skincare", price: 36, glyph: "jar", tint: "#efe7f0",
    concerns: "anti-aging,texture",
    short: "Encapsulated retinol works while you sleep.",
    desc: "A slow-release retinol mask that smooths fine lines and refines texture with minimal irritation.",
    sizes: ["50ml"] },
  { name: "Daily Mineral SPF 50", brand: "aureli", cat: "skincare", price: 28, glyph: "tube", tint: "#f0ecd6", best: true,
    concerns: "protection", attributes: "clean",
    short: "Weightless mineral sunscreen, no white cast.",
    desc: "Broad-spectrum SPF 50 in a silky, invisible finish that sits beautifully under makeup." },
  { name: "Rose Clay Mask", brand: "botanique", cat: "skincare", price: 20, glyph: "jar", tint: "#f4e4e4",
    concerns: "pores,dullness", attributes: "vegan,clean",
    short: "A gentle detox that won't over-dry.",
    desc: "French rose clay draws out impurities while rosehip keeps skin soft.",
    sizes: ["75ml"] },
  { name: "Niacinamide Pore Serum", brand: "novi", cat: "skincare", price: 26, glyph: "dropper", tint: "#e6eef0", newp: true,
    concerns: "pores,oiliness",
    short: "10% niacinamide to refine and balance.",
    desc: "Visibly minimises pores and balances oil for a smoother, more even complexion.",
    sizes: ["30ml"] },

  // ---------------- bath & body
  { name: "Whipped Shea Body Butter", brand: "botanique", cat: "bath-body", price: 18, glyph: "jar", tint: "#f0ece0",
    attributes: "vegan,clean",
    short: "Deeply nourishing, fast-absorbing.",
    desc: "Whipped shea and cocoa butter melt into skin for lasting softness without grease.",
    sizes: ["200ml"] },
  { name: "Neroli Body Wash", brand: "lys", cat: "bath-body", price: 16, glyph: "bottle", tint: "#eef0e4",
    short: "A gentle, beautifully-scented cleanse.",
    desc: "A sulphate-free gel that lathers softly and leaves skin lightly scented with neroli.",
    sizes: ["250ml"] },
  { name: "Exfoliating Body Scrub", brand: "botanique", cat: "bath-body", price: 20, sale: 15, glyph: "jar", tint: "#efe7dc",
    attributes: "vegan",
    short: "Sugar + oil polish for glowing skin.",
    desc: "Fine cane sugar buffs away dullness while nourishing oils leave skin silky.",
    sizes: ["200ml"] },
  { name: "Hand Cream Trio", brand: "lys", cat: "bath-body", price: 24, glyph: "tube", tint: "#f2eae2",
    short: "Three pocket-size hand creams.",
    desc: "A trio of quick-absorbing hand creams in neroli, rose and fig.",
    sizes: ["3 × 30ml"] },

  // ---------------- hair
  { name: "Repair Argan Hair Oil", brand: "novi", cat: "hair", price: 26, glyph: "dropper", tint: "#efe8d8", best: true,
    concerns: "frizz,dryness",
    short: "Lightweight oil for shine & frizz control.",
    desc: "Argan and camellia oils tame frizz and add mirror shine without weighing hair down.",
    sizes: ["50ml"] },
  { name: "Volumising Shampoo", brand: "seul", cat: "hair", price: 19, glyph: "bottle", tint: "#eae6f0",
    concerns: "fine-hair",
    short: "Body and bounce for fine hair.",
    desc: "A gentle, sulphate-free shampoo that lifts roots and adds fullness.",
    sizes: ["250ml"] },
  { name: "Bond Repair Mask", brand: "seul", cat: "hair", price: 28, glyph: "jar", tint: "#ede9f3", newp: true,
    concerns: "damage,dryness",
    short: "Weekly treatment for damaged hair.",
    desc: "Rebuilds bonds in over-processed hair for softer, stronger strands.",
    sizes: ["200ml"] },

  // ---------------- fragrance
  { name: "Tulipe Blanche Eau de Parfum", brand: "maison-ivelle", cat: "fragrance", price: 68, glyph: "mist", tint: "#f4ece3", best: true, newp: true,
    short: "White tulip, magnolia & soft musk.",
    desc: "Our signature scent — a fresh, powdery floral built on white tulip and magnolia, grounded in warm musk. Elegant and unmistakably TulipGlam.",
    sizes: ["50ml", "90ml"],
    reviews: [{ author: "Nour A.", rating: 5, title: "Signature scent", text: "Clean, feminine, lasts all day without being heavy. I get compliments every time." }] },
  { name: "Ambre Nuit Eau de Parfum", brand: "maison-ivelle", cat: "fragrance", price: 72, glyph: "mist", tint: "#efe4d8",
    short: "Warm amber, vanilla & tonka.",
    desc: "An enveloping evening fragrance of amber, vanilla and tonka bean.",
    sizes: ["50ml"] },
  { name: "Rose Musk Hair & Body Mist", brand: "lys", cat: "fragrance", price: 28, glyph: "mist", tint: "#f4e6e6",
    short: "A light veil of rose and musk.",
    desc: "A soft, everyday mist for hair and body — never overpowering.",
    sizes: ["100ml"] },

  // ---------------- gift sets
  { name: "The Skincare Edit Set", brand: null, cat: "gift-sets", price: 75, sale: 60, glyph: "jar", tint: "#f5e9f0",
    short: "Cleanser, serum & moisturiser trio.",
    desc: "A ready-to-give routine: Gentle Gel Cleanser, Hydra-Plump Serum and Ceramide Moisturiser, boxed beautifully." },
  { name: "Glow Essentials Kit", brand: null, cat: "gift-sets", price: 55, glyph: "compact", tint: "#f4e8ea",
    short: "Blush, highlighter & lip oil.",
    desc: "The three-step glow: Cloud Blush, Glow Highlighter and Lip Oil Gloss." },
  { name: "Fragrance Discovery Set", brand: null, cat: "gift-sets", price: 45, glyph: "mist", tint: "#f2ece2", newp: true,
    short: "Three 10ml eau de parfums.",
    desc: "Discover the house in miniature: Tulipe Blanche, Ambre Nuit and Rose Musk." },
];

async function main() {
  console.log("Resetting…");
  await db.orderEvent.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.address.deleteMany();
  await db.customer.deleteMany();
  await db.coupon.deleteMany();
  await db.giftCard.deleteMany();
  await db.review.deleteMany();
  await db.productVariant.deleteMany();
  await db.productImage.deleteMany();
  await db.product.deleteMany();
  await db.brand.deleteMany();
  await db.category.deleteMany();
  await db.setting.deleteMany();
  await db.deliveryArea.deleteMany();

  const catMap = new Map<string, number>();
  for (const c of CATEGORIES) {
    const row = await db.category.create({ data: c });
    catMap.set(c.slug, row.id);
  }

  const brandMap = new Map<string, number>();
  for (const [i, b] of BRANDS.entries()) {
    const row = await db.brand.create({ data: { ...b, sortOrder: i } });
    brandMap.set(b.slug, row.id);
  }

  for (const p of P) {
    const product = await db.product.create({
      data: {
        slug: slugify(`${p.brand ?? "tulipglam"}-${p.name}`),
        name: p.name,
        priceCents: Math.round(p.price * 100),
        saleCents: p.sale ? Math.round(p.sale * 100) : null,
        shortDesc: p.short,
        description: p.desc,
        howToUse: p.how ?? "",
        ingredients: p.ingredients ?? "",
        glyph: p.glyph,
        tint: p.tint,
        isBestSeller: !!p.best,
        isNewMode: p.newp ? "always" : "auto",
        concerns: p.concerns ?? "",
        attributes: p.attributes ?? "",
        categoryId: catMap.get(p.cat)!,
        brandId: p.brand ? brandMap.get(p.brand)! : null,
      },
    });
    if (p.shades) {
      await db.productVariant.createMany({
        data: p.shades.map(([label, hex], i) => ({ productId: product.id, type: "shade", label, hex, sortOrder: i })),
      });
    }
    if (p.sizes) {
      await db.productVariant.createMany({
        data: p.sizes.map((label, i) => ({ productId: product.id, type: "size", label, sortOrder: i })),
      });
    }
    if (p.reviews) {
      await db.review.createMany({
        data: p.reviews.map((r) => ({ productId: product.id, author: r.author, rating: r.rating, title: r.title ?? "", text: r.text })),
      });
    }
  }

  const areas = [
    ["Beirut", 200], ["Mount Lebanon", 300], ["Keserwan – Jbeil", 350],
    ["North Lebanon", 400], ["South Lebanon", 400], ["Nabatieh", 450],
    ["Bekaa", 450], ["Baalbek – Hermel", 500], ["Akkar", 500],
  ] as [string, number][];
  for (const [i, [name, fee]] of areas.entries()) {
    await db.deliveryArea.create({ data: { name, feeCents: fee, sortOrder: i } });
  }

  const settings: Record<string, string> = {
    storeName: "TulipGlam",
    announcement: "Free delivery over $60 · Cash on delivery across Lebanon",
    whatsappNumber: "9613000000",
    instagramUrl: "https://instagram.com/tulipglam",
    freeDeliveryThresholdCents: "6000",
    defaultDeliveryCents: "300",
    newArrivalDays: "30",
    promoTitle: "The Skincare Edit — up to 30% off",
    promoText: "Serums, moisturisers and masks from Aureli, Novi & Botanique. While stocks last.",
    promoActive: "true",
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.setting.create({ data: { key, value } });
  }

  // demo coupons + a gift card so the features are visible out of the box
  await db.coupon.create({ data: { code: "WELCOME10", type: "percent", value: 10, minOrderCents: 0, active: true } });
  await db.coupon.create({ data: { code: "GLOW5", type: "fixed", value: 500, minOrderCents: 3000, active: true } });
  await db.giftCard.create({ data: { code: "TG-GIFT-5000", initialCents: 5000, balanceCents: 5000, recipientName: "Sample", senderName: "TulipGlam", active: true } });

  const counts = {
    categories: await db.category.count(),
    brands: await db.brand.count(),
    products: await db.product.count(),
    variants: await db.productVariant.count(),
    reviews: await db.review.count(),
    areas: await db.deliveryArea.count(),
  };
  console.log("Seeded:", counts);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
