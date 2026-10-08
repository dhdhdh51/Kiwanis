import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { logger } from '../lib/logger.js';

export type ActivityType =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.password_reset'
  | 'upload.started'
  | 'upload.resumed'
  | 'upload.completed'
  | 'upload.failed'
  | 'upload.aborted'
  | 'upload.expired'
  | 'video.deleted'
  | 'video.shared'
  | 'admin.user_updated'
  | 'admin.user_deleted'
  | 'admin.video_deleted';

/** Fire-and-forget audit log entry. Never throws into the request path. */
export function recordActivity(
  type: ActivityType,
  message: string,
  opts: { userId?: string | null; ip?: string | null; meta?: Prisma.InputJsonValue } = {},
) {
  prisma.activity
    .create({ data: { type, message, userId: opts.userId ?? null, ip: opts.ip ?? null, meta: opts.meta } })
    .catch((err) => logger.error({ err }, 'failed to record activity'));
}
