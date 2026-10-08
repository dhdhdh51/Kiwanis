import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Clock, Copy, Loader2, RotateCcw, Square, WifiOff, X } from 'lucide-react';
import { formatBytes, formatEta, formatSpeed } from '../../lib/format';
import { invalidateLibrary } from '../../lib/queries';
import { ui } from '../../lib/ui';
import {
  cancel,
  cancelAll,
  clearFinished,
  dismissAll,
  isActive,
  onUploadComplete,
  retry,
  retryAllFailed,
  summarize,
  uploadAnyway,
  useUploads,
  type UploadItem,
} from '../../upload/engine';
import { ProgressBar } from '../ui/misc';

function StatusIcon({ item }: { item: UploadItem }) {
  switch (item.state) {
    case 'completed':
      return <CheckCircle2 size={18} className="text-emerald-500" />;
    case 'failed':
      return <AlertCircle size={18} className="text-red-500" />;
    case 'duplicate':
      return <Copy size={18} className="text-amber-500" />;
    case 'cancelled':
      return <X size={18} className="text-zinc-400" />;
    case 'queued':
      return <Clock size={18} className="text-zinc-400" />;
    case 'offline':
      return <WifiOff size={18} className="text-amber-500" />;
    default:
      return <Loader2 size={18} className="animate-spin text-brand-500" />;
  }
}

function statusText(it: UploadItem) {
  const pct = it.size ? Math.floor((it.uploadedBytes / it.size) * 100) : 0;
  switch (it.state) {
    case 'queued':
      return 'Waiting';
    case 'preparing':
      return 'Preparing…';
    case 'uploading':
      return `Uploading ${pct}% · ${formatSpeed(it.speed)}${it.resumed ? ' · resumed' : ''}`;
    case 'offline':
      return `Paused at ${pct}% — waiting for network`;
    case 'finalizing':
      return 'Finalizing…';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    case 'duplicate':
      return it.error ?? 'Already uploaded';
    case 'failed':
      return `Failed — ${it.error ?? 'Upload failed'}`;
  }
}

function Row({ item, index }: { item: UploadItem; index: number }) {
  const pct = item.state === 'completed' ? 100 : item.size ? (item.uploadedBytes / item.size) * 100 : 0;
  return (
    <li className="group px-4 py-2.5">
      <div className="flex items-center gap-3">
        <StatusIcon item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="w-6 shrink-0 text-right text-xs text-zinc-400 tabular-nums">{index + 1}.</span>
            <span className="truncate text-sm font-medium" title={item.name}>
              {item.name}
            </span>
            <span className="ml-auto shrink-0 text-xs text-zinc-400 tabular-nums">{formatBytes(item.size)}</span>
          </div>
          <div
            className={clsx(
              'ml-8 truncate text-xs',
              item.state === 'failed' ? 'text-red-600 dark:text-red-400' : item.state === 'duplicate' ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-500',
            )}
            title={statusText(item)}
          >
            {statusText(item)}
          </div>
          {(isActive(item.state) || item.state === 'queued') && (
            <ProgressBar value={pct} thin className="mt-1.5 ml-8 w-[calc(100%-2rem)]" tone={item.state === 'offline' ? 'amber' : 'brand'} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {(item.state === 'queued' || isActive(item.state)) && (
            <button className="btn-icon btn-ghost h-8 w-8" title="Cancel upload" onClick={() => cancel(item.id)}>
              <X size={16} />
            </button>
          )}
          {(item.state === 'failed' || item.state === 'cancelled') && item.canRetry && (
            <button className="btn-ghost h-8 px-2 text-xs text-brand-600 dark:text-brand-300" onClick={() => retry(item.id)}>
              <RotateCcw size={14} /> Retry
            </button>
          )}
          {item.state === 'duplicate' && (
            <button className="btn-ghost h-8 px-2 text-xs" onClick={() => uploadAnyway(item.id)}>
              Upload anyway
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Persistent upload tray (bottom-right on desktop, bottom sheet on mobile). */
export function UploadPanel() {
  const items = useUploads((s) => s.items);
  const panel = useUploads((s) => s.panel);
  const setPanel = useUploads((s) => s.setPanel);
  const qc = useQueryClient();

  // Newly uploaded videos appear in the library automatically.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onUploadComplete(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        invalidateLibrary(qc);
      }, 800);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [qc]);

  // Refresh once more shortly after uploads finish, to pick up server-side processing results.
  const s = summarize(items);
  useEffect(() => {
    if (!s.running && s.completed) {
      const t = setTimeout(() => invalidateLibrary(qc), 4000);
      return () => clearTimeout(t);
    }
  }, [s.running, s.completed, qc]);

  if (panel === 'hidden' || !items.length) return null;
  const remaining = s.speed > 0 ? (s.totalBytes - s.sentBytes) / s.speed : NaN;
  const title = s.running
    ? `Uploading ${s.total} video${s.total === 1 ? '' : 's'}`
    : s.failed
      ? `${s.completed} of ${s.total} uploaded · ${s.failed} failed`
      : `${s.completed} upload${s.completed === 1 ? '' : 's'} complete`;
  const minimized = panel === 'minimized';

  return (
    <section
      aria-label="Uploads"
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-[75vh] flex-col overflow-hidden rounded-t-3xl border border-zinc-200 bg-white shadow-2xl sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[26rem] sm:rounded-3xl dark:border-white/10 dark:bg-[#15151f]"
    >
      <header className="px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold">{title}</h3>
            <p className="text-xs text-zinc-500 tabular-nums">
              {s.completed} of {s.total} videos uploaded
              {s.running && ` · ${Math.floor(s.percent)}% · ${formatSpeed(s.speed)}`}
              {s.running && formatEta(remaining) && ` · ${formatEta(remaining)}`}
            </p>
          </div>
          <button className="btn-icon btn-ghost h-8 w-8" onClick={() => setPanel(minimized ? 'open' : 'minimized')} aria-label={minimized ? 'Expand' : 'Minimize'}>
            {minimized ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          <button
            className="btn-icon btn-ghost h-8 w-8"
            aria-label="Close"
            onClick={() =>
              s.running
                ? ui.confirm({
                    title: 'Cancel all uploads?',
                    message: 'Uploads in progress will be cancelled. Completed videos stay in your library.',
                    confirmLabel: 'Cancel uploads',
                    danger: true,
                    onConfirm: dismissAll,
                  })
                : dismissAll()
            }
          >
            <X size={18} />
          </button>
        </div>
        <ProgressBar value={s.percent} className="mt-2.5" tone={!s.running && s.failed ? 'amber' : !s.running ? 'green' : 'brand'} />
      </header>

      {!minimized && (
        <>
          <ul className="min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
            {items.map((it, i) => (
              <Row key={it.id} item={it} index={i} />
            ))}
          </ul>
          <footer className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-3 py-2 dark:border-white/5">
            {s.failed > 0 && (
              <button className="btn-ghost h-8 px-2.5 text-xs" onClick={retryAllFailed}>
                <RotateCcw size={14} /> Retry failed ({s.failed})
              </button>
            )}
            {s.running && (
              <button className="btn-ghost h-8 px-2.5 text-xs" onClick={cancelAll}>
                <Square size={13} /> Cancel all
              </button>
            )}
            <button className="btn-ghost ml-auto h-8 px-2.5 text-xs" onClick={clearFinished}>
              Clear finished
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
