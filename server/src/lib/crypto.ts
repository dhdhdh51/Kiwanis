import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { config } from '../config.js';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

// Argon2id with OWASP-recommended parameters.
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON_OPTS);

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Pre-computed hash used to keep login timing constant when the user does not exist.
let dummyHash: Promise<string> | undefined;
export const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

function hmac(data: string) {
  return crypto.createHmac('sha256', config.secret).update(data).digest('base64url');
}

/**
 * Compact signed token: base64url(JSON payload) + "." + HMAC-SHA256.
 * Used for local-storage presigned URLs and share-link access grants.
 */
export function signToken(payload: Record<string, unknown>, purpose: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(`${purpose}:${body}`)}`;
}

export function verifyToken<T extends { exp: number }>(token: string | undefined, purpose: string): T | null {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = hmac(`${purpose}:${body}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Expiry rounded up to a time bucket so repeated signing of the same object yields the same URL,
 * which lets browsers cache thumbnails between list refreshes.
 */
export function bucketedExpiry(minSeconds: number, bucketSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  return Math.ceil((now + minSeconds) / bucketSeconds) * bucketSeconds;
}
