/**
 * A small, deterministic shop for the browser suite to walk through.
 *
 * Deliberately NOT the production catalogue: 9,672 products make the suite slow and its
 * assertions vague ("some product appeared"). A dozen products with known names, prices and
 * categories let a test say "searching 'shampo' returns Keratin Shampoo first" and mean it.
 *
 * Every value here is invented test data. Nothing is copied from the real catalogue, so no
 * supplier's pricing or copy leaks into a fixture, and nothing here can be mistaken for a real
 * product if it ever shows up somewhere it should not.
 */
import { PrismaClient } from "@prisma/client";
import { pgUrl } from "./driver.mjs";

export const FIXTURES = {
  areas: [
    { name: "Beirut", feeCents: 200 },
    { name: "Mount Lebanon", feeCents: 300 },
  ],
  settings: {
    storeName: "TulipGlam",
    siteUrl: "http://127.0.0.1",
    whatsappNumber: "96170123456",
    freeDeliveryThresholdCents: "6000",
    defaultDeliveryCents: "300",
    newArrivalDays: "30",
    deliveryEstimate: "",
    returnsWindow: "",
  },
  brands: [
    { slug: "keralux", name: "Keralux" },
    { slug: "novena", name: "Novena" },
    { slug: "lumea", name: "Lumea" },
    /**
     * A brand whose ONLY product is out of stock.
     *
     * Reproduces a real defect: the brand directory counts products as active OR unavailable, so
     * a brand like this is listed — while the shop defaults to active-only, so clicking it landed
     * on an empty shelf. Five real brands (Clipp, Cosmaline, Gillette, Hamlet, Tabac) were in
     * exactly this state. Without a fixture in the same state, the fix has nothing to prove
     * itself against.
     */
    { slug: "solene", name: "Solene" },
  ],
  // department -> children
  categories: [
    { slug: "hair", name: "Hair", children: [{ slug: "shampoo", name: "Shampoo" }, { slug: "conditioner", name: "Conditioner" }] },
    { slug: "makeup", name: "Makeup", children: [{ slug: "lips", name: "Lips" }, { slug: "eyes", name: "Eyes" }] },
    { slug: "skincare", name: "Skincare", children: [{ slug: "moisturisers", name: "Moisturisers" }] },
  ],
  products: [
    { slug: "keratin-shampoo", name: "Keratin Shampoo", brand: "keralux", cat: "shampoo", priceCents: 1200, status: "active", best: true },
    { slug: "fortifying-shampoo", name: "Fortifying Shampoo", brand: "keralux", cat: "shampoo", priceCents: 1400, status: "active" },
    { slug: "dandruff-shampoo", name: "Dandruff Shampoo", brand: "novena", cat: "shampoo", priceCents: 1100, status: "active" },
    { slug: "keratin-conditioner", name: "Keratin Conditioner", brand: "keralux", cat: "conditioner", priceCents: 1300, status: "active" },
    { slug: "velvet-lipstick", name: "Velvet Lipstick", brand: "lumea", cat: "lips", priceCents: 900, saleCents: 700, status: "active" },
    { slug: "lip-liner-nude", name: "Lip Liner Nude", brand: "lumea", cat: "lips", priceCents: 650, status: "active" },
    { slug: "volume-mascara", name: "Volume Mascara", brand: "lumea", cat: "eyes", priceCents: 1500, status: "active", best: true },
    { slug: "eye-shadow-quad", name: "Eye Shadow Quad", brand: "lumea", cat: "eyes", priceCents: 2100, status: "active" },
    { slug: "soft-day-cream", name: "Soft Day Cream", brand: "novena", cat: "moisturisers", priceCents: 1800, status: "active" },
    { slug: "night-repair-cream", name: "Night Repair Cream", brand: "novena", cat: "moisturisers", priceCents: 2600, status: "active" },
    // One of each non-active status, so visibility rules have something to exclude.
    { slug: "hidden-serum", name: "Hidden Test Serum", brand: "novena", cat: "moisturisers", priceCents: 3000, status: "hidden" },
    { slug: "unavailable-balm", name: "Unavailable Lip Balm", brand: "lumea", cat: "lips", priceCents: 500, status: "unavailable" },
    // Solene's only product, and it is out of stock — see the brand's note above.
    { slug: "solene-hand-cream", name: "Solene Hand Cream", brand: "solene", cat: "moisturisers", priceCents: 1450, status: "unavailable" },
  ],
};

export async function seed(dbName) {
  const url = pgUrl(dbName);
  const db = new PrismaClient({ datasources: { db: { url } } });

  // Order matters: children reference parents, products reference both.
  await db.orderItem.deleteMany({});
  await db.orderEvent.deleteMany({});
  await db.order.deleteMany({});
  await db.productImage.deleteMany({});
  await db.productVariant.deleteMany({});
  await db.review.deleteMany({});
  await db.product.deleteMany({});
  await db.category.deleteMany({});
  await db.brand.deleteMany({});
  await db.deliveryArea.deleteMany({});
  await db.setting.deleteMany({});

  for (const [key, value] of Object.entries(FIXTURES.settings)) {
    await db.setting.create({ data: { key, value } });
  }
  for (const [i, a] of FIXTURES.areas.entries()) {
    await db.deliveryArea.create({ data: { ...a, active: true, sortOrder: i } });
  }

  const brandIds = new Map();
  for (const [i, b] of FIXTURES.brands.entries()) {
    const row = await db.brand.create({ data: { ...b, sortOrder: i, active: true } });
    brandIds.set(b.slug, row.id);
  }

  const catIds = new Map();
  for (const [i, c] of FIXTURES.categories.entries()) {
    const parent = await db.category.create({ data: { slug: c.slug, name: c.name, sortOrder: i, active: true } });
    catIds.set(c.slug, parent.id);
    for (const [j, ch] of c.children.entries()) {
      const child = await db.category.create({
        data: { slug: ch.slug, name: ch.name, sortOrder: j, active: true, parentId: parent.id },
      });
      catIds.set(ch.slug, child.id);
    }
  }

  for (const p of FIXTURES.products) {
    const row = await db.product.create({
      data: {
        slug: p.slug, name: p.name, status: p.status,
        priceCents: p.priceCents, saleCents: p.saleCents ?? null,
        isBestSeller: !!p.best,
        categoryId: catIds.get(p.cat),
        brandId: brandIds.get(p.brand),
        source: "e2e",
        shortDesc: `${p.name} — fixture product for the browser suite.`,
        description: `${p.name} is test data. It is not a real product and is never sold.`,
      },
    });
    // One image each, so cards render the same shape as production.
    await db.productImage.create({
      data: { productId: row.id, url: `/products/e2e/${p.slug}.webp`, sortOrder: 0, alt: p.name },
    });
  }

  // searchText is what search matches on, and it is empty until this runs — the same trap the
  // importers have a hook for.
  const { ensureSearchIndex, refreshSearchText } = await import("../../src/searchIndex.ts");
  await ensureSearchIndex(db);
  await refreshSearchText(db, { write: true });

  const counts = {
    products: await db.product.count(),
    active: await db.product.count({ where: { status: "active" } }),
    categories: await db.category.count(),
    brands: await db.brand.count(),
  };
  await db.$disconnect();
  return counts;
}
