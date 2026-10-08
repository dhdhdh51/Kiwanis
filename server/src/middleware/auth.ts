import type { NextFunction, Request, Response } from 'express';
import type { Role, User } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { forbidden, HttpError, unauthorized } from '../lib/errors.js';

export type AuthUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'status' | 'storageLimit' | 'createdAt'>;

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    sessionId?: string;
  }
}

const TOUCH_INTERVAL_MS = 5 * 60_000;

export function setSessionCookie(res: Response, token: string) {
  res.cookie(config.session.cookieName, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: config.session.ttlMs,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(config.session.cookieName, { path: '/', httpOnly: true, secure: config.isProd, sameSite: 'lax' });
}

/** Creates a server-side session. Only the SHA-256 of the token is stored. */
export async function createSession(req: Request, res: Response, userId: string) {
  const token = randomToken(32);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      userAgent: req.get('user-agent')?.slice(0, 300),
      ip: req.ip,
      expiresAt: new Date(Date.now() + config.session.ttlMs),
    },
  });
  setSessionCookie(res, token);
}

/** Loads the user from the session cookie, if any. Never rejects the request. */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[config.session.cookieName] as string | undefined;
  if (!token) return next();
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: { select: { id: true, email: true, name: true, role: true, status: true, storageLimit: true, createdAt: true } },
    },
  });
  if (!session || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') return next();
  req.user = session.user;
  req.sessionId = session.id;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    // Sliding expiration
    prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + config.session.ttlMs) } })
      .catch(() => undefined);
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role !== role) return next(forbidden('Administrator access required'));
    next();
  };
}

/**
 * CSRF defence for cookie-authenticated, state-changing requests:
 * requires a custom header (which cross-site forms cannot send without a CORS preflight that we never allow)
 * and, when present, an Origin matching the app.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== config.appOrigin && origin !== `${req.protocol}://${req.get('host')}`) {
    return next(new HttpError(403, 'FORBIDDEN', 'Cross-origin request blocked'));
  }
  if (req.get('x-requested-with') !== 'VidVault') {
    return next(new HttpError(403, 'FORBIDDEN', 'Missing anti-CSRF header'));
  }
  next();
}
