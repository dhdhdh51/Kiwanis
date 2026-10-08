import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { sha256, signToken, verifyPassword, verifyToken } from '../lib/crypto.js';
import { formatFor } from '../lib/formats.js';
import { HttpError } from '../lib/errors.js';
import { limits } from '../middleware/rateLimit.js';
import { storage } from '../storage/index.js';
import { downloadUrl, embedCode, embedUrl, playbackSources, posterUrl, shareUrl, streamUrl } from '../services/videos.js';

/** Unauthenticated endpoints backing the public share player page (/s/:token). */
export const publicRouter = Router();

/**
 * Public share data may be read from any website (custom players, embeds). Responses never
 * carry cookies or private data, so a wildcard CORS policy is safe here.
 */
publicRouter.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Share-Access');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Redirect endpoints are hit by <video>/<img> tags on third-party pages; give them a looser limit.
const MEDIA_ROUTE = /^\/s\/[^/]+\/(stream|poster)$/;
publicRouter.use((req, res, next) => (MEDIA_ROUTE.test(req.path) ? limits.publicMedia : limits.publicShare)(req, res, next));

const ACCESS_PURPOSE = 'share-access';
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{10,64}$/);

export async function loadShare(token: string) {
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
    allowEmbed: share.allowEmbed,
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

/** Unlock via ?access= for <video src> use, where custom headers are impossible. */
function unlockedFromQuery(req: Request, share: { id: string; passwordHash: string | null }) {
  if (!share.passwordHash) return true;
  const grant = verifyToken<{ sid: string; pv: string; exp: number }>(String(req.query.access ?? ''), ACCESS_PURPOSE);
  return !!grant && grant.sid === share.id && grant.pv === passwordVersion(share.passwordHash);
}

/**
 * Stable direct video URL for other websites: <video src="https://.../api/public/s/TOKEN/stream">.
 * Redirects to a short-lived signed storage URL (supports Range / seeking). Optional ?quality=720p.
 */
publicRouter.get('/s/:token/stream', async (req, res) => {
  const share = await loadShare(String(req.params.token));
  if (!unlockedFromQuery(req, share)) throw new HttpError(401, 'PASSWORD_REQUIRED', 'This video is password protected');
  const sources = await playbackSources(share.video, 3 * 3600);
  const q = typeof req.query.quality === 'string' ? req.query.quality : '';
  const src = sources.find((s) => s.label === q) ?? sources[0];
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.redirect(302, src.url);
});

publicRouter.get('/s/:token/poster', async (req, res) => {
  const share = await loadShare(String(req.params.token));
  if (!share.video.thumbnailKey) throw new HttpError(404, 'NOT_FOUND', 'No thumbnail');
  res.setHeader('Cache-Control', 'public, max-age=1800');
  res.redirect(302, await storage.signedGetUrl(share.video.thumbnailKey, { expiresIn: 3600, contentType: 'image/jpeg' }));
});

publicRouter.get('/s/:token/download', async (req, res) => {
  const share = await loadShare(String(req.params.token));
  if (!share.allowDownload) throw new HttpError(403, 'FORBIDDEN', 'Downloads are disabled for this link');
  if (!unlockedFromQuery(req, share)) throw new HttpError(401, 'PASSWORD_REQUIRED', 'This video is password protected');
  res.redirect(302, await downloadUrl(share.video));
});

/** oEmbed (https://oembed.com) — lets CMSs and chat apps turn a share link into an embedded player. */
publicRouter.get('/oembed', async (req, res) => {
  const q = z
    .object({
      url: z.string().url(),
      maxwidth: z.coerce.number().int().positive().max(4000).optional(),
      maxheight: z.coerce.number().int().positive().max(4000).optional(),
      format: z.enum(['json']).optional(),
    })
    .parse(req.query);
  const m = /\/(?:s|embed)\/([A-Za-z0-9_-]{10,64})\/?$/.exec(new URL(q.url).pathname);
  if (!m || new URL(q.url).origin !== config.appOrigin) throw new HttpError(404, 'NOT_FOUND', 'Unknown URL');
  const share = await loadShare(m[1]);
  if (!share.allowEmbed) throw new HttpError(403, 'FORBIDDEN', 'Embedding is disabled for this video');
  const v = share.video;
  const ratio = v.width && v.height ? v.height / v.width : 9 / 16;
  let width = Math.min(q.maxwidth ?? 640, 1920);
  let height = Math.round(width * ratio);
  if (q.maxheight && height > q.maxheight) {
    height = q.maxheight;
    width = Math.round(height / ratio);
  }
  res.json({
    type: 'video',
    version: '1.0',
    title: v.filename,
    author_name: v.user.name,
    provider_name: 'VidVault',
    provider_url: config.appUrl,
    width,
    height,
    html: embedCode(share.token, width, height),
    ...(v.thumbnailKey && !share.passwordHash ? { thumbnail_url: posterUrl(share.token), thumbnail_width: 640, thumbnail_height: Math.round(640 * ratio) } : {}),
  });
});

/** Values injected into the HTML of /s/:token and /embed/:token for link previews. */
export async function sharePreview(token: string) {
  try {
    const share = await loadShare(token);
    const v = share.video;
    return {
      title: v.filename,
      description: `Video shared by ${v.user.name} on VidVault`,
      url: shareUrl(share.token),
      image: v.thumbnailKey && !share.passwordHash ? posterUrl(share.token) : null,
      video: share.passwordHash ? null : streamUrl(share.token),
      embed: embedUrl(share.token),
      width: v.width ?? 1280,
      height: v.height ?? 720,
      allowEmbed: share.allowEmbed,
      oembed: `${config.appUrl}/api/public/oembed?url=${encodeURIComponent(shareUrl(share.token))}`,
    };
  } catch {
    return null;
  }
}

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
