import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, qs } from './api';
import type { AppConfig, Folder, Paged, SortKey, Stats, Video } from './types';

export interface VideoFilters {
  q?: string;
  folderId?: string;
  format?: string;
  from?: string;
  to?: string;
  minSize?: number;
  maxSize?: number;
  minDuration?: number;
  maxDuration?: number;
  shared?: boolean;
  sort?: SortKey;
}

export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api<AppConfig>('/api/config'), staleTime: Infinity });
}

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/api/me/stats') });
}

export function useVideos(filters: VideoFilters) {
  return useInfiniteQuery({
    queryKey: ['videos', filters],
    queryFn: ({ pageParam }) =>
      api<Paged<Video>>(`/api/videos${qs({ ...filters, shared: filters.shared ? 'true' : undefined, page: pageParam, pageSize: 40 })}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    placeholderData: (prev) => prev,
  });
}

export function useRecent() {
  return useQuery({ queryKey: ['videos', 'recent'], queryFn: () => api<{ items: Video[] }>('/api/videos/recent') });
}

export function useTrash() {
  return useQuery({ queryKey: ['trash'], queryFn: () => api<{ items: Video[] }>('/api/videos/trash') });
}

export function useFolders() {
  return useQuery({
    queryKey: ['folders'],
    queryFn: () => api<{ folders: Folder[]; root: { videoCount: number; totalSize: number } }>('/api/folders'),
  });
}

export function invalidateLibrary(qc: QueryClient) {
  for (const key of ['videos', 'stats', 'folders', 'trash', 'me']) void qc.invalidateQueries({ queryKey: [key] });
}

export function useInvalidateLibrary() {
  const qc = useQueryClient();
  return () => invalidateLibrary(qc);
}

/** Path from root to the folder, e.g. [Projects, 2026, Client A]. */
export function folderPath(folders: Folder[], id: string | null | undefined) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur && path.length < 20) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}
