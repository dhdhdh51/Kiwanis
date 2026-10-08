import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { getDummyHash, hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { HttpError, unauthorized } from '../lib/errors.js';
import { sendMail } from '../lib/mailer.js';
import { clearSessionCookie, createSession, newApiToken, requireAuth } from '../middleware/auth.js';
import { limits } from '../middleware/rateLimit.js';
import { recordActivity } from '../services/activity.js';
import { getUsedBytes } from '../services/videos.js';

export const authRouter = Router();

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

export async function publicUser(user: { id: string; email: string; name: string; role: string; storageLimit: bigint; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    storageLimit: Number(user.storageLimit),
    storageUsed: Number(await getUsedBytes(user.id)),
    createdAt: user.createdAt,
  };
}

authRouter.post('/register', limits.register, async (req, res) => {
  const body = z
    .object({ name: z.string().trim().min(1).max(100), email, password })
    .parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw new HttpError(409, 'CONFLICT', 'An account with this email already exists');
  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      passwordHash: await hashPassword(body.password),
      storageLimit: config.upload.defaultStorageLimit,
      role: config.admin.email && config.admin.email.toLowerCase() === body.email ? 'ADMIN' : 'USER',
      lastLoginAt: new Date(),
    },
  });
  await createSession(req, res, user.id);
  recordActivity('auth.register', `${user.email} registered`, { userId: user.id, ip: req.ip });
  res.status(201).json({ user: await publicUser(user) });
});

authRouter.post('/login', limits.login, async (req, res) => {
  const body = z.object({ email, password: z.string().min(1).max(128) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  // Always run a hash verification to keep response timing uniform.
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), body.password);
  if (!user || !ok) {
    recordActivity('auth.login_failed', `Failed login for ${body.email}`, { userId: user?.id, ip: req.ip });
    throw new HttpError(401, 'UNAUTHORIZED', 'Incorrect email or password');
  }
  if (user.status === 'SUSPENDED') {
    throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Contact your administrator.');
  }
  await createSession(req, res, user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  recordActivity('auth.login', `${user.email} signed in`, { userId: user.id, ip: req.ip });
  res.json({ user: await publicUser(user) });
});

/**
 * Sign in from a device (Android app, scripts) and receive a long-lived Bearer token
 * instead of a cookie. Send it as `Authorization: Bearer vv_...`.
 */
authRouter.post('/token', limits.login, async (req, res) => {
  const body = z
    .object({ email, password: z.string().min(1).max(128), deviceName: z.string().trim().min(1).max(100).optional() })
    .parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), body.password);
  if (!user || !ok) {
    recordActivity('auth.login_failed', `Failed app sign-in for ${body.email}`, { userId: user?.id, ip: req.ip });
    throw new HttpError(401, 'UNAUTHORIZED', 'Incorrect email or password');
  }
  if (user.status === 'SUSPENDED') {
    throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Contact your administrator.');
  }
  const token = newApiToken();
  await prisma.apiToken.create({
    data: { userId: user.id, name: body.deviceName ?? 'Device', kind: 'app', tokenHash: sha256(token), prefix: token.slice(0, 10) },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  recordActivity('auth.login', `${user.email} signed in from ${body.deviceName ?? 'a device'}`, { userId: user.id, ip: req.ip });
  res.status(201).json({ token, user: await publicUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  if (req.apiTokenId) {
    await prisma.apiToken.delete({ where: { id: req.apiTokenId } }).catch(() => undefined);
    return res.json({ ok: true });
  }
  if (req.sessionId) await prisma.session.delete({ where: { id: req.sessionId } }).catch(() => undefined);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  if (!req.user) throw unauthorized();
  res.json({ user: await publicUser(req.user) });
});

authRouter.post('/forgot-password', limits.passwordReset, async (req, res) => {
  const body = z.object({ email }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (user && user.status === 'ACTIVE') {
    const token = randomToken(32);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) },
    });
    const link = `${config.appUrl}/reset-password?token=${token}`;
    await sendMail(
      user.email,
      'Reset your VidVault password',
      `Hi ${user.name},\n\nWe received a request to reset your password. Use the link below within 1 hour:\n\n${link}\n\nIf you didn't request this, you can ignore this email.`,
    );
  }
  // Identical response whether or not the account exists (prevents account enumeration).
  res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
});

authRouter.post('/reset-password', limits.passwordReset, async (req, res) => {
  const body = z.object({ token: z.string().min(20).max(200), password }).parse(req.body);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(body.token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new HttpError(400, 'BAD_REQUEST', 'This reset link is invalid or has expired. Please request a new one.');
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(body.password) } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Sign out everywhere after a reset (browsers and devices)
    prisma.session.deleteMany({ where: { userId: record.userId } }),
    prisma.apiToken.deleteMany({ where: { userId: record.userId, kind: 'app' } }),
  ]);
  recordActivity('auth.password_reset', 'Password reset completed', { userId: record.userId, ip: req.ip });
  res.json({ ok: true });
});

// ---------- Account settings ----------

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.patch('/', async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
  const user = await prisma.user.update({ where: { id: req.user!.id }, data: { name: body.name } });
  res.json({ user: await publicUser(user) });
});

meRouter.post('/password', limits.login, async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
    throw new HttpError(400, 'BAD_REQUEST', 'Current password is incorrect');
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword) } }),
    prisma.session.deleteMany({ where: { userId: user.id, id: { not: req.sessionId } } }),
  ]);
  res.json({ ok: true });
});

meRouter.get('/stats', async (req, res) => {
  const userId = req.user!.id;
  const [used, ready, trash, folders, uploading, byFormat] = await Promise.all([
    getUsedBytes(userId),
    prisma.video.aggregate({ where: { userId, status: { in: ['READY', 'PROCESSING'] }, deletedAt: null }, _sum: { size: true }, _count: true }),
    prisma.video.aggregate({ where: { userId, deletedAt: { not: null } }, _sum: { size: true }, _count: true }),
    prisma.folder.count({ where: { userId } }),
    prisma.uploadSession.count({ where: { userId, status: 'ACTIVE' } }),
    prisma.video.groupBy({
      by: ['format'],
      where: { userId, status: { in: ['READY', 'PROCESSING'] }, deletedAt: null },
      _sum: { size: true },
      _count: true,
    }),
  ]);
  const limit = req.user!.storageLimit;
  res.json({
    storageLimit: Number(limit),
    storageUsed: Number(used),
    storageAvailable: Math.max(0, Number(limit - used)),
    videoCount: ready._count,
    totalUploadedSize: Number(ready._sum.size ?? 0n),
    trashCount: trash._count,
    trashSize: Number(trash._sum.size ?? 0n),
    folderCount: folders,
    activeUploads: uploading,
    byFormat: byFormat.map((f) => ({ format: f.format, count: f._count, size: Number(f._sum.size ?? 0n) })),
  });
});

// ---------- API keys & signed-in devices ----------

meRouter.get('/tokens', async (req, res) => {
  const tokens = await prisma.apiToken.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
  res.json({
    tokens: tokens.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      prefix: t.prefix,
      lastUsedAt: t.lastUsedAt,
      createdAt: t.createdAt,
      current: t.id === req.apiTokenId,
    })),
  });
});

/** Create a developer API key. The full key is returned only once. */
meRouter.post('/tokens', async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
  const count = await prisma.apiToken.count({ where: { userId: req.user!.id, kind: 'key' } });
  if (count >= 25) throw new HttpError(400, 'BAD_REQUEST', 'You can have at most 25 API keys. Revoke one first.');
  const token = newApiToken();
  const t = await prisma.apiToken.create({
    data: { userId: req.user!.id, name: body.name, kind: 'key', tokenHash: sha256(token), prefix: token.slice(0, 10) },
  });
  res.status(201).json({ token, id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt });
});

meRouter.delete('/tokens/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { count } = await prisma.apiToken.deleteMany({ where: { id, userId: req.user!.id } });
  if (!count) throw new HttpError(404, 'NOT_FOUND', 'Key not found');
  res.json({ ok: true });
});
