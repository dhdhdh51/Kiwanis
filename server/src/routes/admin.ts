import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { HttpError, notFound } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { recordActivity } from '../services/activity.js';
import { ffmpegAvailable } from '../services/processing.js';
import { purgeVideo, serializeVideo } from '../services/videos.js';

export const adminRouter = Router();
adminRouter.use(requireRole('ADMIN'));

const uuid = z.string().uuid();
const page = z.coerce.number().int().min(1).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(25);

adminRouter.get('/stats', async (_req, res) => {
  const day = new Date(Date.now() - 86400_000);
  const [users, suspended, storage, videos, activeUploads, completed24h, failed24h, bytes24h, limits] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'SUSPENDED' } }),
    prisma.video.aggregate({ where: { status: { not: 'FAILED' } }, _sum: { size: true } }),
    prisma.video.count({ where: { status: { in: ['READY', 'PROCESSING'] }, deletedAt: null } }),
    prisma.uploadSession.count({ where: { status: 'ACTIVE' } }),
    prisma.uploadSession.count({ where: { status: 'COMPLETED', completedAt: { gte: day } } }),
    prisma.uploadSession.count({ where: { status: { in: ['FAILED', 'EXPIRED'] }, updatedAt: { gte: day } } }),
    prisma.uploadSession.aggregate({ where: { status: 'COMPLETED', completedAt: { gte: day } }, _sum: { size: true } }),
    prisma.user.aggregate({ _sum: { storageLimit: true } }),
  ]);
  res.json({
    users,
    suspendedUsers: suspended,
    videos,
    storageUsed: Number(storage._sum.size ?? 0n),
    storageAllocated: Number(limits._sum.storageLimit ?? 0n),
    activeUploads,
    uploadsCompleted24h: completed24h,
    uploadsFailed24h: failed24h,
    bytesUploaded24h: Number(bytes24h._sum.size ?? 0n),
    storageDriver: config.storage.driver,
    ffmpeg: await ffmpegAvailable(),
    defaultStorageLimit: Number(config.upload.defaultStorageLimit),
  });
});

adminRouter.get('/users', async (req, res) => {
  const q = z.object({ q: z.string().trim().max(200).optional(), page, pageSize }).parse(req.query);
  const where: Prisma.UserWhereInput = q.q
    ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }] }
    : {};
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  const usage = await prisma.video.groupBy({
    by: ['userId'],
    where: { userId: { in: users.map((u) => u.id) }, status: { not: 'FAILED' } },
    _sum: { size: true },
    _count: true,
  });
  const byUser = new Map(usage.map((u) => [u.userId, u]));
  res.json({
    total,
    page: q.page,
    pageSize: q.pageSize,
    items: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      storageLimit: Number(u.storageLimit),
      storageUsed: Number(byUser.get(u.id)?._sum.size ?? 0n),
      videoCount: byUser.get(u.id)?._count ?? 0,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    })),
  });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const id = uuid.parse(String(req.params.id));
  const body = z
    .object({
      storageLimit: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
      role: z.enum(['USER', 'ADMIN']).optional(),
      name: z.string().trim().min(1).max(100).optional(),
    })
    .parse(req.body);
  if (id === req.user!.id && (body.status === 'SUSPENDED' || body.role === 'USER')) {
    throw new HttpError(400, 'BAD_REQUEST', 'You cannot suspend or demote your own account');
  }
  const user = await prisma.user.update({
    where: { id },
    data: { ...body, storageLimit: body.storageLimit !== undefined ? BigInt(body.storageLimit) : undefined },
  });
  if (body.status === 'SUSPENDED') await prisma.session.deleteMany({ where: { userId: id } });
  recordActivity('admin.user_updated', `Admin updated ${user.email}`, { userId: req.user!.id, ip: req.ip, meta: { target: id, ...body } });
  res.json({ ok: true });
});

adminRouter.delete('/users/:id', async (req, res) => {
  const id = uuid.parse(String(req.params.id));
  if (id === req.user!.id) throw new HttpError(400, 'BAD_REQUEST', 'You cannot delete your own account here');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('User not found');
  // Revoke access first, then remove stored objects, then the account (cascades metadata).
  await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } });
  await prisma.session.deleteMany({ where: { userId: id } });
  const videos = await prisma.video.findMany({ where: { userId: id }, select: { id: true } });
  for (const v of videos) await purgeVideo(v.id);
  await prisma.user.delete({ where: { id } });
  recordActivity('admin.user_deleted', `Admin deleted user ${user.email}`, { userId: req.user!.id, ip: req.ip });
  res.json({ ok: true, videosDeleted: videos.length });
});

adminRouter.get('/videos', async (req, res) => {
  const q = z.object({ q: z.string().trim().max(200).optional(), userId: uuid.optional(), page, pageSize }).parse(req.query);
  const where: Prisma.VideoWhereInput = { status: { not: 'FAILED' } };
  if (q.q) where.filename = { contains: q.q, mode: 'insensitive' };
  if (q.userId) where.userId = q.userId;
  const [total, items] = await Promise.all([
    prisma.video.count({ where }),
    prisma.video.findMany({
      where,
      include: { share: true, folder: { select: { id: true, name: true } }, user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  res.json({
    total,
    page: q.page,
    pageSize: q.pageSize,
    items: await Promise.all(items.map(async (v) => ({ ...(await serializeVideo(v)), owner: v.user }))),
  });
});

adminRouter.delete('/videos/:id', async (req, res) => {
  const id = uuid.parse(String(req.params.id));
  const v = await prisma.video.findUnique({ where: { id }, include: { user: { select: { email: true } } } });
  if (!v) throw notFound('Video not found');
  await purgeVideo(id);
  recordActivity('admin.video_deleted', `Admin deleted "${v.filename}" owned by ${v.user.email}`, { userId: req.user!.id, ip: req.ip });
  res.json({ ok: true });
});

adminRouter.get('/uploads', async (req, res) => {
  const q = z
    .object({ status: z.enum(['ACTIVE', 'COMPLETED', 'ABORTED', 'FAILED', 'EXPIRED']).optional(), page, pageSize })
    .parse(req.query);
  const where: Prisma.UploadSessionWhereInput = q.status ? { status: q.status } : {};
  const [total, items] = await Promise.all([
    prisma.uploadSession.count({ where }),
    prisma.uploadSession.findMany({
      where,
      include: { user: { select: { email: true } }, video: { select: { filename: true } } },
      orderBy: { updatedAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  res.json({
    total,
    page: q.page,
    pageSize: q.pageSize,
    items: items.map((s) => ({
      id: s.id,
      user: s.user.email,
      filename: s.video.filename,
      size: Number(s.size),
      uploadedBytes: Number(s.uploadedBytes),
      totalChunks: s.totalChunks,
      status: s.status,
      error: s.error,
      ip: s.ip,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      completedAt: s.completedAt,
    })),
  });
});

adminRouter.get('/activity', async (req, res) => {
  const q = z.object({ type: z.string().max(50).optional(), page, pageSize: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
  const where: Prisma.ActivityWhereInput = q.type ? { type: { startsWith: q.type } } : {};
  const [total, items] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  res.json({
    total,
    page: q.page,
    pageSize: q.pageSize,
    items: items.map((a) => ({ id: a.id, type: a.type, message: a.message, user: a.user?.email ?? null, ip: a.ip, createdAt: a.createdAt })),
  });
});
