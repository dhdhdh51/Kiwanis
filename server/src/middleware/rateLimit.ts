import { rateLimit, ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request } from 'express';

/**
 * In-memory rate limiting. For multi-instance deployments plug a shared store
 * (e.g. `rate-limit-redis`) into `store` so limits apply cluster-wide.
 */
function limiter(windowMs: number, limit: number, keyBy: 'ip' | 'user' = 'ip', extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req: Request) => (keyBy === 'user' && req.user ? `u:${req.user.id}` : ipKeyGenerator(req.ip ?? '')),
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests — please slow down and try again shortly.' } });
    },
    ...extra,
  });
}

export const limits = {
  /** Whole API, per user (or IP when anonymous) */
  api: limiter(60_000, 1200, 'user'),
  login: limiter(15 * 60_000, 20, 'ip', { skipSuccessfulRequests: true }),
  register: limiter(60 * 60_000, 10),
  passwordReset: limiter(15 * 60_000, 5),
  /** Creating upload sessions */
  uploadCreate: limiter(60_000, 300, 'user'),
  /** Presign / progress calls during uploads (many per file) */
  uploadOps: limiter(60_000, 3000, 'user'),
  /** Public share pages */
  publicShare: limiter(60_000, 120),
  sharePassword: limiter(15 * 60_000, 10),
  /** Stream/poster redirects used by <video>/<img> tags on other websites */
  publicMedia: limiter(60_000, 1200),
};
