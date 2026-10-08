import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight, Database, Film, FolderOpen, HardDrive, History, PieChart, RotateCcw, UploadCloud, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatBytes, timeAgo } from '../lib/format';
import { invalidateLibrary, useRecent, useStats } from '../lib/queries';
import { pickVideos } from '../lib/ui';
import { EmptyState, ProgressBar } from '../components/ui/misc';
import { VideoCard } from '../components/video/VideoCard';
import { useUploads } from '../upload/engine';

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Film; label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
        <Icon size={15} /> {label}
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

const FORMAT_COLORS: Record<string, string> = {
  mp4: 'bg-brand-500',
  mov: 'bg-accent-500',
  mkv: 'bg-amber-500',
  avi: 'bg-rose-500',
  webm: 'bg-emerald-500',
  m4v: 'bg-sky-500',
};

/** Upload sessions left behind by a closed tab or crash; selecting the same file resumes them. */
function InterruptedUploads() {
  const qc = useQueryClient();
  const localActive = useUploads((s) => s.items.some((i) => i.state !== 'completed' && i.state !== 'cancelled'));
  const { data } = useQuery({
    queryKey: ['videos', 'interrupted'],
    queryFn: () => api<{ uploads: { id: string; filename: string; size: number; uploadedBytes: number; folderId: string | null; updatedAt: string }[] }>('/api/uploads'),
    enabled: !localActive,
  });
  if (localActive || !data?.uploads.length) return null;
  return (
    <section className="card border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
      <div className="flex items-center gap-2">
        <RotateCcw size={16} className="text-amber-600" />
        <h2 className="text-sm font-semibold">Interrupted uploads</h2>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Select the same file again to resume from where it stopped — already uploaded chunks are kept.</p>
      <ul className="mt-3 space-y-2">
        {data.uploads.slice(0, 6).map((u) => (
          <li key={u.id} className="flex items-center gap-3 rounded-xl bg-white p-2.5 dark:bg-white/5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{u.filename}</div>
              <ProgressBar value={(u.uploadedBytes / u.size) * 100} thin className="mt-1.5" tone="amber" />
              <div className="mt-1 text-xs text-zinc-500">
                {formatBytes(u.uploadedBytes)} of {formatBytes(u.size)} · {timeAgo(u.updatedAt)}
              </div>
            </div>
            <button className="btn-secondary h-8 px-3 text-xs" onClick={() => pickVideos(u.folderId)}>
              Resume
            </button>
            <button
              className="btn-icon btn-ghost h-8 w-8"
              aria-label="Discard"
              onClick={async () => {
                await api(`/api/uploads/${u.id}`, { method: 'DELETE' }).catch(() => undefined);
                invalidateLibrary(qc);
              }}
            >
              <X size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data: stats } = useStats();
  const { data: recent, isLoading } = useRecent();
  const pct = stats?.storageLimit ? (stats.storageUsed / stats.storageLimit) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hi, {user?.name.split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-zinc-500">Here's what's happening in your video storage.</p>
        </div>
        <button className="btn-primary py-2.5" onClick={() => pickVideos(null)}>
          <UploadCloud size={18} /> Upload Videos
        </button>
      </div>

      <InterruptedUploads />

      {/* Storage overview */}
      <section className="card overflow-hidden p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-zinc-500">Storage used</div>
            <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
              {formatBytes(stats?.storageUsed ?? 0)} <span className="text-lg font-normal text-zinc-400">/ {formatBytes(stats?.storageLimit ?? 0)}</span>
            </div>
          </div>
          <div className="text-sm text-zinc-500">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{formatBytes(stats?.storageAvailable ?? 0)}</span> available
          </div>
        </div>
        <ProgressBar value={pct} className="mt-4 h-3" tone={pct > 95 ? 'red' : pct > 80 ? 'amber' : 'brand'} />
        {pct > 80 && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            You're using {pct.toFixed(0)}% of your storage. Empty the Trash or contact your administrator for more space.
          </p>
        )}
        {!!stats?.byFormat.length && (
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-500">
            {stats.byFormat.map((f) => (
              <span key={f.format} className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${FORMAT_COLORS[f.format] ?? 'bg-zinc-400'}`} />
                <span className="font-semibold text-zinc-700 uppercase dark:text-zinc-300">{f.format}</span>
                {f.count} · {formatBytes(f.size)}
              </span>
            ))}
            {stats.trashSize > 0 && (
              <Link to="/trash" className="flex items-center gap-1.5 hover:underline">
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-400" /> Trash · {formatBytes(stats.trashSize)}
              </Link>
            )}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Stat icon={HardDrive} label="Total storage" value={formatBytes(stats?.storageLimit ?? 0)} />
        <Stat icon={Database} label="Used storage" value={formatBytes(stats?.storageUsed ?? 0)} sub={`${pct.toFixed(1)}% of quota`} />
        <Stat icon={PieChart} label="Available" value={formatBytes(stats?.storageAvailable ?? 0)} />
        <Stat icon={Film} label="Videos" value={(stats?.videoCount ?? 0).toLocaleString()} />
        <Stat icon={UploadCloud} label="Total uploaded" value={formatBytes(stats?.totalUploadedSize ?? 0)} />
        <Stat icon={FolderOpen} label="Folders" value={(stats?.folderCount ?? 0).toLocaleString()} />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <History size={18} /> Recent uploads
          </h2>
          <Link to="/videos" className="flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
            View all <ArrowRight size={14} />
          </Link>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-[4/3.6] animate-pulse rounded-2xl bg-zinc-200/70 dark:bg-white/5" />
            ))}
          </div>
        ) : recent?.items.length ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {recent.items.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<UploadCloud />}
            title="No videos yet"
            message="Drag and drop videos anywhere on this page, or pick files from your device. Upload 1, 10 or 100 at once."
            action={
              <button className="btn-primary" onClick={() => pickVideos(null)}>
                <UploadCloud size={16} /> Upload Videos
              </button>
            }
          />
        )}
      </section>
    </div>
  );
}
