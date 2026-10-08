import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { FORMATS, matchesFamily, resolveMime, sanitizeName } from '../lib/formats.js';
import { HttpError, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';
import { limits } from '../middleware/rateLimit.js';
import { keys, storage } from '../storage/index.js';
import { recordActivity } from '../services/activity.js';
import { enqueueProcessing } from '../services/processing.js';
import { getUsedBytes, serializeVideo } from '../services/videos.js';

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

const MB = 1024 * 1024;
const formatList = FORMATS.map((f) => f.ext.toUpperCase()).join(', ');

function planChunks(size: number) {
  const minForPartLimit = Math.ceil(size / config.upload.maxParts);
  const chunkSize = Math.ceil(Math.max(config.upload.chunkSize, minForPartLimit) / MB) * MB;
  return { chunkSize, totalChunks: Math.max(1, Math.ceil(size / chunkSize)) };
}

function partLength(session: { size: bigint; chunkSize: number; totalChunks: number }, partNumber: number) {
  const size = Number(session.size);
  return partNumber < session.totalChunks ? session.chunkSize : size - session.chunkSize * (session.totalChunks - 1);
}

/** Part numbers fully stored for a session (a part counts only if it has the exact expected length). */
async function completedParts(session: { size: bigint; chunkSize: number; totalChunks: number; storageUploadId: string }, key: string) {
  const parts = await storage.listParts(key, session.storageUploadId);
  return parts.filter((p) => p.partNumber >= 1 && p.partNumber <= session.totalChunks && p.size === partLength(session, p.partNumber));
}

async function getOwnedSession(userId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Upload not found');
  const session = await prisma.uploadSession.findFirst({ where: { id, userId }, include: { video: true } });
  if (!session) throw notFound('Upload not found');
  return session;
}

const createSchema = z.object({
  filename: z.string().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.string().max(100).optional(),
  folderId: z.string().uuid().nullable().optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{16,128}$/).optional(),
  duration: z.number().positive().max(1e7).optional(),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
  allowDuplicate: z.boolean().optional(),
});

/** Start (or resume) a chunked upload. */
uploadsRouter.post('/', limits.uploadCreate, async (req, res) => {
  const body = createSchema.parse(req.body);
  const user = req.user!;
  const filename = sanitizeName(body.filename);
  const fmt = resolveMime(filename, body.mimeType);
  if (!filename || !fmt) {
    throw new HttpError(415, 'UNSUPPORTED_FORMAT', `Unsupported format. Allowed formats: ${formatList}.`);
  }
  if (body.size > config.upload.maxFileSize) {
    throw new HttpError(413, 'FILE_TOO_LARGE', `File is too large. Maximum size is ${(config.upload.maxFileSize / 1024 ** 3).toFixed(0)} GB.`);
  }
  if (body.folderId) {
    const folder = await prisma.folder.findFirst({ where: { id: body.folderId, userId: user.id } });
    if (!folder) throw notFound('Destination folder not found');
  }

  // ---- Resume an interrupted upload of the same file ----
  if (body.fingerprint) {
    const existing = await prisma.uploadSession.findFirst({
      where: { userId: user.id, status: 'ACTIVE', fingerprint: body.fingerprint, size: BigInt(body.size) },
      include: { video: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) {
      const parts = await completedParts(existing, existing.video.storageKey).catch(() => null);
      if (parts) {
        const uploadedBytes = parts.reduce((s, p) => s + p.size, 0);
        await prisma.uploadSession.update({ where: { id: existing.id }, data: { uploadedBytes: BigInt(uploadedBytes) } });
        if (body.folderId !== undefined && body.folderId !== existing.video.folderId) {
          await prisma.video.update({ where: { id: existing.videoId }, data: { folderId: body.folderId } });
        }
        recordActivity('upload.resumed', `Resumed upload of "${existing.video.filename}"`, { userId: user.id, ip: req.ip });
        return res.json({
          uploadId: existing.id,
          videoId: existing.videoId,
          chunkSize: existing.chunkSize,
          totalChunks: existing.totalChunks,
          uploadedParts: parts.map((p) => p.partNumber),
          uploadedBytes,
          resumed: true,
        });
      }
      // Storage no longer knows the multipart upload; discard the stale session.
      await prisma.video.delete({ where: { id: existing.videoId } }).catch(() => undefined);
    }

    // ---- Duplicate detection ----
    if (!body.allowDuplicate) {
      const dup = await prisma.video.findFirst({
        where: { userId: user.id, fingerprint: body.fingerprint, size: BigInt(body.size), status: { in: ['READY', 'PROCESSING'] }, deletedAt: null },
        select: { id: true, filename: true, folderId: true },
      });
      if (dup) throw new HttpError(409, 'DUPLICATE', `This video is already in your library as "${dup.filename}".`, { video: dup });
    }
  }

  const { chunkSize, totalChunks } = planChunks(body.size);
  const videoId = crypto.randomUUID();
  const storageKey = keys.video(user.id, videoId, fmt.ext);
  const storageUploadId = await storage.createMultipartUpload(storageKey, fmt.mime);

  try {
    const session = await prisma.$transaction(async (tx) => {
      // Serialise quota checks per user so concurrent uploads cannot oversubscribe the quota.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id}::uuid FOR UPDATE`;
      const used = await getUsedBytes(user.id, tx);
      const limit = (await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { storageLimit: true } })).storageLimit;
      if (used + BigInt(body.size) > limit) {
        throw new HttpError(507, 'QUOTA_EXCEEDED', 'Not enough storage space for this video. Free up space or ask an administrator for more.', {
          used: Number(used),
          limit: Number(limit),
          required: body.size,
        });
      }
      await tx.video.create({
        data: {
          id: videoId,
          userId: user.id,
          folderId: body.folderId ?? null,
          filename,
          originalFilename: filename,
          format: fmt.ext,
          mimeType: fmt.mime,
          size: BigInt(body.size),
          storageKey,
          duration: body.duration,
          width: body.width,
          height: body.height,
          fingerprint: body.fingerprint,
          status: 'UPLOADING',
        },
      });
      return tx.uploadSession.create({
        data: {
          userId: user.id,
          videoId,
          storageUploadId,
          size: BigInt(body.size),
          chunkSize,
          totalChunks,
          fingerprint: body.fingerprint,
          ip: req.ip,
        },
      });
    });
    recordActivity('upload.started', `Started uploading "${filename}"`, { userId: user.id, ip: req.ip, meta: { size: body.size } });
    res.status(201).json({ uploadId: session.id, videoId, chunkSize, totalChunks, uploadedParts: [], uploadedBytes: 0, resumed: false });
  } catch (err) {
    await storage.abortMultipartUpload(storageKey, storageUploadId).catch(() => undefined);
    throw err;
  }
});

/** Presigned URLs for a batch of parts; the browser PUTs chunk bytes straight to storage. */
uploadsRouter.post('/:id/parts', limits.uploadOps, async (req, res) => {
  const body = z.object({ partNumbers: z.array(z.number().int().positive()).min(1).max(50) }).parse(req.body);
  const session = await getOwnedSession(req.user!.id, String(req.params.id));
  if (session.status !== 'ACTIVE') throw new HttpError(409, 'CONFLICT', 'This upload is no longer active');
  const parts = await Promise.all(
    [...new Set(body.partNumbers)].map(async (partNumber) => {
      if (partNumber > session.totalChunks) throw new HttpError(400, 'BAD_REQUEST', `Invalid part number ${partNumber}`);
      const size = partLength(session, partNumber);
      return { partNumber, size, ...(await storage.presignPart(session.video.storageKey, session.storageUploadId, partNumber, size)) };
    }),
  );
  res.json({ parts });
});

/** Lightweight progress heartbeat (keeps the session alive and feeds admin monitoring). */
uploadsRouter.post('/:id/progress', limits.uploadOps, async (req, res) => {
  const body = z.object({ uploadedBytes: z.number().int().nonnegative() }).parse(req.body);
  if (!z.string().uuid().safeParse(String(req.params.id)).success) throw notFound('Upload not found');
  await prisma.uploadSession.updateMany({
    where: { id: String(req.params.id), userId: req.user!.id, status: 'ACTIVE' },
    data: { uploadedBytes: BigInt(body.uploadedBytes) },
  });
  res.json({ ok: true });
});

/** Finalise: verify all parts, assemble the object, validate content, queue processing. */
uploadsRouter.post('/:id/complete', limits.uploadOps, async (req, res) => {
  const session = await getOwnedSession(req.user!.id, String(req.params.id));
  const video = session.video;

  if (session.status === 'COMPLETED') {
    // Idempotent: the client may retry if the first response was lost.
    const v = await prisma.video.findUniqueOrThrow({ where: { id: video.id }, include: { share: true, folder: true } });
    return res.json({ video: await serializeVideo(v) });
  }
  if (session.status !== 'ACTIVE') throw new HttpError(409, 'CONFLICT', 'This upload is no longer active');

  const parts = await completedParts(session, video.storageKey);
  const have = new Set(parts.map((p) => p.partNumber));
  const missing: number[] = [];
  for (let n = 1; n <= session.totalChunks; n++) if (!have.has(n)) missing.push(n);
  if (missing.length) {
    throw new HttpError(409, 'UPLOAD_INCOMPLETE', `Upload is missing ${missing.length} chunk(s)`, { missingParts: missing.slice(0, 500) });
  }

  try {
    await storage.completeMultipartUpload(video.storageKey, session.storageUploadId, parts);
  } catch (err) {
    const fresh = await prisma.uploadSession.findUnique({ where: { id: session.id } });
    if (fresh?.status === 'COMPLETED') {
      const v = await prisma.video.findUniqueOrThrow({ where: { id: video.id }, include: { share: true, folder: true } });
      return res.json({ video: await serializeVideo(v) });
    }
    throw err;
  }

  const head = await storage.headObject(video.storageKey);
  const sniff = head ? await storage.readRange(video.storageKey, 0, 63) : Buffer.alloc(0);
  const fail = async (message: string): Promise<never> => {
    await storage.deleteObject(video.storageKey).catch(() => undefined);
    await prisma.$transaction([
      prisma.uploadSession.update({ where: { id: session.id }, data: { status: 'FAILED', error: message } }),
      prisma.video.update({ where: { id: video.id }, data: { status: 'FAILED', processingError: message } }),
    ]);
    recordActivity('upload.failed', `Upload of "${video.filename}" rejected: ${message}`, { userId: session.userId, ip: req.ip });
    throw new HttpError(422, 'INVALID_FILE', message);
  };
  if (!head || head.size !== Number(session.size)) await fail('Uploaded size does not match the declared file size');
  if (!matchesFamily(video.originalFilename, sniff)) {
    await fail(`File content is not a valid ${video.format.toUpperCase()} video`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.uploadSession.update({
      where: { id: session.id },
      data: { status: 'COMPLETED', completedAt: new Date(), uploadedBytes: session.size },
    });
    return tx.video.update({
      where: { id: video.id },
      data: { status: 'PROCESSING', uploadedAt: new Date() },
      include: { share: true, folder: true },
    });
  });
  enqueueProcessing(video.id);
  recordActivity('upload.completed', `Uploaded "${video.filename}"`, {
    userId: session.userId,
    ip: req.ip,
    meta: { size: Number(session.size), videoId: video.id },
  });
  res.json({ video: await serializeVideo(updated) });
});

/** Cancel an in-progress upload and release its storage reservation. */
uploadsRouter.delete('/:id', limits.uploadOps, async (req, res) => {
  const session = await getOwnedSession(req.user!.id, String(req.params.id));
  if (session.status === 'ACTIVE') {
    await storage.abortMultipartUpload(session.video.storageKey, session.storageUploadId).catch((err) =>
      logger.warn({ err }, 'abort multipart failed'),
    );
    await prisma.video.delete({ where: { id: session.videoId } });
    recordActivity('upload.aborted', `Cancelled upload of "${session.video.filename}"`, { userId: session.userId, ip: req.ip });
  }
  res.json({ ok: true });
});

/** Active (resumable) upload sessions for the current user. */
uploadsRouter.get('/', async (req, res) => {
  const sessions = await prisma.uploadSession.findMany({
    where: { userId: req.user!.id, status: 'ACTIVE' },
    include: { video: { select: { filename: true, folderId: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  res.json({
    uploads: sessions.map((s) => ({
      id: s.id,
      videoId: s.videoId,
      filename: s.video.filename,
      folderId: s.video.folderId,
      size: Number(s.size),
      uploadedBytes: Number(s.uploadedBytes),
      updatedAt: s.updatedAt,
    })),
  });
});
