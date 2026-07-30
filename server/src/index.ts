import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { ORDER_STATUSES, STATUS_KEYS, statusMeta } from "./status.js";
import { hashPassword, checkPassword, signToken, withCustomer, requireCustomer } from "./auth.js";
import { sendMail, orderConfirmationEmail, statusUpdateEmail } from "./mailer.js";

const db = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" })); // room for base64 image uploads

const PORT = Number(process.env.PORT ?? 4230);
const ADMIN_KEY = process.env.ADMIN_KEY ?? "tulip-admin-2026";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads");
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* noop */ }
app.use("/uploads", express.static(UPLOAD_DIR));

// ---- helpers ----
const num = (v: unknown, d = 0) => (v === undefined || v === null || v === "" ? d : Number(v));
const str = (v: unknown, d = "") => (v === undefined || v === null ? d : String(v));
const bool = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";
const toCents = (v: unknown) => Math.round(num(v) * 100);
const list = (s: string) => str(s).split(",").map((t) => t.trim()).filter(Boolean);
const slugify = (s: string, suffix = "") =>
  (s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "item") + (suffix ? `-${suffix}` : "");

const asyncH =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: "Something went wrong." }); });

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.header("x-admin-key") !== ADMIN_KEY) return res.status(401).json({ error: "Access denied." });
  next();
}

async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// New badge: mode always/never override; auto = created within N days.
function computeIsNew(p: { isNewMode: string; createdAt: Date }, days: number) {
  if (p.isNewMode === "always") return true;
  if (p.isNewMode === "never") return false;
  return Date.now() - new Date(p.createdAt).getTime() < days * 864e5;
}

type ProdWith = Prisma.ProductGetPayload<{ include: { brand: true; category: true; images: true } }>;
function cardOf(p: ProdWith, newDays: number) {
  return {
    id: p.id, slug: p.slug, name: p.name, status: p.status,
    priceCents: p.priceCents, saleCents: p.saleCents,
    onSale: p.saleCents != null && p.saleCents < p.priceCents,
    glyph: p.glyph, tint: p.tint,
    image: p.images[0]?.url ?? "",
    brand: p.brand ? { name: p.brand.name, slug: p.brand.slug } : null,
    category: { name: p.category.name, slug: p.category.slug },
    isBestSeller: p.isBestSeller,
    isNew: computeIsNew(p, newDays),
  };
}
const cardInclude = { brand: true, category: true, images: { orderBy: { sortOrder: "asc" as const }, take: 1 } };

// ============================================================ PUBLIC
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// header/footer/home bootstrap: settings + categories + featured brands + areas
app.get("/api/site", asyncH(async (_req, res) => {
  const [settings, categories, brands, areas] = await Promise.all([
    getSettings(),
    db.category.findMany({ where: { active: true, parentId: null }, orderBy: { sortOrder: "asc" },
      include: { _count: { select: { products: { where: { status: { in: ["active", "unavailable"] } } } } } } }),
    db.brand.findMany({ where: { active: true }, orderBy: [{ featured: "desc" }, { sortOrder: "asc" }] }),
    db.deliveryArea.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  res.json({ settings, categories, brands, areas, statuses: ORDER_STATUSES });
}));

// home collections
app.get("/api/home", asyncH(async (_req, res) => {
  const settings = await getSettings();
  const newDays = num(settings.newArrivalDays, 30);
  const [best, fresh, reviews] = await Promise.all([
    db.product.findMany({ where: { status: "active", isBestSeller: true }, include: cardInclude, take: 8, orderBy: { updatedAt: "desc" } }),
    db.product.findMany({ where: { status: "active" }, include: cardInclude, orderBy: { createdAt: "desc" }, take: 12 }),
    db.review.findMany({ where: { approved: true }, orderBy: { createdAt: "desc" }, take: 6, include: { product: { select: { name: true } } } }),
  ]);
  const newArrivals = fresh.filter((p) => computeIsNew(p, newDays)).slice(0, 8);
  res.json({
    bestSellers: best.map((p) => cardOf(p, newDays)),
    newArrivals: (newArrivals.length ? newArrivals : fresh.slice(0, 8)).map((p) => cardOf(p, newDays)),
    reviews: reviews.map((r) => ({ id: r.id, author: r.author, rating: r.rating, text: r.text, title: r.title, product: r.product?.name ?? "" })),
  });
}));

// product listing with filters, search, sort
app.get("/api/products", asyncH(async (req, res) => {
  const settings = await getSettings();
  const newDays = num(settings.newArrivalDays, 30);
  const q = str(req.query.q).trim();
  const where: Prisma.ProductWhereInput = { status: { in: ["active", "unavailable"] } };
  const and: Prisma.ProductWhereInput[] = [];

  // A department (Nails, Makeup…) holds no products itself — they sit in its
  // subcategories, so match the category AND its children or the department pages
  // come back empty.
  if (req.query.category) {
    const slug = str(req.query.category);
    const cat = await db.category.findUnique({ where: { slug }, select: { id: true, children: { select: { id: true } } } });
    if (!cat) return res.json({ products: [], total: 0 });
    and.push({ categoryId: { in: [cat.id, ...cat.children.map((c) => c.id)] } });
  }
  if (req.query.brand) and.push({ brand: { slug: str(req.query.brand) } });
  if (bool(req.query.sale)) and.push({ AND: [{ saleCents: { not: null } }] });
  if (bool(req.query.best)) and.push({ isBestSeller: true });
  for (const c of list(str(req.query.concerns))) and.push({ concerns: { contains: c } });
  for (const a of list(str(req.query.attributes))) and.push({ attributes: { contains: a } });
  if (q) {
    for (const term of q.split(/\s+/).filter(Boolean)) {
      and.push({ OR: [
        { name: { contains: term } },
        { shortDesc: { contains: term } },
        { concerns: { contains: term } },
        { attributes: { contains: term } },
        { brand: { name: { contains: term } } },
        { category: { name: { contains: term } } },
      ] });
    }
  }
  if (and.length) where.AND = and;

  const sort = str(req.query.sort, "featured");
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    sort === "price-asc" ? [{ priceCents: "asc" }]
    : sort === "price-desc" ? [{ priceCents: "desc" }]
    : sort === "newest" ? [{ createdAt: "desc" }]
    : sort === "name" ? [{ name: "asc" }]
    : [{ isBestSeller: "desc" }, { createdAt: "desc" }];

  const products = await db.product.findMany({ where, include: cardInclude, orderBy });
  let cards = products.map((p) => cardOf(p, newDays));
  if (bool(req.query.new)) cards = cards.filter((c) => c.isNew);
  res.json({ products: cards, total: cards.length });
}));

// search type-ahead
app.get("/api/search", asyncH(async (req, res) => {
  const q = str(req.query.q).trim();
  if (!q) return res.json({ products: [] });
  const settings = await getSettings();
  const newDays = num(settings.newArrivalDays, 30);
  const products = await db.product.findMany({
    where: { status: { in: ["active", "unavailable"] }, OR: [
      { name: { contains: q } }, { brand: { name: { contains: q } } }, { category: { name: { contains: q } } },
    ] },
    include: cardInclude, take: 6, orderBy: { isBestSeller: "desc" },
  });
  res.json({ products: products.map((p) => cardOf(p, newDays)) });
}));

// single product
app.get("/api/products/:slug", asyncH(async (req, res) => {
  const settings = await getSettings();
  const newDays = num(settings.newArrivalDays, 30);
  const p = await db.product.findUnique({
    where: { slug: str(req.params.slug) },
    include: {
      brand: true, category: true,
      images: { orderBy: { sortOrder: "asc" } },
      variants: { orderBy: { sortOrder: "asc" } },
      reviews: { where: { approved: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!p || p.status === "hidden" || p.status === "discontinued") return res.status(404).json({ error: "Product not found." });

  // Related: same subcategory first, then topped up from the sibling subcategories in
  // the same department — several subcategories hold only one or two products, which
  // would otherwise leave this empty.
  const related = await db.product.findMany({
    where: { status: "active", categoryId: p.categoryId, id: { not: p.id } },
    include: cardInclude, take: 4, orderBy: { isBestSeller: "desc" },
  });
  if (related.length < 4) {
    const deptId = p.category.parentId ?? p.categoryId;
    const siblings = await db.category.findMany({ where: { OR: [{ id: deptId }, { parentId: deptId }] }, select: { id: true } });
    const fill = await db.product.findMany({
      where: { status: "active", categoryId: { in: siblings.map((c) => c.id) }, id: { notIn: [p.id, ...related.map((r) => r.id)] } },
      include: cardInclude, take: 4 - related.length, orderBy: { isBestSeller: "desc" },
    });
    related.push(...fill);
  }
  const ratingAvg = p.reviews.length ? p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length : 0;
  res.json({
    id: p.id, slug: p.slug, name: p.name, status: p.status,
    priceCents: p.priceCents, saleCents: p.saleCents,
    onSale: p.saleCents != null && p.saleCents < p.priceCents,
    shortDesc: p.shortDesc, description: p.description, howToUse: p.howToUse, ingredients: p.ingredients,
    glyph: p.glyph, tint: p.tint, videoUrl: p.videoUrl,
    concerns: list(p.concerns), attributes: list(p.attributes),
    brand: p.brand ? { name: p.brand.name, slug: p.brand.slug } : null,
    category: { name: p.category.name, slug: p.category.slug },
    isBestSeller: p.isBestSeller, isNew: computeIsNew(p, newDays),
    images: p.images.map((i) => ({ url: i.url, alt: i.alt })),
    // sku is deliberately not exposed publicly — it's a supplier reference, admin-only.
    variants: p.variants.map((v) => ({ id: v.id, type: v.type, label: v.label, hex: v.hex, imageUrl: v.imageUrl, priceCents: v.priceCents, available: v.available })),
    reviews: p.reviews.map((r) => ({ id: r.id, author: r.author, rating: r.rating, title: r.title, text: r.text, createdAt: r.createdAt })),
    ratingAvg, reviewCount: p.reviews.length,
    related: related.map((r) => cardOf(r, newDays)),
  });
}));

// brands list (public)
app.get("/api/brands", asyncH(async (_req, res) => {
  const brands = await db.brand.findMany({ where: { active: true }, orderBy: [{ featured: "desc" }, { name: "asc" }],
    include: { _count: { select: { products: { where: { status: { in: ["active", "unavailable"] } } } } } } });
  res.json({ brands });
}));

// submit a review (held for approval)
app.post("/api/products/:slug/reviews", asyncH(async (req, res) => {
  const p = await db.product.findUnique({ where: { slug: str(req.params.slug) } });
  if (!p) return res.status(404).json({ error: "Product not found." });
  const author = str(req.body.author).trim();
  const text = str(req.body.text).trim();
  if (!author || !text) return res.status(400).json({ error: "Name and review are required." });
  await db.review.create({ data: {
    productId: p.id, author, text, title: str(req.body.title),
    rating: Math.min(5, Math.max(1, num(req.body.rating, 5))), approved: false,
  } });
  res.json({ ok: true, message: "Thanks! Your review will appear once approved." });
}));

// ---- promotions (coupons + gift cards) ----
// Evaluate a coupon against a subtotal. Returns discount in cents + any error.
async function evalCoupon(code: string, subtotal: number): Promise<{ coupon: Prisma.CouponGetPayload<object> | null; discount: number; error?: string }> {
  const c = code ? await db.coupon.findUnique({ where: { code: code.trim().toUpperCase() } }) : null;
  if (!code) return { coupon: null, discount: 0 };
  if (!c || !c.active) return { coupon: null, discount: 0, error: "Invalid coupon code." };
  if (c.expiresAt && c.expiresAt.getTime() < Date.now()) return { coupon: null, discount: 0, error: "This coupon has expired." };
  if (c.maxUses != null && c.usedCount >= c.maxUses) return { coupon: null, discount: 0, error: "This coupon is no longer available." };
  if (subtotal < c.minOrderCents) return { coupon: null, discount: 0, error: `Spend at least ${(c.minOrderCents / 100).toFixed(0)}$ to use this coupon.` };
  const discount = c.type === "percent" ? Math.round((subtotal * c.value) / 100) : Math.min(c.value, subtotal);
  return { coupon: c, discount };
}

app.post("/api/coupons/validate", asyncH(async (req, res) => {
  const { discount, error } = await evalCoupon(str(req.body.code), num(req.body.subtotalCents));
  if (error) return res.status(400).json({ error });
  res.json({ ok: true, discountCents: discount });
}));

app.get("/api/gift-cards/:code", asyncH(async (req, res) => {
  const g = await db.giftCard.findUnique({ where: { code: str(req.params.code).trim().toUpperCase() } });
  if (!g || !g.active || g.balanceCents <= 0) return res.status(404).json({ error: "Invalid or empty gift card." });
  res.json({ ok: true, code: g.code, balanceCents: g.balanceCents });
}));

// ---- orders ----
function orderNumber() {
  return "TG-" + randomUUID().replace(/[^0-9a-z]/gi, "").slice(0, 6).toUpperCase();
}

app.post("/api/orders", withCustomer, asyncH(async (req, res) => {
  const b = req.body ?? {};
  const customerId = (req as express.Request & { customerId?: number }).customerId;
  const items: { productId: unknown; variantId?: unknown; qty?: unknown }[] = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: "Your cart is empty." });
  const fullName = str(b.fullName).trim();
  const phone = str(b.phone).trim();
  if (!fullName || !phone) return res.status(400).json({ error: "Name and phone are required." });

  // Price server-side from the live catalogue — never trust client prices.
  const ids: number[] = [...new Set(items.map((i: { productId: unknown }) => num(i.productId)))];
  const products = await db.product.findMany({ where: { id: { in: ids } }, include: { brand: true, images: { orderBy: { sortOrder: "asc" }, take: 1 }, variants: true } });
  const byId = new Map(products.map((p) => [p.id, p]));

  const orderItems: Prisma.OrderItemUncheckedCreateWithoutOrderInput[] = [];
  let subtotal = 0;
  for (const it of items) {
    const p = byId.get(num(it.productId));
    if (!p || p.status === "discontinued" || p.status === "hidden") continue;
    const variant = p.variants.find((v) => v.id === num(it.variantId));
    const unit = variant?.priceCents ?? p.saleCents ?? p.priceCents;
    const qty = Math.max(1, num(it.qty, 1));
    subtotal += unit * qty;
    orderItems.push({
      productId: p.id, name: p.name, brandName: p.brand?.name ?? "",
      variantLabel: variant?.label ?? "", glyph: p.glyph, tint: p.tint,
      // prefer the chosen shade's own photo so the order shows the exact shade bought
      imageUrl: variant?.imageUrl || p.images[0]?.url || "", priceCents: unit, qty,
    });
  }
  if (!orderItems.length) return res.status(400).json({ error: "None of your items are available." });

  const settings = await getSettings();
  const threshold = num(settings.freeDeliveryThresholdCents, 6000);
  const areaRow = b.areaId ? await db.deliveryArea.findUnique({ where: { id: num(b.areaId) } }) : null;
  let delivery = areaRow?.feeCents ?? num(settings.defaultDeliveryCents, 300);
  if (subtotal >= threshold) delivery = 0;

  // coupon
  const { coupon, discount } = await evalCoupon(str(b.couponCode), subtotal);
  const afterDiscount = subtotal - discount + delivery;

  // gift card (applied last, against the remaining total)
  let giftCard: Prisma.GiftCardGetPayload<object> | null = null;
  let giftUsed = 0;
  if (str(b.giftCardCode)) {
    giftCard = await db.giftCard.findUnique({ where: { code: str(b.giftCardCode).trim().toUpperCase() } });
    if (giftCard && giftCard.active && giftCard.balanceCents > 0) giftUsed = Math.min(giftCard.balanceCents, afterDiscount);
  }
  const total = afterDiscount - giftUsed;

  const order = await db.order.create({
    data: {
      number: orderNumber(), status: "received", customerId: customerId ?? null,
      fullName, phone, whatsapp: str(b.whatsapp || b.phone), email: str(b.email),
      area: areaRow?.name ?? str(b.area), city: str(b.city), address: str(b.address), notes: str(b.notes),
      subtotalCents: subtotal, discountCents: discount, giftCardCents: giftUsed,
      couponCode: coupon?.code ?? "", giftCardCode: giftUsed > 0 ? giftCard!.code : "",
      deliveryCents: delivery, totalCents: total, paymentMethod: "cod",
      items: { create: orderItems },
      events: { create: { status: "received", note: "Order placed" } },
    },
    include: { items: true },
  });

  // consume the promotions
  if (coupon) await db.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
  if (giftUsed > 0 && giftCard) await db.giftCard.update({ where: { id: giftCard.id }, data: { balanceCents: { decrement: giftUsed } } });

  // fire-and-forget confirmation email (no-op unless SMTP configured)
  if (order.email) sendMail(settings, order.email, `Order ${order.number} received`, orderConfirmationEmail(settings.storeName ?? "TulipGlam", fullName, order.number, "$" + (total / 100).toFixed(2)));

  res.json({ number: order.number, totalCents: total, subtotalCents: subtotal, discountCents: discount, giftCardCents: giftUsed, deliveryCents: delivery, whatsappNumber: settings.whatsappNumber ?? "" });
}));

// track an order
app.get("/api/orders/:number", asyncH(async (req, res) => {
  const order = await db.order.findUnique({
    where: { number: str(req.params.number).toUpperCase() },
    include: { items: true, events: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) return res.status(404).json({ error: "No order with that number." });
  res.json(order);
}));

// ============================================================ CUSTOMER ACCOUNTS
const publicCustomer = (c: { id: number; email: string; fullName: string; phone: string }) => ({ id: c.id, email: c.email, fullName: c.fullName, phone: c.phone });

app.post("/api/auth/register", asyncH(async (req, res) => {
  const email = str(req.body.email).trim().toLowerCase();
  const password = str(req.body.password);
  const fullName = str(req.body.fullName).trim();
  if (!email || !password || !fullName) return res.status(400).json({ error: "Name, email and password are required." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  if (await db.customer.findUnique({ where: { email } })) return res.status(400).json({ error: "An account with this email already exists." });
  const customer = await db.customer.create({ data: { email, fullName, phone: str(req.body.phone), passwordHash: await hashPassword(password) } });
  res.json({ token: signToken(customer.id), customer: publicCustomer(customer) });
}));

app.post("/api/auth/login", asyncH(async (req, res) => {
  const email = str(req.body.email).trim().toLowerCase();
  const customer = await db.customer.findUnique({ where: { email } });
  if (!customer || !(await checkPassword(str(req.body.password), customer.passwordHash))) return res.status(401).json({ error: "Wrong email or password." });
  res.json({ token: signToken(customer.id), customer: publicCustomer(customer) });
}));

app.get("/api/auth/me", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  const customer = await db.customer.findUnique({ where: { id }, include: { addresses: { orderBy: { isDefault: "desc" } } } });
  if (!customer) return res.status(404).json({ error: "Account not found." });
  res.json({ customer: publicCustomer(customer), addresses: customer.addresses });
}));

app.put("/api/auth/me", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  const customer = await db.customer.update({ where: { id }, data: { fullName: str(req.body.fullName), phone: str(req.body.phone) } });
  res.json({ customer: publicCustomer(customer) });
}));

app.get("/api/auth/orders", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  const orders = await db.order.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, include: { items: true } });
  res.json({ orders });
}));

// addresses
app.get("/api/auth/addresses", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  res.json({ addresses: await db.address.findMany({ where: { customerId: id }, orderBy: { isDefault: "desc" } }) });
}));
app.post("/api/auth/addresses", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  const b = req.body;
  if (bool(b.isDefault)) await db.address.updateMany({ where: { customerId: id }, data: { isDefault: false } });
  const a = await db.address.create({ data: { customerId: id, label: str(b.label, "Home"), fullName: str(b.fullName), phone: str(b.phone), area: str(b.area), city: str(b.city), address: str(b.address), isDefault: bool(b.isDefault) } });
  res.json({ id: a.id });
}));
app.put("/api/auth/addresses/:id", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  const a = await db.address.findFirst({ where: { id: num(req.params.id), customerId: id } });
  if (!a) return res.status(404).json({ error: "Not found." });
  const b = req.body;
  if (bool(b.isDefault)) await db.address.updateMany({ where: { customerId: id }, data: { isDefault: false } });
  await db.address.update({ where: { id: a.id }, data: { label: str(b.label), fullName: str(b.fullName), phone: str(b.phone), area: str(b.area), city: str(b.city), address: str(b.address), isDefault: bool(b.isDefault) } });
  res.json({ ok: true });
}));
app.delete("/api/auth/addresses/:id", requireCustomer, asyncH(async (req, res) => {
  const id = (req as express.Request & { customerId: number }).customerId;
  await db.address.deleteMany({ where: { id: num(req.params.id), customerId: id } });
  res.json({ ok: true });
}));

// ============================================================ ADMIN
const admin = express.Router();
admin.use(requireAdmin);

// image upload (base64 data URL or raw base64)
admin.post("/upload", asyncH(async (req, res) => {
  const data = str(req.body.data);
  const m = data.match(/^data:(image\/\w+);base64,(.+)$/);
  const b64 = m ? m[2] : data;
  const ext = m ? m[1].split("/")[1].replace("jpeg", "jpg") : "jpg";
  if (!b64) return res.status(400).json({ error: "No image data." });
  const name = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(b64, "base64"));
  res.json({ url: `/uploads/${name}` });
}));

// ---- dashboard summary ----
admin.get("/summary", asyncH(async (_req, res) => {
  const [products, active, orders, pendingReviews, byStatus] = await Promise.all([
    db.product.count(), db.product.count({ where: { status: "active" } }),
    db.order.count(), db.review.count({ where: { approved: false } }),
    db.order.groupBy({ by: ["status"], _count: true }),
  ]);
  const recent = await db.order.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { items: true } });
  const revenue = await db.order.aggregate({ _sum: { totalCents: true }, where: { status: { notIn: ["cancelled", "unavailable"] } } });
  res.json({ products, active, orders, pendingReviews, revenueCents: revenue._sum.totalCents ?? 0,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])), recent });
}));

// ---- products ----
admin.get("/products", asyncH(async (req, res) => {
  const where: Prisma.ProductWhereInput = {};
  if (req.query.status) where.status = str(req.query.status);
  if (req.query.q) where.name = { contains: str(req.query.q) };
  const products = await db.product.findMany({ where, orderBy: { updatedAt: "desc" },
    include: { brand: true, category: true, images: { orderBy: { sortOrder: "asc" }, take: 1 }, _count: { select: { variants: true } } } });
  res.json({ products });
}));

admin.get("/products/:id", asyncH(async (req, res) => {
  const p = await db.product.findUnique({ where: { id: num(req.params.id) },
    include: { images: { orderBy: { sortOrder: "asc" } }, variants: { orderBy: { sortOrder: "asc" } } } });
  if (!p) return res.status(404).json({ error: "Not found." });
  res.json(p);
}));

function productData(b: Record<string, unknown>): Prisma.ProductUncheckedCreateInput {
  const price = toCents(b.price);
  const sale = b.sale === "" || b.sale == null ? null : toCents(b.sale);
  return {
    name: str(b.name).trim(),
    slug: str(b.slug).trim() || slugify(str(b.name), randomUUID().slice(0, 4)),
    sku: str(b.sku).trim(),
    status: STATUS_PRODUCT.includes(str(b.status)) ? str(b.status) : "active",
    priceCents: price, saleCents: sale && sale < price ? sale : null,
    shortDesc: str(b.shortDesc), description: str(b.description), howToUse: str(b.howToUse), ingredients: str(b.ingredients),
    glyph: str(b.glyph, "bottle"), tint: str(b.tint, "#f5e9f0"),
    isBestSeller: bool(b.isBestSeller), isNewMode: ["auto", "always", "never"].includes(str(b.isNewMode)) ? str(b.isNewMode) : "auto",
    concerns: Array.isArray(b.concerns) ? b.concerns.join(",") : str(b.concerns),
    attributes: Array.isArray(b.attributes) ? b.attributes.join(",") : str(b.attributes),
    categoryId: num(b.categoryId), brandId: b.brandId ? num(b.brandId) : null, videoUrl: str(b.videoUrl),
  };
}
const STATUS_PRODUCT = ["active", "hidden", "unavailable", "discontinued"];

type VariantIn = { type?: string; label?: string; sku?: string; hex?: string; imageUrl?: string; priceCents?: unknown; available?: unknown };
type ImageIn = { url?: string; alt?: string };
async function syncChildren(productId: number, b: Record<string, unknown>) {
  if (Array.isArray(b.variants)) {
    await db.productVariant.deleteMany({ where: { productId } });
    // sku + imageUrl must be carried through: variants are delete-and-recreate, so
    // dropping them here would silently wipe every shade photo and supplier code.
    await db.productVariant.createMany({ data: (b.variants as VariantIn[]).filter((v) => str(v.label).trim()).map((v, i) => ({
      productId, type: v.type === "size" ? "size" : "shade", label: str(v.label).trim(),
      sku: str(v.sku), hex: str(v.hex), imageUrl: str(v.imageUrl),
      priceCents: v.priceCents ? toCents(v.priceCents) : null, available: v.available === undefined ? true : bool(v.available), sortOrder: i,
    })) });
  }
  if (Array.isArray(b.images)) {
    await db.productImage.deleteMany({ where: { productId } });
    await db.productImage.createMany({ data: (b.images as ImageIn[]).filter((i) => str(i.url).trim()).map((im, i) => ({
      productId, url: str(im.url), alt: str(im.alt), sortOrder: i,
    })) });
  }
}

admin.post("/products", asyncH(async (req, res) => {
  const b = req.body ?? {};
  if (!str(b.name).trim() || !num(b.categoryId)) return res.status(400).json({ error: "Name and category are required." });
  const p = await db.product.create({ data: productData(b) });
  await syncChildren(p.id, b);
  res.json({ id: p.id });
}));

admin.put("/products/:id", asyncH(async (req, res) => {
  const id = num(req.params.id);
  const b = req.body ?? {};
  const { slug, ...data } = productData(b);
  await db.product.update({ where: { id }, data: { ...data, ...(str(b.slug).trim() ? { slug: str(b.slug).trim() } : {}) } });
  await syncChildren(id, b);
  res.json({ ok: true });
}));

admin.delete("/products/:id", asyncH(async (req, res) => {
  await db.product.delete({ where: { id: num(req.params.id) } });
  res.json({ ok: true });
}));

// quick status toggle
admin.patch("/products/:id/status", asyncH(async (req, res) => {
  const status = str(req.body.status);
  if (!STATUS_PRODUCT.includes(status)) return res.status(400).json({ error: "Bad status." });
  await db.product.update({ where: { id: num(req.params.id) }, data: { status } });
  res.json({ ok: true });
}));

// ---- categories ----
admin.get("/categories", asyncH(async (_req, res) => {
  res.json({ categories: await db.category.findMany({ orderBy: { sortOrder: "asc" },
    include: { _count: { select: { products: true } } } }) });
}));
admin.post("/categories", asyncH(async (req, res) => {
  const b = req.body;
  const row = await db.category.create({ data: {
    name: str(b.name).trim(), slug: str(b.slug).trim() || slugify(str(b.name)),
    blurb: str(b.blurb), glyph: str(b.glyph, "jar"), tint: str(b.tint, "#f5e9f0"),
    sortOrder: num(b.sortOrder), active: b.active === undefined ? true : bool(b.active),
    parentId: b.parentId ? num(b.parentId) : null,
  } });
  res.json({ id: row.id });
}));
admin.put("/categories/:id", asyncH(async (req, res) => {
  const b = req.body;
  await db.category.update({ where: { id: num(req.params.id) }, data: {
    name: str(b.name).trim(), blurb: str(b.blurb), glyph: str(b.glyph), tint: str(b.tint),
    sortOrder: num(b.sortOrder), active: bool(b.active), parentId: b.parentId ? num(b.parentId) : null,
    ...(str(b.slug).trim() ? { slug: str(b.slug).trim() } : {}),
  } });
  res.json({ ok: true });
}));
admin.delete("/categories/:id", asyncH(async (req, res) => {
  const count = await db.product.count({ where: { categoryId: num(req.params.id) } });
  if (count) return res.status(400).json({ error: `Move or delete ${count} product(s) first.` });
  await db.category.delete({ where: { id: num(req.params.id) } });
  res.json({ ok: true });
}));

// ---- brands ----
admin.get("/brands", asyncH(async (_req, res) => {
  res.json({ brands: await db.brand.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { products: true } } } }) });
}));
admin.post("/brands", asyncH(async (req, res) => {
  const b = req.body;
  const row = await db.brand.create({ data: {
    name: str(b.name).trim(), slug: str(b.slug).trim() || slugify(str(b.name)),
    blurb: str(b.blurb), featured: bool(b.featured), sortOrder: num(b.sortOrder), active: b.active === undefined ? true : bool(b.active),
  } });
  res.json({ id: row.id });
}));
admin.put("/brands/:id", asyncH(async (req, res) => {
  const b = req.body;
  await db.brand.update({ where: { id: num(req.params.id) }, data: {
    name: str(b.name).trim(), blurb: str(b.blurb), featured: bool(b.featured), sortOrder: num(b.sortOrder), active: bool(b.active),
    ...(str(b.slug).trim() ? { slug: str(b.slug).trim() } : {}),
  } });
  res.json({ ok: true });
}));
admin.delete("/brands/:id", asyncH(async (req, res) => {
  await db.product.updateMany({ where: { brandId: num(req.params.id) }, data: { brandId: null } });
  await db.brand.delete({ where: { id: num(req.params.id) } });
  res.json({ ok: true });
}));

// ---- orders ----
admin.get("/orders", asyncH(async (req, res) => {
  const where: Prisma.OrderWhereInput = {};
  if (req.query.status) where.status = str(req.query.status);
  if (req.query.q) where.OR = [{ number: { contains: str(req.query.q) } }, { fullName: { contains: str(req.query.q) } }, { phone: { contains: str(req.query.q) } }];
  const orders = await db.order.findMany({ where, orderBy: { createdAt: "desc" }, include: { items: true } });
  res.json({ orders });
}));
admin.get("/orders/:id", asyncH(async (req, res) => {
  const order = await db.order.findUnique({ where: { id: num(req.params.id) }, include: { items: true, events: { orderBy: { createdAt: "asc" } } } });
  if (!order) return res.status(404).json({ error: "Not found." });
  res.json(order);
}));
admin.put("/orders/:id/status", asyncH(async (req, res) => {
  const status = str(req.body.status);
  const note = str(req.body.note);
  if (!STATUS_KEYS.includes(status as (typeof STATUS_KEYS)[number])) return res.status(400).json({ error: "Bad status." });
  const order = await db.order.update({ where: { id: num(req.params.id) }, data: { status,
    events: { create: { status, note } } } });
  if (order.email) {
    const settings = await getSettings();
    sendMail(settings, order.email, `Order ${order.number}: ${statusMeta(status).label}`, statusUpdateEmail(settings.storeName ?? "TulipGlam", order.fullName, order.number, statusMeta(status).label, note));
  }
  res.json({ ok: true, status: order.status });
}));

// ---- reviews moderation ----
admin.get("/reviews", asyncH(async (req, res) => {
  const where = req.query.pending ? { approved: false } : {};
  res.json({ reviews: await db.review.findMany({ where, orderBy: { createdAt: "desc" }, include: { product: { select: { name: true, slug: true } } } }) });
}));
admin.patch("/reviews/:id", asyncH(async (req, res) => {
  await db.review.update({ where: { id: num(req.params.id) }, data: { approved: bool(req.body.approved) } });
  res.json({ ok: true });
}));
admin.delete("/reviews/:id", asyncH(async (req, res) => {
  await db.review.delete({ where: { id: num(req.params.id) } });
  res.json({ ok: true });
}));

// ---- settings + delivery areas ----
admin.get("/settings", asyncH(async (_req, res) => {
  res.json({ settings: await getSettings(), areas: await db.deliveryArea.findMany({ orderBy: { sortOrder: "asc" } }) });
}));
admin.put("/settings", asyncH(async (req, res) => {
  const entries = Object.entries(req.body?.settings ?? {});
  for (const [key, value] of entries) await db.setting.upsert({ where: { key }, update: { value: str(value) }, create: { key, value: str(value) } });
  res.json({ ok: true });
}));
admin.put("/delivery-areas", asyncH(async (req, res) => {
  const areas = Array.isArray(req.body?.areas) ? req.body.areas : [];
  for (const [i, a] of areas.entries()) {
    if (a.id) await db.deliveryArea.update({ where: { id: num(a.id) }, data: { name: str(a.name), feeCents: toCents(a.fee ?? a.feeCents / 100), active: bool(a.active), sortOrder: i } });
    else await db.deliveryArea.create({ data: { name: str(a.name), feeCents: toCents(a.fee), active: true, sortOrder: i } });
  }
  res.json({ ok: true });
}));

// ---- coupons ----
admin.get("/coupons", asyncH(async (_req, res) => {
  res.json({ coupons: await db.coupon.findMany({ orderBy: { createdAt: "desc" } }) });
}));
admin.post("/coupons", asyncH(async (req, res) => {
  const b = req.body;
  const code = str(b.code).trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Code is required." });
  if (await db.coupon.findUnique({ where: { code } })) return res.status(400).json({ error: "That code already exists." });
  const row = await db.coupon.create({ data: {
    code, type: b.type === "fixed" ? "fixed" : "percent",
    value: b.type === "fixed" ? toCents(b.value) : num(b.value),
    minOrderCents: toCents(b.minOrder), maxUses: b.maxUses ? num(b.maxUses) : null,
    expiresAt: b.expiresAt ? new Date(str(b.expiresAt)) : null, active: b.active === undefined ? true : bool(b.active),
  } });
  res.json({ id: row.id });
}));
admin.put("/coupons/:id", asyncH(async (req, res) => {
  const b = req.body;
  await db.coupon.update({ where: { id: num(req.params.id) }, data: {
    type: b.type === "fixed" ? "fixed" : "percent",
    value: b.type === "fixed" ? toCents(b.value) : num(b.value),
    minOrderCents: toCents(b.minOrder), maxUses: b.maxUses ? num(b.maxUses) : null,
    expiresAt: b.expiresAt ? new Date(str(b.expiresAt)) : null, active: bool(b.active),
  } });
  res.json({ ok: true });
}));
admin.delete("/coupons/:id", asyncH(async (req, res) => { await db.coupon.delete({ where: { id: num(req.params.id) } }); res.json({ ok: true }); }));

// ---- gift cards ----
function giftCode() { return "TG-GIFT-" + randomUUID().replace(/[^0-9a-z]/gi, "").slice(0, 6).toUpperCase(); }
admin.get("/gift-cards", asyncH(async (_req, res) => {
  res.json({ giftCards: await db.giftCard.findMany({ orderBy: { createdAt: "desc" } }) });
}));
admin.post("/gift-cards", asyncH(async (req, res) => {
  const b = req.body;
  const amount = toCents(b.amount);
  if (amount <= 0) return res.status(400).json({ error: "Enter an amount." });
  const row = await db.giftCard.create({ data: {
    code: str(b.code).trim().toUpperCase() || giftCode(), initialCents: amount, balanceCents: amount,
    recipientName: str(b.recipientName), senderName: str(b.senderName), message: str(b.message), active: true,
  } });
  res.json({ id: row.id, code: row.code });
}));
admin.put("/gift-cards/:id", asyncH(async (req, res) => {
  const b = req.body;
  await db.giftCard.update({ where: { id: num(req.params.id) }, data: {
    balanceCents: b.balance != null ? toCents(b.balance) : undefined, active: bool(b.active),
    recipientName: str(b.recipientName), senderName: str(b.senderName), message: str(b.message),
  } });
  res.json({ ok: true });
}));
admin.delete("/gift-cards/:id", asyncH(async (req, res) => { await db.giftCard.delete({ where: { id: num(req.params.id) } }); res.json({ ok: true }); }));

// ---- customers ----
admin.get("/customers", asyncH(async (req, res) => {
  const where: Prisma.CustomerWhereInput = {};
  if (req.query.q) where.OR = [{ fullName: { contains: str(req.query.q) } }, { email: { contains: str(req.query.q) } }, { phone: { contains: str(req.query.q) } }];
  const customers = await db.customer.findMany({ where, orderBy: { createdAt: "desc" },
    include: { _count: { select: { orders: true } }, orders: { select: { totalCents: true, status: true } } } });
  res.json({ customers: customers.map((c) => ({
    id: c.id, email: c.email, fullName: c.fullName, phone: c.phone, createdAt: c.createdAt,
    orderCount: c._count.orders,
    spentCents: c.orders.filter((o) => !["cancelled", "unavailable"].includes(o.status)).reduce((s, o) => s + o.totalCents, 0),
  })) });
}));

// ---- Excel import ----
admin.get("/import/template", (_req, res) => {
  const rows = [{
    name: "Velvet Lipstick", brand: "Lâme", category: "makeup", price: 22, sale: "", status: "active",
    shortDesc: "Weightless matte colour", description: "Full description here", glyph: "lipstick", tint: "#f7e2e6",
    bestSeller: "yes", concerns: "", attributes: "vegan,cruelty-free",
    shades: "Rosewood:#9b5b5b; Brick:#a4432f", sizes: "",
  }];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=tulipglam-import-template.xlsx");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
});

admin.post("/import", asyncH(async (req, res) => {
  const data = str(req.body.data).replace(/^data:.*?;base64,/, "");
  if (!data) return res.status(400).json({ error: "No file." });
  const wb = XLSX.read(Buffer.from(data, "base64"), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
  const cats = new Map((await db.category.findMany()).map((c) => [c.slug.toLowerCase(), c.id]));
  const catByName = new Map((await db.category.findMany()).map((c) => [c.name.toLowerCase(), c.id]));
  const brands = new Map((await db.brand.findMany()).map((b) => [b.name.toLowerCase(), b.id]));

  let created = 0, updated = 0; const errors: string[] = [];
  for (const [i, r] of rows.entries()) {
    try {
      const name = str(r.name).trim();
      if (!name) continue;
      const catKey = str(r.category).toLowerCase().trim();
      const categoryId = cats.get(catKey) ?? catByName.get(catKey);
      if (!categoryId) { errors.push(`Row ${i + 2}: unknown category "${r.category}"`); continue; }
      let brandId: number | null = null;
      const bName = str(r.brand).trim();
      if (bName) {
        brandId = brands.get(bName.toLowerCase()) ?? null;
        if (!brandId) { const nb = await db.brand.create({ data: { name: bName, slug: slugify(bName) } }); brandId = nb.id; brands.set(bName.toLowerCase(), nb.id); }
      }
      const price = toCents(r.price);
      const sale = r.sale === "" || r.sale == null ? null : toCents(r.sale);
      const slug = slugify(`${bName || "tulipglam"}-${name}`);
      const base = {
        name, status: STATUS_PRODUCT.includes(str(r.status)) ? str(r.status) : "active",
        priceCents: price, saleCents: sale && sale < price ? sale : null,
        shortDesc: str(r.shortDesc), description: str(r.description),
        glyph: str(r.glyph, "bottle"), tint: str(r.tint, "#f5e9f0"),
        isBestSeller: bool(r.bestSeller) || str(r.bestSeller).toLowerCase() === "yes",
        concerns: str(r.concerns), attributes: str(r.attributes), categoryId, brandId,
      };
      const existing = await db.product.findUnique({ where: { slug } });
      const p = existing
        ? await db.product.update({ where: { slug }, data: base })
        : await db.product.create({ data: { ...base, slug } });
      existing ? updated++ : created++;

      const parseVariants = (s: string, type: "shade" | "size") => str(s).split(";").map((x) => x.trim()).filter(Boolean).map((x, k) => {
        const [label, hex] = x.split(":").map((y) => y.trim());
        return { productId: p.id, type, label, hex: hex ?? "", sortOrder: k };
      });
      const variants = [...parseVariants(str(r.shades), "shade"), ...parseVariants(str(r.sizes), "size")];
      if (variants.length) { await db.productVariant.deleteMany({ where: { productId: p.id } }); await db.productVariant.createMany({ data: variants }); }
    } catch (e) { errors.push(`Row ${i + 2}: ${(e as Error).message}`); }
  }
  res.json({ created, updated, errors });
}));

app.use("/api/admin", admin);

// serve built web in production (single service like the other stores)
const WEB_DIST = path.resolve(process.cwd(), "..", "web", "dist");
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get("*", (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
}

app.listen(PORT, () => console.log(`TulipGlam API on http://localhost:${PORT}`));
