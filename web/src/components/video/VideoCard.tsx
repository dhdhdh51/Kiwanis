import clsx from 'clsx';
import { Film, Folder, Link2, Loader2, Lock, Play } from 'lucide-react';
import { formatBytes, formatDate, formatDuration } from '../../lib/format';
import type { Video } from '../../lib/types';
import { ui } from '../../lib/ui';
import { Checkbox, FormatBadge } from '../ui/misc';
import { VideoMenu } from './VideoMenu';

interface Props {
  video: Video;
  selected?: boolean;
  selectionMode?: boolean;
  onSelect?: (v: Video, additive: boolean, range: boolean) => void;
  menu?: React.ReactNode;
}

export function Thumbnail({ video, className }: { video: Video; className?: string }) {
  return (
    <div className={clsx('relative overflow-hidden bg-gradient-to-br from-zinc-200 to-zinc-300 dark:from-zinc-800 dark:to-zinc-900', className)}>
      {video.thumbnailUrl ? (
        <img src={video.thumbnailUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-400 dark:text-zinc-600">
          {video.status === 'PROCESSING' ? <Loader2 className="animate-spin" size={24} /> : <Film size={28} />}
        </div>
      )}
    </div>
  );
}

export function VideoCard({ video, selected, selectionMode, onSelect, menu }: Props) {
  const open = (e: React.MouseEvent) => {
    if (selectionMode || e.metaKey || e.ctrlKey || e.shiftKey) onSelect?.(video, e.metaKey || e.ctrlKey || selectionMode === true, e.shiftKey);
    else ui.play(video);
  };
  return (
    <div
      className={clsx(
        'group relative flex flex-col overflow-hidden rounded-2xl border bg-white transition dark:bg-white/[0.03]',
        selected
          ? 'border-brand-500 ring-2 ring-brand-500/40'
          : 'border-zinc-200/80 hover:border-zinc-300 hover:shadow-lg hover:shadow-zinc-900/5 dark:border-white/[0.08] dark:hover:border-white/20',
      )}
    >
      <button className="relative block aspect-video w-full text-left" onClick={open} aria-label={`Play ${video.filename}`}>
        <Thumbnail video={video} className="h-full w-full" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/25">
          {!selectionMode && (
            <span className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-white/95 text-zinc-900 opacity-0 shadow-xl transition group-hover:scale-100 group-hover:opacity-100">
              <Play size={20} className="ml-0.5" fill="currentColor" />
            </span>
          )}
        </div>
        <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">
          {formatDuration(video.duration)}
        </span>
        <span className="absolute bottom-2 left-2">
          <FormatBadge format={video.format} />
        </span>
        {video.share?.active && (
          <span className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white shadow" title="Shared via link">
            {video.share.hasPassword ? <Lock size={12} /> : <Link2 size={12} />}
          </span>
        )}
      </button>
      <div className={clsx('absolute top-2 left-2 transition', selected || selectionMode ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100')}>
        <Checkbox checked={!!selected} onChange={() => onSelect?.(video, true, false)} label={`Select ${video.filename}`} />
      </div>
      <div className="flex items-start gap-1 p-3 pr-1.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium" title={video.filename}>
            {video.filename}
          </h3>
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
            {formatBytes(video.size)} · {formatDate(video.createdAt)}
          </p>
          {video.folder && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-zinc-400">
              <Folder size={11} /> {video.folder.name}
            </p>
          )}
        </div>
        {menu ?? <VideoMenu video={video} className="btn-ghost -mt-1" />}
      </div>
    </div>
  );
}

export function VideoRow({ video, selected, selectionMode, onSelect, menu }: Props) {
  const open = (e: React.MouseEvent) => {
    if (selectionMode || e.metaKey || e.ctrlKey || e.shiftKey) onSelect?.(video, e.metaKey || e.ctrlKey || selectionMode === true, e.shiftKey);
    else ui.play(video);
  };
  return (
    <div
      className={clsx(
        'group flex items-center gap-3 px-3 py-2 transition sm:px-4',
        selected ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]',
      )}
    >
      <Checkbox checked={!!selected} onChange={() => onSelect?.(video, true, false)} label={`Select ${video.filename}`} />
      <button onClick={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="relative w-24 shrink-0 overflow-hidden rounded-lg sm:w-28">
          <Thumbnail video={video} className="aspect-video w-full" />
          <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-white tabular-nums">{formatDuration(video.duration)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{video.filename}</span>
            {video.share?.active && <Link2 size={13} className="shrink-0 text-brand-500" />}
          </div>
          <div className="truncate text-xs text-zinc-500 md:hidden">
            {formatBytes(video.size)} · {formatDate(video.createdAt)}
          </div>
        </div>
        <span className="hidden w-20 shrink-0 text-xs font-semibold text-zinc-500 uppercase md:block">{video.format}</span>
        <span className="hidden w-32 shrink-0 truncate text-sm text-zinc-500 lg:block">{video.folder?.name ?? '—'}</span>
        <span className="hidden w-20 shrink-0 text-right text-sm text-zinc-500 tabular-nums md:block">{formatDuration(video.duration)}</span>
        <span className="hidden w-24 shrink-0 text-right text-sm text-zinc-500 tabular-nums md:block">{formatBytes(video.size)}</span>
        <span className="hidden w-32 shrink-0 text-right text-sm text-zinc-500 md:block">{formatDate(video.createdAt)}</span>
      </button>
      {menu ?? <VideoMenu video={video} className="btn-ghost" />}
    </div>
  );
}

export function ListHeader({ allSelected, someSelected, onToggleAll }: { allSelected: boolean; someSelected: boolean; onToggleAll: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-100 px-3 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase sm:px-4 dark:border-white/5">
      <Checkbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={onToggleAll} label="Select all" />
      <span className="flex-1">Name</span>
      <span className="hidden w-20 md:block">Format</span>
      <span className="hidden w-32 lg:block">Folder</span>
      <span className="hidden w-20 text-right md:block">Duration</span>
      <span className="hidden w-24 text-right md:block">Size</span>
      <span className="hidden w-32 text-right md:block">Uploaded</span>
      <span className="w-8" />
    </div>
  );
}
