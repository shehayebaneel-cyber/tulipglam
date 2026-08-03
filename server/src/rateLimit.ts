/**
 * A shared per-IP rate limiter for the endpoints where guessing is the attack.
 *
 * Registration guessing, login stuffing and reset-token guessing are one attack wearing three
 * coats, so they get one limiter rather than three bespoke ones that would drift apart.
 *
 * ── WHAT IT IS FOR, AND WHAT IT IS NOT FOR ─────────────────────────────────────────
 *
 * It stops thousands-per-minute enumeration. It is NOT trying to stop a determined attacker with
 * a botnet, and it is emphatically not trying to stop a human who mistyped their password twice.
 * The registration endpoint still tells you, by its status code, whether an address is already
 * registered — closing that needs an email channel and SMTP is unconfigured. This limiter is the
 * accepted mitigation for that residual oracle: at a throttled rate, enumerating a customer list
 * stops being a script and becomes an afternoon.
 *
 * ── WHY THE WINDOWS ARE SO GENEROUS ────────────────────────────────────────────────
 *
 * Lebanese mobile networks sit behind carrier-grade NAT. One public IP is routinely hundreds of
 * real people — a café, an office, an apartment block on the same tower. A five-attempts-per-IP
 * login limit, the kind every tutorial suggests, would lock out everyone sharing that address
 * because one of them fat-fingered a password. The limits below are set where a human never
 * reaches them and a script reaches them in seconds.
 *
 * ── IN MEMORY, AND HONEST ABOUT IT ─────────────────────────────────────────────────
 *
 * A Map in one process. That is correct for a single Render instance and would be wrong the day
 * this runs on two — there is no shared store, so each instance would count separately.
 *
 * IT ALSO RESETS ON EVERY DEPLOY AND EVERY COLD START. Render's free tier spins the service down
 * when idle, so on this tier the window is not durable and an attacker who waits out a spin-down
 * gets a fresh allowance. That is a real limitation, not a detail: it is another reason the
 * limits are about stopping bulk automation rather than about being a security boundary.
 *
 * ── AND IT FAILS OPEN ──────────────────────────────────────────────────────────────
 *
 * If anything in here throws, the request proceeds. Same rule as the loyalty hooks, for a
 * sharper reason: an authentication outage caused by the thing protecting authentication is the
 * worst trade on offer. Losing the limiter costs us a window of enumeration; losing login costs
 * us the store.
 */
import type express from "express";

type Bucket = { count: number; resetAt: number };

/** One map for every limit, keyed by `${name}:${ip}`. */
const buckets = new Map<string, Bucket>();

/**
 * Drop expired buckets so a long-running process does not accumulate one entry per IP forever.
 *
 * Swept opportunistically on write rather than on a timer: a timer would keep the event loop
 * alive and there is nothing here worth holding a process open for. The threshold means the
 * sweep is rare even under load.
 */
const SWEEP_AT = 5000;
function sweep(now: number) {
  if (buckets.size < SWEEP_AT) return;
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}

/**
 * The client address to count against.
 *
 * `req.ip` is correct ONLY with `trust proxy` configured, which index.ts sets to 1 — exactly one
 * hop, so Express reads the entry Render's proxy appended rather than the leftmost value in
 * `X-Forwarded-For`, which the client controls and could otherwise rotate to get a fresh bucket
 * on every request. Falling back to the socket address keeps this working in local dev, where
 * there is no proxy at all.
 */
function clientKey(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export type LimitOptions = {
  /** Namespace, so login attempts do not consume the registration allowance. */
  name: string;
  /** Requests permitted per window, per IP. */
  max: number;
  windowMs: number;
};

/** Fifteen minutes. Long enough to be a real deterrent, short enough that a lockout ends. */
export const WINDOW = 15 * 60 * 1000;

/**
 * Limits, in one place so they can be read side by side.
 *
 * Sized for carrier-grade NAT: a shared address should never reach these honestly. `passwordReset`
 * is deliberately tighter — legitimate use is rare, and it is the endpoint where guessing pays
 * best, since a correct token is a full account takeover rather than one bit of information.
 */
export const LIMITS = {
  register: { name: "register", max: 30, windowMs: WINDOW },
  login: { name: "login", max: 60, windowMs: WINDOW },
  passwordReset: { name: "password-reset", max: 15, windowMs: WINDOW },
  /**
   * The coming-soon email capture. Tighter than registration because a legitimate visitor
   * submits once — but still well clear of a shared carrier address, where a genuinely popular
   * launch could see a handful of real people on one IP.
   */
  launchSignup: { name: "launch-signup", max: 20, windowMs: WINDOW },
  /**
   * Product requests. A real customer sends one, occasionally two. Kept at the same order as
   * the signup capture rather than tighter, because Lebanese mobile traffic is CGNAT-heavy and
   * a shared egress IP can legitimately carry several genuine people.
   */
  productRequest: { name: "product-request", max: 20, windowMs: WINDOW },
} as const;

/**
 * Express middleware enforcing one limit.
 *
 * On refusal: 429 with `Retry-After` in seconds, so a well-behaved client knows when to come
 * back rather than hammering. The message never says whether the thing being guessed exists.
 */
export function rateLimit(options: LimitOptions): express.RequestHandler {
  return (req, res, next) => {
    try {
      const now = Date.now();
      const key = `${options.name}:${clientKey(req)}`;
      const bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        sweep(now);
        buckets.set(key, { count: 1, resetAt: now + options.windowMs });
        return next();
      }

      bucket.count++;
      if (bucket.count <= options.max) return next();

      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      // no-store so an intermediary cannot serve this refusal to somebody else on the same
      // carrier-grade address, which is the whole population sharing that IP.
      res.setHeader("Cache-Control", "no-store");
      return res.status(429).json({
        error: "Too many attempts from this connection. Please wait a few minutes and try again.",
      });
    } catch (e) {
      // FAIL OPEN. See the header note: an auth outage caused by the limiter protecting auth is
      // strictly worse than the enumeration window it was guarding.
      console.error("[rateLimit] failed open:", e instanceof Error ? e.message : e);
      return next();
    }
  };
}

/** Exported for tests, which need a clean slate between cases. */
export function _resetAllBuckets(): void {
  buckets.clear();
}
