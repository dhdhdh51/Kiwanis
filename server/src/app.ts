import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './lib/logger.js';
import { csrfGuard, loadUser } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { limits } from './middleware/rateLimit.js';
import { adminRouter } from './routes/admin.js';
import { authRouter, meRouter } from './routes/auth.js';
import { foldersRouter } from './routes/folders.js';
import { configRouter, publicRouter, sharePreview } from './routes/public.js';
import { uploadsRouter } from './routes/uploads.js';
import { videosRouter } from './routes/videos.js';
import { localDriver } from './storage/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  const storageOrigin = config.storage.driver === 's3' && config.storage.s3.publicEndpoint
    ? new URL(config.storage.s3.publicEndpoint).origin
    : config.storage.driver === 's3'
      ? `https://*.amazonaws.com`
      : null;
  const extra = storageOrigin ? [storageOrigin] : [];

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', ...extra],
          mediaSrc: ["'self'", 'blob:', ...extra],
          connectSrc: ["'self'", ...extra],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/storage/') || req.url === '/api/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug'),
    }),
  );

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });

  // Local storage "presigned URL" endpoints: token-authenticated, raw bodies, no cookies/CSRF needed.
  if (localDriver) app.use('/api/storage/local', localDriver.router());

  // CORS for the developer API: other websites may call it with an API key (Bearer token).
  // Cookies are never accepted cross-origin (no Allow-Credentials, and X-Requested-With is not allowed),
  // so browser sessions stay protected.
  app.use('/api', (req, res, next) => {
    if (!req.get('origin') || req.get('origin') === config.appOrigin || req.path.startsWith('/public/')) return next();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.use('/api', express.json({ limit: '1mb' }), cookieParser(), loadUser, csrfGuard, limits.api);
  app.use('/api/config', configRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/videos', videosRouter);
  app.use('/api/folders', foldersRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/public', publicRouter);
  app.use('/api', notFoundHandler);

  // Android app download (APK placed in DOWNLOADS_DIR by the deploy process)
  const downloadsDir = process.env.DOWNLOADS_DIR ? path.resolve(process.env.DOWNLOADS_DIR) : null;
  app.get('/download/android', (_req, res) => {
    const apk = downloadsDir && path.join(downloadsDir, 'vidvault.apk');
    if (!apk || !fs.existsSync(apk)) return res.status(404).type('text').send('The Android app is not available on this server yet.');
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.download(apk, 'VidVault.apk');
  });

  // Production: serve the built SPA from the same origin.
  const webDist = process.env.WEB_DIST_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders: (res, p) => {
          // Only hashed build assets are immutable.
          res.setHeader('Cache-Control', p.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
    const indexHtml = () => fs.readFileSync(path.join(webDist, 'index.html'), 'utf8');
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Share & embed pages get Open Graph / oEmbed tags so links unfurl in WhatsApp, Telegram, Facebook, WordPress…
    app.get(/^\/(s|embed)\/([A-Za-z0-9_-]{10,64})\/?$/, async (req, res) => {
      const [, kind, token] = /^\/(s|embed)\/([A-Za-z0-9_-]+)/.exec(req.path)!;
      const pv = await sharePreview(token);
      let html = indexHtml();
      if (pv) {
        const tags = [
          `<meta property="og:type" content="video.other">`,
          `<meta property="og:site_name" content="VidVault">`,
          `<meta property="og:title" content="${esc(pv.title)}">`,
          `<meta property="og:description" content="${esc(pv.description)}">`,
          `<meta property="og:url" content="${esc(pv.url)}">`,
          pv.image && `<meta property="og:image" content="${esc(pv.image)}">`,
          pv.video && `<meta property="og:video" content="${esc(pv.video)}">`,
          pv.video && `<meta property="og:video:type" content="video/mp4">`,
          pv.allowEmbed && `<meta name="twitter:card" content="player">`,
          pv.allowEmbed && `<meta name="twitter:player" content="${esc(pv.embed)}">`,
          pv.allowEmbed && `<meta name="twitter:player:width" content="${pv.width}">`,
          pv.allowEmbed && `<meta name="twitter:player:height" content="${pv.height}">`,
          pv.allowEmbed && `<link rel="alternate" type="application/json+oembed" href="${esc(pv.oembed)}" title="${esc(pv.title)}">`,
          `<link rel="canonical" href="${esc(pv.url)}">`,
        ].filter(Boolean);
        html = html.replace(/<title>.*?<\/title>/, `<title>${esc(pv.title)} — VidVault</title>\n    ${tags.join('\n    ')}`);
      }
      if (kind === 'embed') {
        // The embed player is the only page other sites may frame — and only if the owner allows it.
        res.removeHeader('X-Frame-Options');
        const csp = String(res.getHeader('Content-Security-Policy') ?? '');
        res.setHeader('Content-Security-Policy', csp.replace(/frame-ancestors [^;]+/, `frame-ancestors ${pv?.allowEmbed ? '*' : "'none'"}`));
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(html);
    });

    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
