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
import { configRouter, publicRouter } from './routes/public.js';
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

  // Production: serve the built SPA from the same origin.
  const webDist = process.env.WEB_DIST_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1y', immutable: true, setHeaders: (res, p) => {
      if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    } }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
