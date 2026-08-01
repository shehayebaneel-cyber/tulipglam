/**
 * Knowing what is happening on the store, without putting a tracker on it.
 *
 * ── NO THIRD PARTY, NO SCRIPT ON THE PUBLIC PAGE ───────────────────────────────────
 *
 * Everything here is measured server-side from data the store already has. No analytics
 * snippet, no session cookie, no per-visitor identifier, nothing loaded from another domain.
 * That is a deliberate constraint and it costs real capability — there is no bounce rate here,
 * no funnel, no idea what people looked at and did not buy. What it buys is a storefront that
 * ships nothing to anyone else and needs no cookie banner to be honest.
 *
 * ── ERRORS ARE GROUPED, NOT LOGGED ─────────────────────────────────────────────────
 *
 * A row per occurrence means one broken loop fills the table and hides everything else. A row
 * per FINGERPRINT — method, route shape and error name — means the dashboard shows five real
 * problems rather than four thousand symptoms, with a count against each.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

/**
 * Collapse a path so `/api/orders/TG-A1B2C3` and `/api/orders/TG-D4E5F6` are one problem.
 *
 * Without this, a route that throws for every order produces a new fingerprint per order and
 * the grouping does nothing at all.
 */
export function routeShape(path: string): string {
  return path
    .replace(/\/TG-[A-Z0-9]+/gi, "/:orderNumber")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    // Long opaque segments are ids of some kind — slugs, tokens, keys.
    .replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, "/:token")
    .slice(0, 200);
}

export function fingerprintOf(method: string, path: string, err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const first = err instanceof Error ? (err.message ?? "").slice(0, 120) : String(err).slice(0, 120);
  return createHash("sha256").update(`${method} ${routeShape(path)} ${name} ${first}`).digest("hex").slice(0, 32);
}

/**
 * Record that something broke.
 *
 * Never throws, and never awaits anything the request needs — an error logger that can itself
 * fail the request is worse than no error logger. Called from the express error handler, which
 * has already decided what to tell the customer.
 */
export async function recordError(
  db: PrismaClient,
  input: { method: string; path: string; status: number; err: unknown },
  now = new Date(),
): Promise<void> {
  try {
    const fingerprint = fingerprintOf(input.method, input.path, input.err);
    const message = (input.err instanceof Error ? input.err.message : String(input.err)).slice(0, 500);
    const stack = (input.err instanceof Error ? input.err.stack ?? "" : "").split("\n").slice(0, 6).join("\n").slice(0, 1500);

    await db.errorLog.upsert({
      where: { fingerprint },
      // A recurrence re-opens it: something that broke again after being marked resolved is
      // news, and leaving it resolved would hide it.
      update: { count: { increment: 1 }, lastSeen: now, resolvedAt: null, message, stack },
      create: {
        fingerprint, method: input.method, path: routeShape(input.path),
        status: input.status, message, stack, firstSeen: now, lastSeen: now,
      },
    });
  } catch (e) {
    console.error("[observe] could not record an error:", e instanceof Error ? e.message : e);
  }
}

/**
 * Request volume, counted in memory.
 *
 * Honest about what it is: a process-local counter that RESETS ON EVERY DEPLOY AND COLD START,
 * and on Render's free tier that is frequent. It answers "is anything happening right now",
 * not "how many visitors did we have in July". Storing a row per request would answer the
 * second question and cost a database write on every page view, which is the wrong trade for a
 * store this size.
 */
const traffic = { since: new Date(), pageViews: 0, apiCalls: 0, byPath: new Map<string, number>() };

export function countRequest(path: string): void {
  if (path.startsWith("/api/")) {
    traffic.apiCalls++;
    const shape = routeShape(path);
    traffic.byPath.set(shape, (traffic.byPath.get(shape) ?? 0) + 1);
  } else if (!path.includes(".")) {
    // A path with no extension is a page; /assets/x.js and /products/y.webp are not.
    traffic.pageViews++;
  }
}

export type Pulse = {
  ordersToday: number;
  ordersWeek: number;
  revenueTodayCents: number;
  signupsToday: number;
  signupsTotal: number;
  openErrors: number;
  newestError: { message: string; path: string; count: number; lastSeen: Date } | null;
  outboxWaiting: number;
  traffic: { since: Date; pageViews: number; apiCalls: number; topPaths: { path: string; hits: number }[] };
};

/**
 * The one call the dashboard makes.
 *
 * A single aggregate rather than six counts: Neon's free tier has a small connection ceiling
 * and a dashboard that fans out concurrent queries intermittently 500s — which is how the
 * launch-list panel failed earlier tonight.
 */
export async function pulse(db: PrismaClient, now = new Date()): Promise<Pulse> {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const rows = await db.$queryRaw<{
    orders_today: bigint; orders_week: bigint; revenue_today: bigint;
    signups_today: bigint; signups_total: bigint; open_errors: bigint; outbox_waiting: bigint;
  }[]>`
    SELECT
      (SELECT count(*) FROM "Order" WHERE "createdAt" >= ${midnight})                        AS orders_today,
      (SELECT count(*) FROM "Order" WHERE "createdAt" >= ${weekAgo})                         AS orders_week,
      (SELECT coalesce(sum("totalCents"),0) FROM "Order" WHERE "createdAt" >= ${midnight})   AS revenue_today,
      (SELECT count(*) FROM "LaunchSignup" WHERE "createdAt" >= ${midnight})                 AS signups_today,
      (SELECT count(*) FROM "LaunchSignup")                                                  AS signups_total,
      (SELECT count(*) FROM "ErrorLog" WHERE "resolvedAt" IS NULL)                           AS open_errors,
      (SELECT count(*) FROM "OutboxEmail" WHERE "sentAt" IS NULL AND "lastError" NOT LIKE 'expired:%') AS outbox_waiting`;

  const r = rows[0];
  const newest = await db.errorLog.findFirst({
    where: { resolvedAt: null }, orderBy: { lastSeen: "desc" },
    select: { message: true, path: true, count: true, lastSeen: true },
  });

  const topPaths = [...traffic.byPath.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([path, hits]) => ({ path, hits }));

  const n = (v: bigint) => Number(v);
  return {
    ordersToday: n(r.orders_today), ordersWeek: n(r.orders_week), revenueTodayCents: n(r.revenue_today),
    signupsToday: n(r.signups_today), signupsTotal: n(r.signups_total),
    openErrors: n(r.open_errors), newestError: newest,
    outboxWaiting: n(r.outbox_waiting),
    traffic: { since: traffic.since, pageViews: traffic.pageViews, apiCalls: traffic.apiCalls, topPaths },
  };
}

export async function recentErrors(db: PrismaClient, take = 30) {
  return db.errorLog.findMany({ orderBy: [{ resolvedAt: "asc" }, { lastSeen: "desc" }], take });
}

export async function resolveError(db: PrismaClient, id: number, now = new Date()) {
  return db.errorLog.updateMany({ where: { id }, data: { resolvedAt: now } as Prisma.ErrorLogUpdateManyMutationInput });
}
