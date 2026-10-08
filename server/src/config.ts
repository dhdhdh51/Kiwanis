import path from 'node:path';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().finite().nonnegative());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: num(4000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: num(0),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  DATABASE_URL: z.string().min(1),
  ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
  ADMIN_PASSWORD: z.string().optional(),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage-data'),
  S3_BUCKET: z.string().default('vidvault'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().optional(),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,

  DEFAULT_STORAGE_LIMIT_GB: num(100),
  MAX_FILE_SIZE_GB: num(20),
  UPLOAD_CHUNK_SIZE_MB: num(16),
  MAX_CONCURRENT_FILES: num(4),
  MAX_CONCURRENT_CHUNKS: num(4),
  UPLOAD_SESSION_TTL_HOURS: num(48),
  TRASH_RETENTION_DAYS: num(30),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  TRANSCODE_RENDITIONS: bool,

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('VidVault <no-reply@example.com>'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}
const env = parsed.data;

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  appUrl: env.APP_URL.replace(/\/$/, ''),
  appOrigin: new URL(env.APP_URL).origin,
  trustProxy: env.TRUST_PROXY,
  secret: env.APP_SECRET,
  admin: { email: env.ADMIN_EMAIL || undefined, password: env.ADMIN_PASSWORD || undefined },

  storage: {
    driver: env.STORAGE_DRIVER,
    localDir: path.resolve(env.LOCAL_STORAGE_DIR),
    s3: {
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      publicEndpoint: env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT || undefined,
      accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
  },

  upload: {
    defaultStorageLimit: BigInt(Math.round(env.DEFAULT_STORAGE_LIMIT_GB * GB)),
    maxFileSize: Math.round(env.MAX_FILE_SIZE_GB * GB),
    // S3 multipart: parts must be >= 5 MiB (except last) and at most 10,000 parts.
    chunkSize: Math.max(5 * MB, Math.round(env.UPLOAD_CHUNK_SIZE_MB * MB)),
    maxParts: 10_000,
    maxConcurrentFiles: Math.max(1, Math.min(10, env.MAX_CONCURRENT_FILES)),
    maxConcurrentChunks: Math.max(1, Math.min(10, env.MAX_CONCURRENT_CHUNKS)),
    sessionTtlMs: env.UPLOAD_SESSION_TTL_HOURS * 3600_000,
    trashRetentionMs: env.TRASH_RETENTION_DAYS * 86400_000,
  },

  processing: {
    ffmpeg: env.FFMPEG_PATH,
    ffprobe: env.FFPROBE_PATH,
    transcode: env.TRANSCODE_RENDITIONS,
  },

  mail: { smtpUrl: env.SMTP_URL || undefined, from: env.MAIL_FROM },

  session: {
    cookieName: 'vv_session',
    ttlMs: 30 * 86400_000,
  },
};

export type AppConfig = typeof config;
