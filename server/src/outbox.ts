/**
 * The email outbox — built to work the day credentials arrive, and to lose nothing before then.
 *
 * ── THE PROBLEM ────────────────────────────────────────────────────────────────────
 *
 * `sendMail` used to log `[mail:not-configured]` and return false. Graceful, and lossy: with
 * SMTP unconfigured, every order confirmation and status update the store has ever intended to
 * send is gone. Nobody notices, because nobody was expecting mail.
 *
 * It stops being invisible the moment credentials are pasted in — at which point the store
 * starts mailing from that instant and everything before it stays lost.
 *
 * ── SO EVERY MESSAGE IS RECORDED, AND SOME ARE ALLOWED TO GO STALE ─────────────────
 *
 * Queue-and-flush is the obvious design and it is half right. The half that is wrong is
 * flushing EVERYTHING: an order confirmation delivered three weeks after the parcel reads as a
 * system that has just woken up, and a password reset arriving after its token expired is worse
 * than silence. So each kind carries its own shelf life, and the flush skips anything past it.
 *
 * The launch announcement is the exception with no expiry — it is explicitly a message waiting
 * for a date that has not been set.
 */
import type { PrismaClient } from "@prisma/client";
import { sendMail, mailConfigured, type MailSettings } from "./mailer.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * How long each kind of message is still worth sending.
 *
 * These are judgements about what a customer would rather receive, not technical limits:
 *
 *   password-reset      30 min — matches the token's own life. Later is meaningless.
 *   order-confirmation   3 days — after that the parcel has arrived and it is noise.
 *   status-update        2 days — a "dispatched" email about a delivered order is confusing.
 *   points-confirmed    14 days — pleasant news, and it ages slowly.
 *   welcome             30 days — a late welcome is odd but harmless.
 *   launch                never — it is waiting for a decision, not for a delivery.
 */
const SHELF_LIFE: Record<string, number | null> = {
  "password-reset": 30 * MINUTE,
  "order-confirmation": 3 * DAY,
  "status-update": 2 * DAY,
  "points-confirmed": 14 * DAY,
  welcome: 30 * DAY,
  launch: null,
};

export type QueueInput = {
  to: string;
  subject: string;
  html: string;
  kind: keyof typeof SHELF_LIFE | string;
  /** Optional idempotency key, so a retried request queues one message rather than two. */
  dedupeKey?: string;
};

/**
 * Record a message, and send it now if that is possible.
 *
 * ALWAYS writes a row, even on a successful immediate send — the outbox doubles as the record
 * of what the store has actually told a customer, which is the first thing you want when
 * somebody says "I never got an email".
 *
 * Never throws. A mail failure must not take down the thing that triggered it: the same rule
 * the loyalty hooks follow, for the same reason.
 */
export async function queueMail(
  db: PrismaClient,
  settings: MailSettings,
  input: QueueInput,
  now = new Date(),
): Promise<{ queued: boolean; sent: boolean }> {
  if (!input.to) return { queued: false, sent: false };

  /**
   * `in`, not `??`.
   *
   * `SHELF_LIFE[kind] ?? 7 * DAY` reads correctly and is wrong: `??` treats null as absent, so
   * the one kind deliberately set to null — the launch announcement, the single message that
   * must wait indefinitely — silently got a seven-day shelf life and would have expired
   * unsent before the store ever opened. Presence and value have to be asked separately.
   */
  const life = Object.prototype.hasOwnProperty.call(SHELF_LIFE, input.kind) ? SHELF_LIFE[input.kind] : 7 * DAY;
  const expiresAt = life === null ? null : new Date(now.getTime() + life);

  let row;
  try {
    row = await db.outboxEmail.create({
      data: {
        to: input.to, subject: input.subject, html: input.html,
        kind: input.kind, expiresAt, dedupeKey: input.dedupeKey ?? null,
      },
    });
  } catch {
    // Already queued by an earlier attempt at the same thing. That is the outcome we wanted.
    return { queued: true, sent: false };
  }

  if (!mailConfigured(settings)) return { queued: true, sent: false };

  try {
    const ok = await sendMail(settings, input.to, input.subject, input.html);
    if (ok) {
      await db.outboxEmail.update({ where: { id: row.id }, data: { sentAt: now, attempts: 1 } });
      return { queued: true, sent: true };
    }
    await db.outboxEmail.update({ where: { id: row.id }, data: { attempts: 1, lastError: "transport returned false" } });
  } catch (e) {
    await db.outboxEmail.update({
      where: { id: row.id },
      data: { attempts: 1, lastError: (e instanceof Error ? e.message : String(e)).slice(0, 400) },
    });
  }
  return { queued: true, sent: false };
}

export type FlushReport = {
  configured: boolean;
  sent: number;
  failed: number;
  expired: number;
  remaining: number;
};

/**
 * Send what is waiting.
 *
 * Bounded per call, and expiry is applied as a WRITE — a stale message is marked so it stops
 * being reconsidered on every flush forever. Marking it `sentAt` would be a lie; it gets an
 * explicit `lastError` instead, so the reason it never went is visible in admin.
 *
 * Safe to call repeatedly. Safe to call when SMTP is unconfigured — it does nothing and says so.
 */
export async function flushOutbox(
  db: PrismaClient,
  settings: MailSettings,
  limit = 50,
  now = new Date(),
): Promise<FlushReport> {
  const configured = mailConfigured(settings);
  const remainingOf = () => db.outboxEmail.count({ where: { sentAt: null, lastError: { not: { startsWith: "expired:" } } } });

  if (!configured) {
    return { configured: false, sent: 0, failed: 0, expired: 0, remaining: await remainingOf() };
  }

  // Retire the stale ones first, so they never consume a send slot.
  const stale = await db.outboxEmail.updateMany({
    where: { sentAt: null, expiresAt: { not: null, lt: now }, lastError: { not: { startsWith: "expired:" } } },
    data: { lastError: `expired: not worth sending after ${now.toISOString()}` },
  });

  const pending = await db.outboxEmail.findMany({
    where: {
      sentAt: null,
      lastError: { not: { startsWith: "expired:" } },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let sent = 0, failed = 0;
  for (const m of pending) {
    try {
      const ok = await sendMail(settings, m.to, m.subject, m.html);
      if (ok) {
        await db.outboxEmail.update({ where: { id: m.id }, data: { sentAt: new Date(), attempts: { increment: 1 } } });
        sent++;
      } else {
        await db.outboxEmail.update({ where: { id: m.id }, data: { attempts: { increment: 1 }, lastError: "transport returned false" } });
        failed++;
      }
    } catch (e) {
      await db.outboxEmail.update({
        where: { id: m.id },
        data: { attempts: { increment: 1 }, lastError: (e instanceof Error ? e.message : String(e)).slice(0, 400) },
      });
      failed++;
    }
  }

  return { configured: true, sent, failed, expired: stale.count, remaining: await remainingOf() };
}

export type OutboxStatus = {
  configured: boolean;
  waiting: number;
  sent: number;
  expired: number;
  failed: number;
  byKind: { kind: string; waiting: number }[];
  oldestWaiting: Date | null;
};

/** What is sitting in the outbox, for the admin dashboard. */
export async function outboxStatus(db: PrismaClient, settings: MailSettings): Promise<OutboxStatus> {
  const [waiting, sent, expired, failed, byKind, oldest] = await Promise.all([
    db.outboxEmail.count({ where: { sentAt: null, lastError: { not: { startsWith: "expired:" } } } }),
    db.outboxEmail.count({ where: { sentAt: { not: null } } }),
    db.outboxEmail.count({ where: { lastError: { startsWith: "expired:" } } }),
    db.outboxEmail.count({ where: { sentAt: null, attempts: { gt: 0 }, lastError: { not: { startsWith: "expired:" } } } }),
    db.outboxEmail.groupBy({
      by: ["kind"],
      where: { sentAt: null, lastError: { not: { startsWith: "expired:" } } },
      _count: { _all: true },
    }),
    db.outboxEmail.findFirst({ where: { sentAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  return {
    configured: mailConfigured(settings),
    waiting, sent, expired, failed,
    byKind: byKind.map((k) => ({ kind: k.kind, waiting: k._count._all })),
    oldestWaiting: oldest?.createdAt ?? null,
  };
}
