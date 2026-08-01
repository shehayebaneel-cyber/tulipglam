import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type express from "express";

/**
 * The signing secret for every customer session.
 *
 * It used to fall back to ADMIN_KEY and then to the literal "tulip-dev-secret". Both fallbacks
 * were silent, and the consequences are not small: every ownership guarantee in this codebase —
 * whose orders you can read, whose loyalty account `/api/loyalty/me` returns — reduces to "the
 * bearer token was signed with this value". Anyone who knows the constant can mint a token for
 * customer id 1 and be them.
 *
 * Chaining to ADMIN_KEY was worse than the constant, not better: it welds two unrelated
 * privileges together, so leaking either one gives you both, and rotating the admin key silently
 * signs out every customer on the site.
 *
 * So there is no default. `assertAuthConfig()` refuses to boot without a real one.
 */
const SECRET = (process.env.JWT_SECRET ?? "").trim();

/** A signing secret short enough to brute-force is not a secret. */
const MIN_SECRET_LENGTH = 24;

/**
 * Refuse to start rather than sign sessions with a guessable key.
 *
 * Unconditional, unlike the coming-soon and loyalty guards. Those protect a feature that is off
 * by default, so enforcing them always would take production down over something switched off.
 * This one protects authentication itself, which is never off — there is no state of this
 * application where a weak JWT secret is acceptable.
 */
export function assertAuthConfig(): void {
  const fail = (lines: string[]): never => {
    console.error(["", "FATAL: authentication is not safe to run.", "", ...lines, "", "  Refusing to start.", ""].join("\n"));
    process.exit(1);
  };

  if (!SECRET) {
    fail([
      "  JWT_SECRET is not set.",
      "",
      "  It used to fall back to ADMIN_KEY and then to a constant committed to this repo.",
      "  Every customer session — and every ownership check that rests on one — was signed",
      "  with whichever of those was in play.",
      "",
      "  Generate one with:",
      '    node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    ]);
  }
  if (SECRET.length < MIN_SECRET_LENGTH) {
    fail([`  JWT_SECRET is ${SECRET.length} characters; the minimum is ${MIN_SECRET_LENGTH}.`]);
  }
  if (process.env.ADMIN_KEY && SECRET === process.env.ADMIN_KEY.trim()) {
    fail([
      "  JWT_SECRET is the same value as ADMIN_KEY.",
      "  Leaking either would then give away both, and rotating the admin key would sign out",
      "  every customer on the site. They must be different values.",
    ]);
  }
  if (SECRET === "tulip-dev-secret") {
    fail(["  JWT_SECRET is the old hardcoded development value, which is public in this repository."]);
  }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
export const signToken = (customerId: number) => jwt.sign({ id: customerId }, SECRET, { expiresIn: "60d" });

export function verifyToken(token: string): number | null {
  try { const p = jwt.verify(token, SECRET) as { id: number }; return p.id; } catch { return null; }
}

// Attaches req.customerId if a valid bearer token is present (optional auth).
export function withCustomer(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const h = req.header("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const id = token ? verifyToken(token) : null;
  (req as express.Request & { customerId?: number }).customerId = id ?? undefined;
  next();
}

// Requires a valid customer token.
export function requireCustomer(req: express.Request, res: express.Response, next: express.NextFunction) {
  const h = req.header("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const id = token ? verifyToken(token) : null;
  if (!id) return res.status(401).json({ error: "Please sign in." });
  (req as express.Request & { customerId?: number }).customerId = id;
  next();
}
