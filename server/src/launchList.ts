/**
 * The launch list: people who left an email on the coming-soon page.
 *
 * ── WHY THIS IS NOT A CUSTOMER ─────────────────────────────────────────────────────
 *
 * They have no account, no password and no orders. Putting them in `Customer` would fill that
 * table with half-people and quietly break every count that reads it — "customers" on the admin
 * dashboard would start meaning "customers plus strangers who typed an address once".
 *
 * ── AND WHY IT ANSWERS THE SAME EITHER WAY ─────────────────────────────────────────
 *
 * A signup endpoint that says "you're already on the list" is an oracle: anyone with a list of
 * addresses can test which ones belong to your customers. This is the third time that pattern
 * has come up in this codebase — `/api/auth/forgot` and registration were the others — so it is
 * handled the same way here: identical response whether the row was created or already existed.
 */
import type { PrismaClient } from "@prisma/client";

/**
 * Is this plausibly a deliverable address?
 *
 * Deliberately permissive. The only thing that truly validates an address is sending to it, and
 * over-strict regexes reject real addresses — plus signs, subdomains, long TLDs, unicode. This
 * rejects what is obviously not an address and lets the rest through; a bad one costs a bounce,
 * a wrongly-rejected one costs a customer.
 */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (/\s/.test(email)) return null;
  // exactly one @, something before it, and a dotted domain after it
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return null;
  const domain = email.slice(at + 1);
  if (domain.length < 4 || !domain.includes(".")) return null;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return null;
  return email;
}

export type SignupResult = { stored: boolean; alreadyThere: boolean };

/**
 * Record an address. Idempotent, and safe to call from an unauthenticated endpoint.
 *
 * An address that unsubscribed and signs up again is RE-SUBSCRIBED — they asked twice, and the
 * second ask is the more recent instruction. `notifiedAt` is left alone, so re-subscribing does
 * not re-send an announcement they already had.
 */
export async function recordSignup(
  db: PrismaClient,
  input: { email: string; source?: string },
): Promise<SignupResult> {
  const email = normaliseEmail(input.email);
  if (!email) return { stored: false, alreadyThere: false };

  const existing = await db.launchSignup.findUnique({ where: { email } });
  if (existing) {
    if (existing.unsubscribedAt) {
      await db.launchSignup.update({ where: { email }, data: { unsubscribedAt: null } });
    }
    return { stored: true, alreadyThere: true };
  }

  try {
    await db.launchSignup.create({
      data: { email, source: (input.source ?? "coming-soon").slice(0, 40) },
    });
    return { stored: true, alreadyThere: false };
  } catch {
    // Lost a race against another request with the same address. The outcome the caller wanted
    // — this address is on the list — is true either way.
    return { stored: true, alreadyThere: true };
  }
}

export type LaunchListStats = {
  total: number;
  subscribed: number;
  unsubscribed: number;
  notified: number;
  today: number;
  last7: number;
  /** Newest first, for the admin table. */
  recent: { id: number; email: string; source: string; createdAt: Date; notifiedAt: Date | null; unsubscribedAt: Date | null }[];
};

/**
 * Every count in ONE round trip, plus one for the rows.
 *
 * This was six concurrent queries in a `Promise.all`, and it intermittently 500'd: Neon's free
 * tier has a small connection ceiling, and six at once from a cold pool is enough to trip it.
 * Six round trips is also just slow when the database is in us-east-2 and the reader is in
 * Beirut — a dashboard should not cost six transatlantic hops to draw five numbers.
 *
 * `FILTER (WHERE …)` does the whole thing in one aggregate scan.
 */
export async function launchListStats(db: PrismaClient, take = 200, now = new Date()): Promise<LaunchListStats> {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [counts, recent] = await Promise.all([
    db.$queryRaw<{ total: bigint; unsubscribed: bigint; notified: bigint; today: bigint; last7: bigint }[]>`
      SELECT
        count(*)                                                        AS total,
        count(*) FILTER (WHERE "unsubscribedAt" IS NOT NULL)            AS unsubscribed,
        count(*) FILTER (WHERE "notifiedAt"     IS NOT NULL)            AS notified,
        count(*) FILTER (WHERE "createdAt"      >= ${midnight})         AS today,
        count(*) FILTER (WHERE "createdAt"      >= ${weekAgo})          AS last7
      FROM "LaunchSignup"`,
    db.launchSignup.findMany({ orderBy: { createdAt: "desc" }, take }),
  ]);

  // count() comes back as bigint, which JSON.stringify refuses to serialise — an unconverted
  // one would throw at res.json() rather than here, where the cause is obvious.
  const c = counts[0] ?? { total: 0n, unsubscribed: 0n, notified: 0n, today: 0n, last7: 0n };
  const n = (v: bigint | number) => Number(v);

  return {
    total: n(c.total),
    subscribed: n(c.total) - n(c.unsubscribed),
    unsubscribed: n(c.unsubscribed),
    notified: n(c.notified),
    today: n(c.today),
    last7: n(c.last7),
    recent,
  };
}

/**
 * The whole list as CSV.
 *
 * Quoted and escaped properly, because an address is user-supplied text and a naive join turns
 * `a"b@c.com` into a broken file — or worse, a formula. Leading `=`, `+`, `-` and `@` are
 * prefixed with a quote so a spreadsheet treats them as text rather than executing them; that is
 * CSV injection, and the payload here would be an address somebody typed into a public form.
 */
export async function launchListCsv(db: PrismaClient): Promise<string> {
  const rows = await db.launchSignup.findMany({ orderBy: { createdAt: "asc" } });
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = ["email", "source", "signed_up", "notified", "unsubscribed"].join(",");
  const body = rows.map((r) =>
    [
      cell(r.email),
      cell(r.source),
      cell(r.createdAt.toISOString()),
      cell(r.notifiedAt?.toISOString() ?? ""),
      cell(r.unsubscribedAt?.toISOString() ?? ""),
    ].join(","),
  );
  // CRLF and a UTF-8 BOM: Excel on Windows is the likeliest destination and it misreads a
  // plain UTF-8 file as Latin-1, which mangles any non-ASCII address.
  return "﻿" + [header, ...body].join("\r\n") + "\r\n";
}
