import { config } from '../config.js';
import { LocalStorageDriver } from './local.js';
import { S3StorageDriver } from './s3.js';
import type { StorageDriver } from './types.js';

export const localDriver = config.storage.driver === 'local' ? new LocalStorageDriver(config.storage.localDir) : null;

export const storage: StorageDriver = localDriver ?? new S3StorageDriver(config.storage.s3);

export const keys = {
  video: (userId: string, videoId: string, ext: string) => `users/${userId}/videos/${videoId}.${ext}`,
  thumbnail: (userId: string, videoId: string, ext = 'jpg') => `users/${userId}/thumbnails/${videoId}.${ext}`,
  rendition: (userId: string, videoId: string, label: string) => `users/${userId}/renditions/${videoId}-${label}.mp4`,
};

export type { StorageDriver } from './types.js';
