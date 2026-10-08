import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { Router, type Request, type Response } from 'express';
import { bucketedExpiry, randomToken, signToken, verifyToken } from '../lib/crypto.js';
import type { PresignedRequest, SignedUrlOptions, StorageDriver, UploadedPart } from './types.js';

const PART_PURPOSE = 'local-part';
const GET_PURPOSE = 'local-get';

interface PartToken {
  k: string;
  u: string;
  p: number;
  n: number;
  exp: number;
}
interface GetToken {
  k: string;
  d?: 'inline' | 'attachment';
  f?: string;
  ct?: string;
  exp: number;
}

/**
 * Filesystem driver emulating S3 semantics (multipart uploads + presigned URLs).
 * Suitable for development and single-node deployments; use the S3 driver to scale out.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local' as const;
  private objectsDir: string;
  private multipartDir: string;

  constructor(private root: string) {
    this.objectsDir = path.join(root, 'objects');
    this.multipartDir = path.join(root, 'multipart');
    fs.mkdirSync(this.objectsDir, { recursive: true });
    fs.mkdirSync(this.multipartDir, { recursive: true });
  }

  private objectPath(key: string) {
    const p = path.resolve(this.objectsDir, key);
    if (!p.startsWith(this.objectsDir + path.sep)) throw new Error('Invalid storage key');
    return p;
  }

  private uploadDir(uploadId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(uploadId)) throw new Error('Invalid upload id');
    return path.join(this.multipartDir, uploadId);
  }

  async createMultipartUpload(key: string) {
    const uploadId = randomToken(18);
    const dir = this.uploadDir(uploadId);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ key }));
    return uploadId;
  }

  async presignPart(key: string, uploadId: string, partNumber: number, contentLength: number): Promise<PresignedRequest> {
    const t = signToken({ k: key, u: uploadId, p: partNumber, n: contentLength, exp: bucketedExpiry(3600, 600) }, PART_PURPOSE);
    return { url: `/api/storage/local/part?t=${t}`, method: 'PUT' };
  }

  async listParts(_key: string, uploadId: string): Promise<UploadedPart[]> {
    const dir = this.uploadDir(uploadId);
    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      return [];
    }
    const parts: UploadedPart[] = [];
    for (const name of entries) {
      const m = /^(\d+)\.part$/.exec(name);
      if (!m) continue;
      const st = await fsp.stat(path.join(dir, name));
      parts.push({ partNumber: Number(m[1]), size: st.size });
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]) {
    const dir = this.uploadDir(uploadId);
    const dest = this.objectPath(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${randomToken(6)}.tmp`;
    const out = fs.createWriteStream(tmp);
    try {
      for (const part of [...parts].sort((a, b) => a.partNumber - b.partNumber)) {
        await pipeline(fs.createReadStream(path.join(dir, `${part.partNumber}.part`)), out, { end: false });
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      await fsp.rename(tmp, dest);
    } catch (err) {
      out.destroy();
      await fsp.rm(tmp, { force: true });
      throw err;
    }
    await fsp.rm(dir, { recursive: true, force: true });
  }

  async abortMultipartUpload(_key: string, uploadId: string) {
    await fsp.rm(this.uploadDir(uploadId), { recursive: true, force: true });
  }

  async putObject(key: string, body: Buffer | Readable) {
    const dest = this.objectPath(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${randomToken(6)}.tmp`;
    if (Buffer.isBuffer(body)) await fsp.writeFile(tmp, body);
    else await pipeline(body, fs.createWriteStream(tmp));
    await fsp.rename(tmp, dest);
  }

  async getObjectStream(key: string, range?: { start: number; end: number }) {
    return fs.createReadStream(this.objectPath(key), range ? { start: range.start, end: range.end } : undefined);
  }

  async readRange(key: string, start: number, end: number) {
    const fh = await fsp.open(this.objectPath(key), 'r');
    try {
      const buf = Buffer.alloc(end - start + 1);
      const { bytesRead } = await fh.read(buf, 0, buf.length, start);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }

  async headObject(key: string) {
    try {
      const st = await fsp.stat(this.objectPath(key));
      return { size: st.size };
    } catch {
      return null;
    }
  }

  async deleteObject(key: string) {
    await fsp.rm(this.objectPath(key), { force: true });
  }

  async signedGetUrl(key: string, opts: SignedUrlOptions) {
    const t = signToken(
      { k: key, d: opts.disposition, f: opts.filename, ct: opts.contentType, exp: bucketedExpiry(opts.expiresIn) },
      GET_PURPOSE,
    );
    return `/api/storage/local/object?t=${t}`;
  }

  async processingInput(key: string) {
    return this.objectPath(key);
  }

  /** HTTP endpoints that stand in for S3's presigned PUT/GET when using local storage. */
  router() {
    const r = Router();

    r.put('/part', async (req: Request, res: Response) => {
      const tok = verifyToken<PartToken>(req.query.t as string, PART_PURPOSE);
      if (!tok) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Upload URL is invalid or expired' } });
      const dir = this.uploadDir(tok.u);
      if (!fs.existsSync(path.join(dir, 'meta.json'))) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Upload session no longer exists' } });
      }
      const declared = Number(req.headers['content-length'] ?? NaN);
      if (Number.isFinite(declared) && declared !== tok.n) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Chunk size mismatch' } });
      }
      const tmp = path.join(dir, `${tok.p}.${randomToken(6)}.tmp`);
      let received = 0;
      const out = fs.createWriteStream(tmp);
      try {
        await pipeline(
          req,
          async function* (source: AsyncIterable<Buffer>) {
            for await (const chunk of source) {
              received += chunk.length;
              if (received > tok.n) throw Object.assign(new Error('Chunk too large'), { status: 413 });
              yield chunk;
            }
          },
          out,
        );
        if (received !== tok.n) throw Object.assign(new Error('Incomplete chunk'), { status: 400 });
        await fsp.rename(tmp, path.join(dir, `${tok.p}.part`));
        res.setHeader('ETag', `"${tok.p}-${received}"`);
        return res.status(200).end();
      } catch (err) {
        await fsp.rm(tmp, { force: true });
        const status = (err as { status?: number }).status ?? 500;
        if (!res.headersSent) res.status(status).json({ error: { code: 'BAD_REQUEST', message: (err as Error).message } });
      }
    });

    r.get('/object', async (req: Request, res: Response) => {
      const tok = verifyToken<GetToken>(req.query.t as string, GET_PURPOSE);
      if (!tok) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Link is invalid or expired' } });
      let size: number;
      try {
        size = (await fsp.stat(this.objectPath(tok.k))).size;
      } catch {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Object not found' } });
      }
      res.setHeader('Accept-Ranges', 'bytes');
      // Signed, expiring URL: safe to load from other websites (<video>/<img> on embedding pages).
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', tok.ct ?? 'application/octet-stream');
      res.setHeader('Cache-Control', `private, max-age=${Math.max(0, tok.exp - Math.floor(Date.now() / 1000))}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (tok.d) {
        const name = tok.f ?? path.basename(tok.k);
        res.setHeader(
          'Content-Disposition',
          `${tok.d}; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        );
      }
      let start = 0;
      let end = size - 1;
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!m || (m[1] === '' && m[2] === '')) {
          res.setHeader('Content-Range', `bytes */${size}`);
          return res.status(416).end();
        }
        if (m[1] === '') {
          start = Math.max(0, size - Number(m[2]));
        } else {
          start = Number(m[1]);
          end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        }
        if (start > end || start >= size) {
          res.setHeader('Content-Range', `bytes */${size}`);
          return res.status(416).end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      }
      res.setHeader('Content-Length', String(size === 0 ? 0 : end - start + 1));
      if (req.method === 'HEAD' || size === 0) return res.end();
      const stream = fs.createReadStream(this.objectPath(tok.k), { start, end });
      stream.on('error', () => res.destroy());
      req.on('close', () => stream.destroy());
      stream.pipe(res);
    });

    return r;
  }
}
