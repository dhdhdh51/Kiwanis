import { config } from './config.js';
import { prisma } from './db.js';
import { createApp } from './app.js';
import { hashPassword } from './lib/crypto.js';
import { logger } from './lib/logger.js';
import { startMaintenance } from './services/maintenance.js';
import { recoverProcessing } from './services/processing.js';

async function ensureAdmin() {
  const { email, password } = config.admin;
  if (!email || !password) return;
  const normalized = email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) {
    if (existing.role !== 'ADMIN') await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } });
    return;
  }
  await prisma.user.create({
    data: {
      email: normalized,
      name: 'Administrator',
      passwordHash: await hashPassword(password),
      role: 'ADMIN',
      storageLimit: config.upload.defaultStorageLimit,
    },
  });
  logger.info({ email: normalized }, 'bootstrap administrator created');
}

async function main() {
  await prisma.$connect();
  await ensureAdmin();
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`VidVault API listening on :${config.port} (storage: ${config.storage.driver})`);
  });
  // Large chunk uploads over slow links need generous timeouts.
  server.requestTimeout = 30 * 60_000;
  server.headersTimeout = 65_000;
  server.keepAliveTimeout = 61_000;

  await recoverProcessing();
  const maintenance = startMaintenance();

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    clearInterval(maintenance);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
