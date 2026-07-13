// Auth utilities: PIN hashing, session tokens, rate limiting, bearer middleware.
// See docs/09. Identity is display-name + bcrypt PIN; sessions are random
// tokens stored only as sha256.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { getSessionUser, touchSession } from './repo.js';

// Attach the authenticated user id to the request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const BCRYPT_COST = 10;

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_COST);
}
export function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

/** PIN policy: 4-6 digits. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin);
}
/** Display name: 1-40 non-blank chars. */
export function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 40;
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}
/** New session token: the raw token (returned once) + its sha256 (stored). */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256(token) };
}

// ── Rate limiter: in-memory fixed window keyed by lower(displayName) ──────────
// Keyed by name, not IP, because behind a reverse proxy/tunnel every remote
// player shares the proxy's IP. Restart clearing counters is acceptable.
const WINDOW_MS = 60_000;
const MAX_FAILS = 5;
const fails = new Map<string, { count: number; resetAt: number }>();

export function rateLimited(name: string): boolean {
  const e = fails.get(name.toLowerCase());
  if (!e) return false;
  if (Date.now() > e.resetAt) {
    fails.delete(name.toLowerCase());
    return false;
  }
  return e.count >= MAX_FAILS;
}
export function recordFailure(name: string): void {
  const key = name.toLowerCase();
  const now = Date.now();
  const e = fails.get(key);
  if (!e || now > e.resetAt) {
    fails.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    e.count += 1;
  }
}
export function clearFailures(name: string): void {
  fails.delete(name.toLowerCase());
}

function bearerToken(req: Request): string | undefined {
  const h = req.header('authorization');
  return h && h.startsWith('Bearer ') ? h.slice(7) : undefined;
}

/** Express middleware: require a valid bearer session; sets req.userId. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = bearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const tokenHash = sha256(token);
    const user = await getSessionUser(tokenHash);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.userId = user.id;
    void touchSession(tokenHash);
    next();
  } catch (err) {
    next(err as Error);
  }
}

export { bearerToken };
