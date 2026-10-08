import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { sha256, signToken, verifyPassword, verifyToken } from '../lib/crypto.js';
import { formatFor } from '../lib/formats.js';
import { HttpError } from '../lib/errors.js';
import { limits } from '../middleware/rateLimit.js';
import { storage } from '../storage/index.js';
import { downloadUrl, playbackSources } from '../services/videos.js';

/** Unauthenticated endpoints backing the public share player page (/s/:token). */
export const publicRouter = Router();
publicRouter.use(limits.publicShare);

const ACCESS_PURPOSE = 'share-access';
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{10,64}$/);

async function loadShare(token: string) {
  if (!tokenSchema.safeParse(token).success) throw new HttpError(404, 'NOT_FOUND', 'This link is invalid or no longer available');
  const share = await prisma.shareLink.findUnique({
    where: { token },
    include: { video: { include: { renditions: true, user: { select: { name: true, status: true } } } } },
  });
  const v = share?.video;
  if (!share || !v || !share.isPublic || v.deletedAt || !['READY', 'PROCESSING'].includes(v.status) || v.user.status !== 'ACTIVE') {
    throw new HttpError(404, 'NOT_FOUND', 'This link is invalid or no longer available');
  }
  if (share.expiresAt && share.expiresAt <= new Date()) throw new HttpError(410, 'GONE', 'This share link has expired');
  return share;
}

/** Binds an unlock grant to the current password, so changing the password revokes old grants. */
const passwordVersion = (hash: string) => sha256(hash).slice(0, 16);

function isUnlocked(req: Request, share: { id: string; passwordHash: string | null }) {
  if (!share.passwordHash) return true;
  const grant = verifyToken<{ sid: string; pv: string; exp: number }>(req.get('x-share-access'), ACCESS_PURPOSE);
  return !!grant && grant.sid === share.id && grant.pv === passwordVersion(share.passwordHash);
}

publicRouter.get('/s/:token', async (req, res) => {
  const share = await loadShare(String(req.params.token));
  const v = share.video;
  const unlocked = isUnlocked(req, share);
  const base = {
    video: {
      title: v.filename,
      format: v.format,
      size: Number(v.size),
      duration: v.duration,
      width: v.width,
      height: v.height,
      createdAt: v.createdAt,
      browserPlayable: formatFor(`x.${v.format}`)?.browserPlayable ?? false,
    },
    owner: v.user.name,
    requiresPassword: !!share.passwordHash,
    locked: !unlocked,
    allowDownload: share.allowDownload,
    expiresAt: share.expiresAt,
  };
  if (!unlocked) return res.json(base);

  await prisma.shareLink.update({ where: { id: share.id }, data: { views: { increment: 1 } } });
  // Never outlive the share link's own expiry.
  const ttl = share.expiresAt ? Math.max(60, Math.min(6 * 3600, Math.floor((share.expiresAt.getTime() - Date.now()) / 1000))) : 6 * 3600;
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ...base,
    sources: await playbackSources(v, ttl),
    poster: v.thumbnailKey ? await storage.signedGetUrl(v.thumbnailKey, { expiresIn: 3600, contentType: 'image/jpeg' }) : null,
    downloadUrl: share.allowDownload ? await downloadUrl(v) : null,
  });
});

publicRouter.post('/s/:token/unlock', limits.sharePassword, async (req, res) => {
  const { password } = z.object({ password: z.string().min(1).max(128) }).parse(req.body);
  const share = await loadShare(String(req.params.token));
  if (!share.passwordHash) return res.json({ accessToken: null });
  if (!(await verifyPassword(share.passwordHash, password))) throw new HttpError(401, 'UNAUTHORIZED', 'Incorrect password');
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  res.json({ accessToken: signToken({ sid: share.id, pv: passwordVersion(share.passwordHash), exp }, ACCESS_PURPOSE) });
});

export const configRouter = Router();
configRouter.get('/', (_req, res) => {
  res.json({
    maxFileSize: config.upload.maxFileSize,
    formats: (formatsCache ??= buildFormats()),
    maxConcurrentFiles: config.upload.maxConcurrentFiles,
    maxConcurrentChunks: config.upload.maxConcurrentChunks,
    storageDriver: config.storage.driver,
  });
});
let formatsCache: ReturnType<typeof buildFormats> | undefined;
function buildFormats() {
  return ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'].map((ext) => {
    const f = formatFor(`x.${ext}`)!;
    return { ext: f.ext, mime: f.mime, aliases: f.aliases, browserPlayable: f.browserPlayable };
  });
}
