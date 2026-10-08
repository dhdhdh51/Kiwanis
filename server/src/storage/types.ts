import type { Readable } from 'node:stream';

export interface PresignedRequest {
  url: string;
  method: 'PUT';
  headers?: Record<string, string>;
}

export interface UploadedPart {
  partNumber: number;
  size: number;
  etag?: string;
}

export interface SignedUrlOptions {
  /** Minimum validity in seconds */
  expiresIn: number;
  disposition?: 'inline' | 'attachment';
  filename?: string;
  contentType?: string;
}

/**
 * Object storage abstraction. Every driver behaves like S3 multipart uploads so the browser
 * can upload chunks directly to storage via short-lived presigned URLs — the API server never
 * proxies video bytes when an S3-compatible backend is used, and credentials never leave the server.
 */
export interface StorageDriver {
  readonly name: 'local' | 's3';
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  presignPart(key: string, uploadId: string, partNumber: number, contentLength: number): Promise<PresignedRequest>;
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;

  putObject(key: string, body: Buffer | Readable, contentType: string, contentLength?: number): Promise<void>;
  getObjectStream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  readRange(key: string, start: number, end: number): Promise<Buffer>;
  headObject(key: string): Promise<{ size: number } | null>;
  deleteObject(key: string): Promise<void>;

  /** Short-lived URL the browser can GET (supports HTTP Range for streaming). */
  signedGetUrl(key: string, opts: SignedUrlOptions): Promise<string>;
  /** Input path/URL ffmpeg can read directly. */
  processingInput(key: string): Promise<string>;
}
