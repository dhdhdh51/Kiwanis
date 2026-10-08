import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { formatFor } from '../lib/formats.js';
import { logger } from '../lib/logger.js';
import { keys, storage } from '../storage/index.js';

/**
 * Post-upload processing (metadata probe, thumbnail, optional renditions).
 *
 * This is a small in-process, DB-backed work queue: the database `status` column is the
 * source of truth, so pending work is recovered on restart. For horizontal scale, move
 * `processVideo` into a dedicated worker fed by a durable queue (SQS, BullMQ, ...).
 */

const CONCURRENCY = 2;
const queue: string[] = [];
let running = 0;
let ffmpegOk: Promise<boolean> | undefined;

function run(cmd: string, args: string[], timeoutMs = 10 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(cmd)} exited with ${code}: ${err.trim().split('\n').pop()}`));
    });
  });
}

export function ffmpegAvailable() {
  return (ffmpegOk ??= Promise.all([run(config.processing.ffprobe, ['-version'], 10_000), run(config.processing.ffmpeg, ['-version'], 10_000)])
    .then(() => true)
    .catch(() => {
      logger.info('ffmpeg/ffprobe not found — server-side thumbnails and renditions disabled (client-side extraction still applies)');
      return false;
    }));
}

async function probe(input: string) {
  const out = await run(config.processing.ffprobe, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-select_streams', 'v:0', input,
  ], 120_000);
  const json = JSON.parse(out) as { format?: { duration?: string }; streams?: { width?: number; height?: number; duration?: string }[] };
  const s = json.streams?.[0];
  const duration = Number(json.format?.duration ?? s?.duration);
  return { duration: Number.isFinite(duration) ? duration : null, width: s?.width ?? null, height: s?.height ?? null };
}

async function withTmpDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vidvault-'));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function processVideo(videoId: string) {
  const v = await prisma.video.findUnique({ where: { id: videoId } });
  if (!v || v.status !== 'PROCESSING') return;

  const update: { duration?: number; width?: number; height?: number; thumbnailKey?: string; processingError?: string | null } = {};
  const hasFfmpeg = await ffmpegAvailable();
  let input: string | undefined;

  if (hasFfmpeg) {
    try {
      input = await storage.processingInput(v.storageKey);
      const meta = await probe(input);
      if (meta.duration) update.duration = meta.duration;
      if (meta.width) update.width = meta.width;
      if (meta.height) update.height = meta.height;

      if (!v.thumbnailKey) {
        const at = Math.min(3, (meta.duration ?? 2) * 0.1);
        await withTmpDir(async (dir) => {
          const out = path.join(dir, 'thumb.jpg');
          await run(config.processing.ffmpeg, ['-ss', at.toFixed(2), '-i', input!, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', '-y', out], 120_000);
          const key = keys.thumbnail(v.userId, v.id);
          await storage.putObject(key, await fsp.readFile(out), 'image/jpeg');
          update.thumbnailKey = key;
        });
      }
    } catch (err) {
      logger.warn({ err, videoId }, 'video probe/thumbnail failed');
      update.processingError = 'Could not extract video metadata on the server';
    }
  }

  await prisma.video.update({ where: { id: v.id }, data: { ...update, status: 'READY' } });

  if (hasFfmpeg && input && config.processing.transcode) {
    await generateRenditions(v.id, input).catch((err) => logger.warn({ err, videoId }, 'rendition generation failed'));
  }
}

/** Generates lower-resolution H.264 MP4 renditions so the player can offer quality selection. */
async function generateRenditions(videoId: string, input: string) {
  const v = await prisma.video.findUnique({ where: { id: videoId } });
  if (!v?.height) return;
  const playable = formatFor(`x.${v.format}`)?.browserPlayable ?? false;
  const targets = [720, 480].filter((h) => h < v.height!);
  // Non-browser formats (MKV/AVI) always get a web-friendly copy.
  if (!playable && !targets.length) targets.push(v.height);

  for (const height of targets) {
    const label = `${height}p`;
    await withTmpDir(async (dir) => {
      const out = path.join(dir, `${label}.mp4`);
      await run(config.processing.ffmpeg, [
        '-i', input, '-vf', `scale=-2:${height}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', out,
      ], 6 * 3600_000);
      const key = keys.rendition(v.userId, v.id, label);
      const { size } = await fsp.stat(out);
      await storage.putObject(key, fs.createReadStream(out), 'video/mp4', size);
      await prisma.rendition.upsert({
        where: { videoId_label: { videoId: v.id, label } },
        create: { videoId: v.id, label, height, mimeType: 'video/mp4', size: BigInt(size), storageKey: key },
        update: { size: BigInt(size), storageKey: key },
      });
    });
  }
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    running++;
    processVideo(id)
      .catch(async (err) => {
        logger.error({ err, videoId: id }, 'processing failed');
        await prisma.video
          .update({ where: { id }, data: { status: 'READY', processingError: 'Processing failed' } })
          .catch(() => undefined);
      })
      .finally(() => {
        running--;
        pump();
      });
  }
}

export function enqueueProcessing(videoId: string) {
  if (!queue.includes(videoId)) queue.push(videoId);
  pump();
}

/** Re-enqueue work interrupted by a restart. */
export async function recoverProcessing() {
  const pending = await prisma.video.findMany({ where: { status: 'PROCESSING' }, select: { id: true } });
  pending.forEach((v) => enqueueProcessing(v.id));
}
