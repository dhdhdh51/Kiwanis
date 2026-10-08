export type Role = 'USER' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  storageLimit: number;
  storageUsed: number;
  createdAt: string;
}

export interface Share {
  token: string;
  url: string;
  isPublic: boolean;
  hasPassword: boolean;
  expiresAt: string | null;
  allowDownload: boolean;
  views: number;
  active: boolean;
  expired: boolean;
  createdAt: string;
}

export type VideoStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

export interface Video {
  id: string;
  filename: string;
  originalFilename: string;
  format: string;
  mimeType: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  folderId: string | null;
  folder: { id: string; name: string } | null;
  status: VideoStatus;
  processingError: string | null;
  browserPlayable: boolean;
  qualities: string[];
  thumbnailUrl: string | null;
  share: Share | null;
  uploadedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  videoCount: number;
  totalSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Stats {
  storageLimit: number;
  storageUsed: number;
  storageAvailable: number;
  videoCount: number;
  totalUploadedSize: number;
  trashCount: number;
  trashSize: number;
  folderCount: number;
  activeUploads: number;
  byFormat: { format: string; count: number; size: number }[];
}

export interface PlaybackSource {
  label: string;
  height: number;
  mimeType: string;
  url: string;
}

export interface Playback {
  sources: PlaybackSource[];
  poster: string | null;
  downloadUrl: string | null;
}

export interface AppConfig {
  maxFileSize: number;
  formats: { ext: string; mime: string; aliases: string[]; browserPlayable: boolean }[];
  maxConcurrentFiles: number;
  maxConcurrentChunks: number;
  storageDriver: 'local' | 's3';
}

export type SortKey = 'newest' | 'oldest' | 'largest' | 'smallest' | 'name_asc' | 'name_desc';
