import type { QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { copyText, triggerDownload } from './format';
import { invalidateLibrary } from './queries';
import { errorMessage, toast } from './toast';
import type { Share, Video } from './types';
import { ui } from './ui';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function downloadVideos(videos: Video[]) {
  if (!videos.length) return;
  if (videos.length === 1) triggerDownload(`/api/videos/${videos[0].id}/download`);
  else {
    triggerDownload(`/api/videos/zip?ids=${videos.map((v) => v.id).join(',')}`);
    toast.info(`Preparing a ZIP of ${plural(videos.length, 'video')}…`);
  }
}

export async function copyShareLink(v: Video, qc: QueryClient) {
  try {
    let share: Share | null = v.share;
    if (!share || !share.active) {
      share = (await api<{ share: Share }>(`/api/videos/${v.id}/share`, { method: 'PUT', body: { isPublic: true } })).share;
      invalidateLibrary(qc);
    }
    await copyText(share.url);
    toast.success(share.hasPassword ? 'Link copied (password protected)' : 'Share link copied to clipboard');
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

export async function moveVideos(videos: Video[], folderId: string | null, qc: QueryClient) {
  try {
    await api('/api/videos/bulk', { body: { action: 'move', ids: videos.map((v) => v.id), folderId } });
    invalidateLibrary(qc);
    toast.success(`Moved ${plural(videos.length, 'video')}`);
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

export function trashVideos(videos: Video[], qc: QueryClient, after?: () => void) {
  const ids = videos.map((v) => v.id);
  ui.confirm({
    title: videos.length === 1 ? 'Move video to Trash?' : `Move ${videos.length} videos to Trash?`,
    message:
      videos.length === 1
        ? `"${videos[0].filename}" will be moved to Trash. You can restore it within the retention period.`
        : 'These videos will be moved to Trash. You can restore them within the retention period.',
    confirmLabel: 'Move to Trash',
    danger: true,
    onConfirm: async () => {
      await api('/api/videos/bulk', { body: { action: 'trash', ids } });
      invalidateLibrary(qc);
      after?.();
      toast.success(`${plural(ids.length, 'video')} moved to Trash`, {
        label: 'Undo',
        onClick: async () => {
          await api('/api/videos/bulk', { body: { action: 'restore', ids } }).catch(() => undefined);
          invalidateLibrary(qc);
        },
      });
    },
  });
}

export function deleteForever(videos: Video[], qc: QueryClient, after?: () => void) {
  ui.confirm({
    title: `Permanently delete ${plural(videos.length, 'video')}?`,
    message: 'This cannot be undone. The files will be erased from storage and any share links will stop working.',
    confirmLabel: 'Delete forever',
    danger: true,
    onConfirm: async () => {
      await api('/api/videos/bulk', { body: { action: 'delete', ids: videos.map((v) => v.id) } });
      invalidateLibrary(qc);
      after?.();
      toast.success(`${plural(videos.length, 'video')} permanently deleted`);
    },
  });
}

export async function restoreVideos(videos: Video[], qc: QueryClient) {
  try {
    await api('/api/videos/bulk', { body: { action: 'restore', ids: videos.map((v) => v.id) } });
    invalidateLibrary(qc);
    toast.success(`Restored ${plural(videos.length, 'video')}`);
  } catch (err) {
    toast.error(errorMessage(err));
  }
}
