import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError, notFound } from '../lib/errors.js';
import { sanitizeName } from '../lib/formats.js';
import { requireAuth } from '../middleware/auth.js';

export const foldersRouter = Router();
foldersRouter.use(requireAuth);

const uuid = z.string().uuid();
const MAX_DEPTH = 12;

async function assertUniqueName(userId: string, parentId: string | null, name: string, exceptId?: string) {
  const clash = await prisma.folder.findFirst({
    where: { userId, parentId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash) throw new HttpError(409, 'CONFLICT', `A folder named "${name}" already exists here`);
}

async function ownedFolder(userId: string, id: string) {
  if (!uuid.safeParse(id).success) throw notFound('Folder not found');
  const folder = await prisma.folder.findFirst({ where: { id, userId } });
  if (!folder) throw notFound('Folder not found');
  return folder;
}

/** Depth of a folder from the root (root-level folder = 1). */
async function depthOf(userId: string, folderId: string | null) {
  let depth = 0;
  let cur = folderId;
  while (cur && depth <= MAX_DEPTH) {
    const f: { parentId: string | null } | null = await prisma.folder.findFirst({ where: { id: cur, userId }, select: { parentId: true } });
    if (!f) break;
    depth++;
    cur = f.parentId;
  }
  return depth;
}

foldersRouter.get('/', async (req, res) => {
  const userId = req.user!.id;
  const [folders, stats] = await Promise.all([
    prisma.folder.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
    prisma.video.groupBy({
      by: ['folderId'],
      where: { userId, deletedAt: null, status: { in: ['READY', 'PROCESSING'] } },
      _count: true,
      _sum: { size: true },
    }),
  ]);
  const byFolder = new Map(stats.map((s) => [s.folderId, s]));
  const root = byFolder.get(null);
  res.json({
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      videoCount: byFolder.get(f.id)?._count ?? 0,
      totalSize: Number(byFolder.get(f.id)?._sum.size ?? 0n),
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    })),
    root: { videoCount: root?._count ?? 0, totalSize: Number(root?._sum.size ?? 0n) },
  });
});

foldersRouter.post('/', async (req, res) => {
  const body = z.object({ name: z.string().min(1).max(100), parentId: uuid.nullable().optional() }).parse(req.body);
  const userId = req.user!.id;
  const name = sanitizeName(body.name, 100);
  if (!name) throw new HttpError(400, 'VALIDATION', 'Folder name cannot be empty');
  const parentId = body.parentId ?? null;
  if (parentId) {
    await ownedFolder(userId, parentId);
    if ((await depthOf(userId, parentId)) >= MAX_DEPTH) throw new HttpError(400, 'BAD_REQUEST', 'Folders are nested too deeply');
  }
  await assertUniqueName(userId, parentId, name);
  const folder = await prisma.folder.create({ data: { userId, name, parentId } });
  res.status(201).json({ folder });
});

foldersRouter.patch('/:id', async (req, res) => {
  const body = z.object({ name: z.string().min(1).max(100).optional(), parentId: uuid.nullable().optional() }).parse(req.body);
  const userId = req.user!.id;
  const folder = await ownedFolder(userId, String(req.params.id));
  const name = body.name !== undefined ? sanitizeName(body.name, 100) : folder.name;
  if (!name) throw new HttpError(400, 'VALIDATION', 'Folder name cannot be empty');
  const parentId = body.parentId !== undefined ? body.parentId : folder.parentId;

  if (parentId && parentId !== folder.parentId) {
    // Prevent moving a folder into itself or one of its descendants.
    let cur: string | null = parentId;
    while (cur) {
      if (cur === folder.id) throw new HttpError(400, 'BAD_REQUEST', 'A folder cannot be moved inside itself');
      const p: { parentId: string | null } | null = await prisma.folder.findFirst({ where: { id: cur, userId }, select: { parentId: true } });
      if (!p) throw notFound('Destination folder not found');
      cur = p.parentId;
    }
  }
  await assertUniqueName(userId, parentId, name, folder.id);
  const updated = await prisma.folder.update({ where: { id: folder.id }, data: { name, parentId } });
  res.json({ folder: updated });
});

/** Deletes a folder and its sub-folders; contained videos are moved to the Trash (recoverable). */
foldersRouter.delete('/:id', async (req, res) => {
  const userId = req.user!.id;
  const folder = await ownedFolder(userId, String(req.params.id));
  const all = await prisma.folder.findMany({ where: { userId }, select: { id: true, parentId: true } });
  const ids = new Set([folder.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of all) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) (ids.add(f.id), (grew = true));
  }
  const [trashed] = await prisma.$transaction([
    prisma.video.updateMany({ where: { userId, folderId: { in: [...ids] }, deletedAt: null }, data: { deletedAt: new Date() } }),
    prisma.folder.delete({ where: { id: folder.id } }),
  ]);
  res.json({ ok: true, foldersDeleted: ids.size, videosTrashed: trashed.count });
});
