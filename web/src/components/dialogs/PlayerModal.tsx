import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Info, Share2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { formatBytes, formatDate, formatDuration } from '../../lib/format';
import type { Playback } from '../../lib/types';
import { ui, useUi } from '../../lib/ui';
import { downloadVideos } from '../../lib/actions';
import { Spinner } from '../ui/misc';
import { VideoPlayer } from '../video/VideoPlayer';

export function PlayerModal() {
  const video = useUi((s) => s.player);
  const set = useUi((s) => s.set);
  const close = () => set({ player: null });
  const { data, error } = useQuery({
    queryKey: ['playback', video?.id],
    queryFn: () => api<Playback>(`/api/videos/${video!.id}/playback`),
    enabled: !!video,
    staleTime: 30 * 60_000,
  });

  useEffect(() => {
    if (!video) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.fullscreenElement && close();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video]);

  if (!video) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-black/95 text-white" role="dialog" aria-modal="true" aria-label={video.filename}>
      <header className="flex items-center gap-2 px-3 py-2.5 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold sm:text-base">{video.filename}</h2>
          <p className="truncate text-xs text-white/50">
            {formatDuration(video.duration)} · {formatBytes(video.size)} · {video.format.toUpperCase()}
            {video.width ? ` · ${video.width}×${video.height}` : ''} · {formatDate(video.createdAt)}
          </p>
        </div>
        <button className="btn-icon text-white hover:bg-white/10" onClick={() => downloadVideos([video])} title="Download">
          <Download size={18} />
        </button>
        <button className="btn-icon text-white hover:bg-white/10" onClick={() => ui.share([video])} title="Share">
          <Share2 size={18} />
        </button>
        <button className="btn-icon text-white hover:bg-white/10" onClick={() => ui.details(video)} title="Details">
          <Info size={18} />
        </button>
        <button className="btn-icon text-white hover:bg-white/10" onClick={close} aria-label="Close player">
          <X size={20} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-0 sm:p-6" onClick={(e) => e.target === e.currentTarget && close()}>
        <div className="w-full max-w-6xl overflow-hidden sm:rounded-2xl">
          {error ? (
            <div className="flex aspect-video items-center justify-center text-sm text-red-300">{(error as Error).message}</div>
          ) : !data ? (
            <div className="flex aspect-video items-center justify-center">
              <Spinner size={28} />
            </div>
          ) : (
            <VideoPlayer sources={data.sources} poster={data.poster} downloadUrl={data.downloadUrl} knownDuration={video.duration} autoPlay className="max-h-[80vh]" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
