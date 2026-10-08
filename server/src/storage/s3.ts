import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import type { Readable } from 'node:stream';
import type { AppConfig } from '../config.js';
import type { PresignedRequest, SignedUrlOptions, StorageDriver, UploadedPart } from './types.js';

/** Rounds the signing time down to a bucket so identical requests share a cache-friendly URL. */
function signingDate(bucketSeconds: number) {
  const ms = bucketSeconds * 1000;
  return new Date(Math.floor(Date.now() / ms) * ms);
}

function contentDisposition(type: 'inline' | 'attachment', filename?: string) {
  if (!filename) return type;
  return `${type}; filename="${filename.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Works with AWS S3 and S3-compatible stores (MinIO, Cloudflare R2, Backblaze B2, Wasabi, ...). */
export class S3StorageDriver implements StorageDriver {
  readonly name = 's3' as const;
  private client: S3Client;
  /** Client configured with the browser-facing endpoint, used only for presigning. */
  private presigner: S3Client;
  private bucket: string;

  constructor(cfg: AppConfig['storage']['s3']) {
    const base: S3ClientConfig = {
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials:
        cfg.accessKeyId && cfg.secretAccessKey
          ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
          : undefined,
      // Only compute checksums when required, so plain presigned PUTs from browsers stay valid.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
    this.client = new S3Client({ ...base, endpoint: cfg.endpoint });
    this.presigner = new S3Client({ ...base, endpoint: cfg.publicEndpoint });
    this.bucket = cfg.bucket;
  }

  async createMultipartUpload(key: string, contentType: string) {
    const out = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    );
    if (!out.UploadId) throw new Error('Storage did not return an upload id');
    return out.UploadId;
  }

  async presignPart(key: string, uploadId: string, partNumber: number, contentLength: number): Promise<PresignedRequest> {
    const url = await getSignedUrl(
      this.presigner,
      new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: contentLength }),
      { expiresIn: 3600 },
    );
    return { url, method: 'PUT' };
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    for (;;) {
      const out = await this.client.send(
        new ListPartsCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker, MaxParts: 1000 }),
      );
      for (const p of out.Parts ?? []) {
        if (p.PartNumber) parts.push({ partNumber: p.PartNumber, size: p.Size ?? 0, etag: p.ETag });
      }
      if (!out.IsTruncated) break;
      marker = out.NextPartNumberMarker;
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]) {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string) {
    try {
      await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
    } catch (err) {
      if ((err as { name?: string }).name !== 'NoSuchUpload') throw err;
    }
  }

  async putObject(key: string, body: Buffer | Readable, contentType: string) {
    await new Upload({ client: this.client, params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType } }).done();
  }

  async getObjectStream(key: string, range?: { start: number; end: number }) {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }),
    );
    return out.Body as Readable;
  }

  async readRange(key: string, start: number, end: number) {
    const stream = await this.getObjectStream(key, { start, end });
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  }

  async headObject(key: string) {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: out.ContentLength ?? 0 };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedGetUrl(key: string, opts: SignedUrlOptions) {
    const bucketSeconds = 3600;
    return getSignedUrl(
      this.presigner,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: opts.contentType,
        ResponseContentDisposition: opts.disposition ? contentDisposition(opts.disposition, opts.filename) : undefined,
      }),
      // Signing time is bucketed, so extend validity by one bucket to guarantee `expiresIn`.
      { expiresIn: Math.min(604800, opts.expiresIn + bucketSeconds), signingDate: signingDate(bucketSeconds) },
    );
  }

  async processingInput(key: string) {
    // ffmpeg reads straight from storage over HTTPS (supports range requests / seeking).
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: 6 * 3600 });
  }
}
