import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type express from "express";

const SECRET = process.env.JWT_SECRET || process.env.ADMIN_KEY || "tulip-dev-secret";

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
