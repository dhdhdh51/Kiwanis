import { prisma } from '../db.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { storage } from '../storage/index.js';
import { recordActivity } from './activity.js';
import { purgeVideo } from './videos.js';

/**
 * Periodic housekeeping:
 *  - abort abandoned multipart uploads (frees storage + quota reservations)
 *  - purge videos that have been in the trash longer than the retention period
 *  - remove expired sessions and password-reset tokens
 */
export async function runMaintenance() {
  const staleBefore = new Date(Date.now() - config.upload.sessionTtlMs);
  const stale = await prisma.uploadSession.findMany({
    where: { status: 'ACTIVE', updatedAt: { lt: staleBefore } },
    include: { video: { select: { id: true, storageKey: true, filename: true } } },
    take: 500,
  });
  for (const s of stale) {
    try {
      await storage.abortMultipartUpload(s.video.storageKey, s.storageUploadId);
      await prisma.$transaction([
        prisma.uploadSession.update({ where: { id: s.id }, data: { status: 'EXPIRED', error: 'Upload abandoned' } }),
        prisma.video.update({ where: { id: s.video.id }, data: { status: 'FAILED', processingError: 'Upload abandoned' } }),
      ]);
      recordActivity('upload.expired', `Upload of "${s.video.filename}" expired`, { userId: s.userId });
    } catch (err) {
      logger.warn({ err, uploadId: s.id }, 'failed to expire upload session');
    }
  }

  // Failed placeholders are not useful to keep around for long.
  const failed = await prisma.video.findMany({
    where: { status: 'FAILED', updatedAt: { lt: new Date(Date.now() - 7 * 86400_000) } },
    select: { id: true },
    take: 500,
  });
  for (const v of failed) await purgeVideo(v.id).catch((err) => logger.warn({ err }, 'purge failed video'));

  const trashBefore = new Date(Date.now() - config.upload.trashRetentionMs);
  const trashed = await prisma.video.findMany({ where: { deletedAt: { lt: trashBefore } }, select: { id: true }, take: 500 });
  for (const v of trashed) await purgeVideo(v.id).catch((err) => logger.warn({ err }, 'purge trashed video'));

  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  if (stale.length || trashed.length || failed.length) {
    logger.info({ expiredUploads: stale.length, purgedTrash: trashed.length, purgedFailed: failed.length }, 'maintenance run');
  }
}

export function startMaintenance(intervalMs = 15 * 60_000) {
  const tick = () => runMaintenance().catch((err) => logger.error({ err }, 'maintenance failed'));
  setTimeout(tick, 10_000);
  return setInterval(tick, intervalMs).unref();
}
