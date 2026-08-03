import type { PrismaClient } from "@prisma/client";
import { normaliseLebanesePhone } from "./loyalty/phone.js";

/**
 * "Can you get me…" — customers asking for what the shop does not carry.
 *
 * ── WHY THIS BELONGS IN THIS BUSINESS SPECIFICALLY ─────────────────────────────────
 *
 * The shop holds no inventory and sources every order after it is placed. So "we don't stock
 * that" is never the real answer — the real answer is "ask, and we'll see". Most shops cannot
 * offer that honestly. This one can, and had no way for anyone to take it up.
 *
 * It is also the cheapest demand research there is. Ten requests for one brand is a buying
 * decision the owner would otherwise never learn about, from people who have already proved
 * they want it.
 *
 * ── WHAT IT MUST NOT DO ────────────────────────────────────────────────────────────
 *
 * It must not promise. Not a price, not a date, not that the thing can be got at all — the
 * supplier relationships are three retail feeds and a phone, and this codebase has spent months
 * removing claims nothing backs. The copy says the shop will look and reply; that is a promise
 * about effort, which is keepable, rather than about outcome, which is not.
 */

export const MAX_WANTED = 200;
export const MAX_NOTE = 600;

export type NewRequest = {
  wanted: string;
  note: string;
  phone: string;
  email: string;
  source: string;
  searchTerm: string;
  customerId?: number | null;
};

/** Entry points, so the owner can see which one actually earns requests. */
const SOURCES = new Set(["page", "search", "404", "product"]);

/**
 * Validate a submission, returning a per-field message or null.
 *
 * Deliberately generous about WHAT is asked for — "that pink Huda lipstick from TikTok" is a
 * perfectly good request and no format check should reject it. Strict only about the two things
 * that make a request actionable: something to look for, and a way to reply.
 */
export function validateRequest(input: Partial<NewRequest>): Record<string, string> | null {
  const errors: Record<string, string> = {};

  const wanted = (input.wanted ?? "").trim();
  if (!wanted) errors.wanted = "Tell us what you're looking for.";
  else if (wanted.length < 2) errors.wanted = "A little more detail would help.";
  else if (wanted.length > MAX_WANTED) errors.wanted = `Please keep this under ${MAX_WANTED} characters.`;

  if ((input.note ?? "").length > MAX_NOTE) errors.note = `Please keep this under ${MAX_NOTE} characters.`;

  /**
   * `normaliseLebanesePhone` returns a RESULT OBJECT, not a string or null.
   *
   * Written first as `if (!normaliseLebanesePhone(phone))`, which is always false because an
   * object is always truthy — so every phone number would have validated, including empty
   * decoration and nonsense. The typechecker caught the sibling line where the result was
   * assigned to a string; it could not catch this one, because a truthiness test on an object
   * is perfectly legal and perfectly wrong.
   */
  const phone = (input.phone ?? "").trim();
  if (!phone) errors.phone = "We reply on WhatsApp, so we need a number.";
  else if (!normaliseLebanesePhone(phone).ok) errors.phone = "That doesn't look like a Lebanese number.";

  const email = (input.email ?? "").trim();
  // Optional, but if given it has to be plausible — a typo'd address is worse than none,
  // because it looks like a working reply channel and silently is not.
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) errors.email = "That email doesn't look right.";

  return Object.keys(errors).length ? errors : null;
}

/**
 * Store a request.
 *
 * The phone is normalised to E.164 where it parses, matching the loyalty programme, so the same
 * person's requests and orders can be recognised as the same person later without a second
 * matching rule that drifts from the first.
 */
export async function createRequest(db: PrismaClient, input: NewRequest) {
  // Stored E.164 when it parses; otherwise the raw input, because a request the owner can still
  // read and act on beats one rejected at the door over a formatting disagreement.
  const parsed = normaliseLebanesePhone(input.phone);
  const phone = parsed.ok ? parsed.e164 : input.phone.trim();

  return db.productRequest.create({
    data: {
      wanted: input.wanted.trim().slice(0, MAX_WANTED),
      note: (input.note ?? "").trim().slice(0, MAX_NOTE),
      phone,
      email: (input.email ?? "").trim().toLowerCase(),
      customerId: input.customerId ?? null,
      source: SOURCES.has(input.source) ? input.source : "page",
      // Capped hard: this is a URL parameter reflected into storage, and there is no reason a
      // real search term runs long.
      searchTerm: (input.searchTerm ?? "").trim().slice(0, 120),
    },
    select: { id: true },
  });
}

export type RequestSummary = {
  open: number;
  sourced: number;
  declined: number;
  /** Age of the oldest open request, in days. Null when nothing is waiting. */
  oldestOpenDays: number | null;
  /** What people ask for most, so a pattern is visible without reading every row. */
  topTerms: { term: string; count: number }[];
};

/**
 * The operator view.
 *
 * `topTerms` groups the FIRST TWO WORDS of what was asked for, lowercased. Crude on purpose:
 * "Huda Beauty lip liner" and "huda beauty setting powder" should read as one signal about a
 * brand, and anything cleverer here would be a search engine pretending to be a report.
 */
export async function requestSummary(db: PrismaClient): Promise<RequestSummary> {
  const [open, sourced, declined, oldest, recent] = await Promise.all([
    db.productRequest.count({ where: { status: "open" } }),
    db.productRequest.count({ where: { status: "sourced" } }),
    db.productRequest.count({ where: { status: "declined" } }),
    db.productRequest.findFirst({ where: { status: "open" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.productRequest.findMany({ select: { wanted: true }, orderBy: { createdAt: "desc" }, take: 500 }),
  ]);

  const counts = new Map<string, number>();
  for (const r of recent) {
    const key = r.wanted.toLowerCase().split(/\s+/).slice(0, 2).join(" ").replace(/[^a-z0-9 ]/g, "").trim();
    if (key.length < 3) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    open, sourced, declined,
    oldestOpenDays: oldest ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 86_400_000) : null,
    topTerms: [...counts.entries()]
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([term, count]) => ({ term, count })),
  };
}
