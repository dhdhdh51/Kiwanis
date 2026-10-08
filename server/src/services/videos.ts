import type { Folder, Prisma, Rendition, ShareLink, Video } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { formatFor } from '../lib/formats.js';
import { logger } from '../lib/logger.js';
import { storage } from '../storage/index.js';

type Tx = Prisma.TransactionClient | typeof prisma;

/** Bytes counted against a user's quota: everything except failed uploads (trash still counts). */
export async function getUsedBytes(userId: string, tx: Tx = prisma): Promise<bigint> {
  const agg = await tx.video.aggregate({ where: { userId, status: { not: 'FAILED' } }, _sum: { size: true } });
  return agg._sum.size ?? 0n;
}

export function shareUrl(token: string) {
  return `${config.appUrl}/s/${token}`;
}

export function shareIsActive(share: Pick<ShareLink, 'isPublic' | 'expiresAt'> | null | undefined) {
  return !!share && share.isPublic && (!share.expiresAt || share.expiresAt > new Date());
}

export function serializeShare(share: ShareLink | null | undefined) {
  if (!share) return null;
  return {
    token: share.token,
    url: shareUrl(share.token),
    isPublic: share.isPublic,
    hasPassword: !!share.passwordHash,
    expiresAt: share.expiresAt,
    allowDownload: share.allowDownload,
    views: share.views,
    active: shareIsActive(share),
    expired: !!share.expiresAt && share.expiresAt <= new Date(),
    createdAt: share.createdAt,
  };
}

export async function thumbnailUrl(v: Pick<Video, 'thumbnailKey'>) {
  if (!v.thumbnailKey) return null;
  return storage.signedGetUrl(v.thumbnailKey, { expiresIn: 3600, contentType: 'image/jpeg' });
}

type VideoWithRelations = Video & {
  share?: ShareLink | null;
  folder?: Pick<Folder, 'id' | 'name'> | null;
  renditions?: Rendition[];
};

export async function serializeVideo(v: VideoWithRelations) {
  return {
    id: v.id,
    filename: v.filename,
    originalFilename: v.originalFilename,
    format: v.format,
    mimeType: v.mimeType,
    size: Number(v.size),
    duration: v.duration,
    width: v.width,
    height: v.height,
    folderId: v.folderId,
    folder: v.folder ? { id: v.folder.id, name: v.folder.name } : null,
    status: v.status,
    processingError: v.processingError,
    browserPlayable: formatFor(`x.${v.format}`)?.browserPlayable ?? false,
    qualities: (v.renditions ?? []).map((r) => r.label),
    thumbnailUrl: await thumbnailUrl(v),
    share: serializeShare(v.share),
    uploadedAt: v.uploadedAt,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    deletedAt: v.deletedAt,
  };
}

export type VideoDTO = Awaited<ReturnType<typeof serializeVideo>>;

/** Playback sources: original plus any generated renditions, all as short-lived signed URLs. */
export async function playbackSources(v: Video & { renditions: Rendition[] }, expiresIn = 6 * 3600) {
  const sources = [
    {
      label: v.height ? `Original (${v.height}p)` : 'Original',
      height: v.height ?? 0,
      mimeType: v.mimeType,
      url: await storage.signedGetUrl(v.storageKey, { expiresIn, contentType: v.mimeType, disposition: 'inline' }),
    },
  ];
  for (const r of [...v.renditions].sort((a, b) => b.height - a.height)) {
    sources.push({
      label: r.label,
      height: r.height,
      mimeType: r.mimeType,
      url: await storage.signedGetUrl(r.storageKey, { expiresIn, contentType: r.mimeType, disposition: 'inline' }),
    });
  }
  return sources;
}

export function downloadUrl(v: Pick<Video, 'storageKey' | 'filename' | 'mimeType' | 'format'>) {
  const name = v.filename.toLowerCase().endsWith(`.${v.format}`) ? v.filename : `${v.filename}.${v.format}`;
  return storage.signedGetUrl(v.storageKey, { expiresIn: 3600, disposition: 'attachment', filename: name, contentType: v.mimeType });
}

/** Permanently deletes a video's objects from storage and its metadata. */
export async function purgeVideo(videoId: string) {
  const v = await prisma.video.findUnique({ where: { id: videoId }, include: { renditions: true, upload: true } });
  if (!v) return;
  const keysToDelete = [v.storageKey, v.thumbnailKey, ...v.renditions.map((r) => r.storageKey)].filter(Boolean) as string[];
  if (v.upload && v.upload.status === 'ACTIVE') {
    await storage.abortMultipartUpload(v.storageKey, v.upload.storageUploadId).catch(() => undefined);
  }
  await prisma.video.delete({ where: { id: v.id } });
  await Promise.all(
    keysToDelete.map((k) => storage.deleteObject(k).catch((err) => logger.warn({ err, key: k }, 'failed to delete object'))),
  );
}
