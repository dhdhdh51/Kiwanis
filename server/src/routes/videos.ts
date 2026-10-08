import express, { Router, type Request } from 'express';
import archiver from 'archiver';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { hashPassword, randomToken } from '../lib/crypto.js';
import { HttpError, notFound } from '../lib/errors.js';
import { isImage, sanitizeName } from '../lib/formats.js';
import { logger } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';
import { keys, storage } from '../storage/index.js';
import { recordActivity } from '../services/activity.js';
import { downloadUrl, playbackSources, purgeVideo, serializeShare, serializeVideo } from '../services/videos.js';

export const videosRouter = Router();
videosRouter.use(requireAuth);

const uuid = z.string().uuid();
const include = { share: true, folder: { select: { id: true, name: true } } } as const;

async function ownedVideo(req: Request, opts: { allowDeleted?: boolean } = {}) {
  const id = String(req.params.id);
  if (!uuid.safeParse(id).success) throw notFound('Video not found');
  const v = await prisma.video.findFirst({
    where: { id, userId: req.user!.id, ...(opts.allowDeleted ? {} : { deletedAt: null }) },
    include: { ...include, renditions: true },
  });
  if (!v) throw notFound('Video not found');
  return v;
}

const optNum = z.coerce.number().nonnegative().optional();
const listSchema = z.object({
  q: z.string().trim().max(200).optional(),
  folderId: z.union([z.literal('root'), uuid]).optional(),
  format: z.string().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minSize: optNum,
  maxSize: optNum,
  minDuration: optNum,
  maxDuration: optNum,
  shared: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'oldest', 'largest', 'smallest', 'name_asc', 'name_desc']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(40),
});

const sortMap: Record<z.infer<typeof listSchema>['sort'], Prisma.VideoOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }, { id: 'asc' }],
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  largest: [{ size: 'desc' }, { id: 'asc' }],
  smallest: [{ size: 'asc' }, { id: 'asc' }],
  name_asc: [{ filename: 'asc' }, { id: 'asc' }],
  name_desc: [{ filename: 'desc' }, { id: 'asc' }],
};

/** Library listing with search, filters, sorting and pagination. */
videosRouter.get('/', async (req, res) => {
  const f = listSchema.parse(req.query);
  const where: Prisma.VideoWhereInput = {
    userId: req.user!.id,
    deletedAt: null,
    status: { in: ['READY', 'PROCESSING'] },
  };
  if (f.q) {
    // Every word must appear in the name ("clip 3" matches "clip-3.mp4").
    const words = f.q.split(/[\s_.-]+/).filter(Boolean).slice(0, 8);
    where.AND = words.map((w) => ({ filename: { contains: w, mode: 'insensitive' as const } }));
  }
  if (f.folderId) where.folderId = f.folderId === 'root' ? null : f.folderId;
  if (f.format) where.format = { in: f.format.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) };
  if (f.from || f.to) where.createdAt = { gte: f.from, lte: f.to };
  if (f.minSize !== undefined || f.maxSize !== undefined) {
    where.size = {
      gte: f.minSize !== undefined ? BigInt(Math.floor(f.minSize)) : undefined,
      lte: f.maxSize !== undefined ? BigInt(Math.ceil(f.maxSize)) : undefined,
    };
  }
  if (f.minDuration !== undefined || f.maxDuration !== undefined) where.duration = { gte: f.minDuration, lte: f.maxDuration };
  if (f.shared === 'true') where.share = { isNot: null };

  const [total, items] = await Promise.all([
    prisma.video.count({ where }),
    prisma.video.findMany({ where, include, orderBy: sortMap[f.sort], skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
  ]);
  res.json({ items: await Promise.all(items.map(serializeVideo)), total, page: f.page, pageSize: f.pageSize });
});

videosRouter.get('/recent', async (req, res) => {
  const items = await prisma.video.findMany({
    where: { userId: req.user!.id, deletedAt: null, status: { in: ['READY', 'PROCESSING'] } },
    include,
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  res.json({ items: await Promise.all(items.map(serializeVideo)) });
});

videosRouter.get('/trash', async (req, res) => {
  const items = await prisma.video.findMany({
    where: { userId: req.user!.id, deletedAt: { not: null } },
    include,
    orderBy: { deletedAt: 'desc' },
    take: 500,
  });
  res.json({ items: await Promise.all(items.map(serializeVideo)) });
});

videosRouter.delete('/trash', async (req, res) => {
  const items = await prisma.video.findMany({ where: { userId: req.user!.id, deletedAt: { not: null } }, select: { id: true } });
  for (const v of items) await purgeVideo(v.id);
  recordActivity('video.deleted', `Emptied trash (${items.length} videos)`, { userId: req.user!.id, ip: req.ip });
  res.json({ deleted: items.length });
});

/** Streams several videos as a single ZIP (stored, not re-compressed — video is already compressed). */
videosRouter.get('/zip', async (req, res) => {
  const ids = z
    .string()
    .transform((s) => s.split(','))
    .pipe(z.array(uuid).min(1).max(200))
    .parse(req.query.ids);
  const videos = await prisma.video.findMany({
    where: { id: { in: ids }, userId: req.user!.id, deletedAt: null, status: { in: ['READY', 'PROCESSING'] } },
  });
  if (!videos.length) throw notFound('No videos to download');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="vidvault-${new Date().toISOString().slice(0, 10)}.zip"`);
  const archive = archiver('zip', { store: true, forceZip64: true });
  archive.on('error', (err) => {
    logger.error({ err }, 'zip stream failed');
    res.destroy(err);
  });
  req.on('close', () => archive.abort());
  archive.pipe(res);
  const used = new Map<string, number>();
  for (const v of videos) {
    let name = v.filename.toLowerCase().endsWith(`.${v.format}`) ? v.filename : `${v.filename}.${v.format}`;
    const n = used.get(name) ?? 0;
    used.set(name, n + 1);
    if (n) name = name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
    archive.append(await storage.getObjectStream(v.storageKey), { name, date: v.createdAt });
  }
  await archive.finalize();
});

const bulkSchema = z.object({
  action: z.enum(['trash', 'restore', 'delete', 'move']),
  ids: z.array(uuid).min(1).max(500),
  folderId: uuid.nullable().optional(),
});

videosRouter.post('/bulk', async (req, res) => {
  const body = bulkSchema.parse(req.body);
  const userId = req.user!.id;
  const owned = { id: { in: body.ids }, userId };
  let affected = 0;
  switch (body.action) {
    case 'trash':
      affected = (await prisma.video.updateMany({ where: { ...owned, deletedAt: null }, data: { deletedAt: new Date() } })).count;
      break;
    case 'restore':
      affected = (await prisma.video.updateMany({ where: { ...owned, deletedAt: { not: null } }, data: { deletedAt: null } })).count;
      break;
    case 'move': {
      if (body.folderId === undefined) throw new HttpError(400, 'BAD_REQUEST', 'folderId is required');
      if (body.folderId) {
        const folder = await prisma.folder.findFirst({ where: { id: body.folderId, userId } });
        if (!folder) throw notFound('Folder not found');
      }
      affected = (await prisma.video.updateMany({ where: { ...owned, deletedAt: null }, data: { folderId: body.folderId } })).count;
      break;
    }
    case 'delete': {
      const vids = await prisma.video.findMany({ where: owned, select: { id: true } });
      for (const v of vids) await purgeVideo(v.id);
      affected = vids.length;
      recordActivity('video.deleted', `Permanently deleted ${affected} video(s)`, { userId, ip: req.ip });
      break;
    }
  }
  res.json({ affected });
});

videosRouter.get('/:id', async (req, res) => {
  res.json({ video: await serializeVideo(await ownedVideo(req, { allowDeleted: true })) });
});

videosRouter.patch('/:id', async (req, res) => {
  const body = z
    .object({ filename: z.string().min(1).max(255).optional(), folderId: uuid.nullable().optional() })
    .parse(req.body);
  const v = await ownedVideo(req);
  const data: Prisma.VideoUncheckedUpdateInput = {};
  if (body.filename !== undefined) {
    const name = sanitizeName(body.filename);
    if (!name) throw new HttpError(400, 'VALIDATION', 'Name cannot be empty');
    data.filename = name;
  }
  if (body.folderId !== undefined) {
    if (body.folderId) {
      const folder = await prisma.folder.findFirst({ where: { id: body.folderId, userId: req.user!.id } });
      if (!folder) throw notFound('Folder not found');
    }
    data.folderId = body.folderId;
  }
  const updated = await prisma.video.update({ where: { id: v.id }, data, include });
  res.json({ video: await serializeVideo(updated) });
});

/** Move to trash, or permanently delete with ?permanent=true */
videosRouter.delete('/:id', async (req, res) => {
  const v = await ownedVideo(req, { allowDeleted: true });
  if (req.query.permanent === 'true') {
    await purgeVideo(v.id);
    recordActivity('video.deleted', `Permanently deleted "${v.filename}"`, { userId: req.user!.id, ip: req.ip });
    return res.json({ ok: true, permanent: true });
  }
  await prisma.video.update({ where: { id: v.id }, data: { deletedAt: new Date() } });
  res.json({ ok: true, permanent: false });
});

videosRouter.post('/:id/restore', async (req, res) => {
  const v = await ownedVideo(req, { allowDeleted: true });
  const updated = await prisma.video.update({ where: { id: v.id }, data: { deletedAt: null }, include });
  res.json({ video: await serializeVideo(updated) });
});

/** Signed, short-lived streaming URLs — the video plays straight from object storage. */
videosRouter.get('/:id/playback', async (req, res) => {
  const v = await ownedVideo(req);
  if (v.status !== 'READY' && v.status !== 'PROCESSING') throw new HttpError(409, 'CONFLICT', 'Video is not available yet');
  res.json({
    sources: await playbackSources(v),
    poster: v.thumbnailKey ? await storage.signedGetUrl(v.thumbnailKey, { expiresIn: 3600, contentType: 'image/jpeg' }) : null,
    downloadUrl: await downloadUrl(v),
  });
});

videosRouter.get('/:id/download', async (req, res) => {
  const v = await ownedVideo(req);
  res.redirect(302, await downloadUrl(v));
});

/** Client-generated thumbnail (captured from the video in the browser before upload). */
videosRouter.put('/:id/thumbnail', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }), async (req, res) => {
  const v = await ownedVideo(req);
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'BAD_REQUEST', 'Image body required');
  const type = isImage(body);
  if (!type) throw new HttpError(415, 'UNSUPPORTED_FORMAT', 'Thumbnail must be a JPEG, PNG or WebP image');
  const key = keys.thumbnail(v.userId, v.id, type === 'image/jpeg' ? 'jpg' : type.split('/')[1]);
  await storage.putObject(key, body, type);
  if (v.thumbnailKey && v.thumbnailKey !== key) await storage.deleteObject(v.thumbnailKey).catch(() => undefined);
  const updated = await prisma.video.update({ where: { id: v.id }, data: { thumbnailKey: key }, include });
  res.json({ video: await serializeVideo(updated) });
});

/** Client-side metadata (duration / resolution) when the server has no ffprobe. */
videosRouter.post('/:id/metadata', async (req, res) => {
  const body = z
    .object({
      duration: z.number().positive().max(1e7).optional(),
      width: z.number().int().positive().max(20000).optional(),
      height: z.number().int().positive().max(20000).optional(),
    })
    .parse(req.body);
  const v = await ownedVideo(req);
  const data = {
    duration: v.duration ?? body.duration,
    width: v.width ?? body.width,
    height: v.height ?? body.height,
  };
  const updated = await prisma.video.update({ where: { id: v.id }, data, include });
  res.json({ video: await serializeVideo(updated) });
});

// ---------- Sharing ----------

const shareSchema = z.object({
  isPublic: z.boolean().optional(),
  password: z.string().min(4).max(128).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  allowDownload: z.boolean().optional(),
  allowEmbed: z.boolean().optional(),
});

videosRouter.get('/:id/share', async (req, res) => {
  const v = await ownedVideo(req);
  res.json({ share: serializeShare(v.share) });
});

videosRouter.put('/:id/share', async (req, res) => {
  const body = shareSchema.parse(req.body);
  const v = await ownedVideo(req);
  if (body.expiresAt && body.expiresAt <= new Date()) throw new HttpError(400, 'VALIDATION', 'Expiration must be in the future');
  const data: Prisma.ShareLinkUncheckedUpdateInput = {};
  if (body.isPublic !== undefined) data.isPublic = body.isPublic;
  if (body.allowDownload !== undefined) data.allowDownload = body.allowDownload;
  if (body.allowEmbed !== undefined) data.allowEmbed = body.allowEmbed;
  if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt;
  if (body.password !== undefined) data.passwordHash = body.password ? await hashPassword(body.password) : null;
  const share = await prisma.shareLink.upsert({
    where: { videoId: v.id },
    create: {
      videoId: v.id,
      token: randomToken(16),
      isPublic: body.isPublic ?? true,
      allowDownload: body.allowDownload ?? true,
      allowEmbed: body.allowEmbed ?? true,
      expiresAt: body.expiresAt ?? null,
      passwordHash: (data.passwordHash as string | null | undefined) ?? null,
    },
    update: data,
  });
  if (!v.share) recordActivity('video.shared', `Shared "${v.filename}"`, { userId: req.user!.id, ip: req.ip });
  res.json({ share: serializeShare(share) });
});

/** Issue a new token, invalidating the previous link. */
videosRouter.post('/:id/share/regenerate', async (req, res) => {
  const v = await ownedVideo(req);
  if (!v.share) throw notFound('Sharing is not enabled for this video');
  const share = await prisma.shareLink.update({ where: { videoId: v.id }, data: { token: randomToken(16), views: 0 } });
  res.json({ share: serializeShare(share) });
});

/** Disable sharing entirely. */
videosRouter.delete('/:id/share', async (req, res) => {
  const v = await ownedVideo(req);
  await prisma.shareLink.deleteMany({ where: { videoId: v.id } });
  res.json({ ok: true });
});

/** Enable public links for several videos at once. */
videosRouter.post('/share/bulk', async (req, res) => {
  const body = z.object({ ids: z.array(uuid).min(1).max(200) }).parse(req.body);
  const videos = await prisma.video.findMany({
    where: { id: { in: body.ids }, userId: req.user!.id, deletedAt: null },
    include: { share: true },
  });
  const results = [];
  for (const v of videos) {
    const share = v.share
      ? await prisma.shareLink.update({ where: { videoId: v.id }, data: { isPublic: true } })
      : await prisma.shareLink.create({ data: { videoId: v.id, token: randomToken(16) } });
    results.push({ videoId: v.id, filename: v.filename, share: serializeShare(share) });
  }
  res.json({ results });
});
