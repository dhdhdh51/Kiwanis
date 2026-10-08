import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Clock, Download, Link2Off, Lock } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { formatBytes, formatDate, formatDuration } from '../lib/format';
import type { PlaybackSource } from '../lib/types';
import { useTheme } from '../lib/theme';
import { Logo } from '../components/layout/AppShell';
import { Spinner } from '../components/ui/misc';
import { VideoPlayer } from '../components/video/VideoPlayer';

interface SharedVideo {
  video: { title: string; format: string; size: number; duration: number | null; width: number | null; height: number | null; createdAt: string; browserPlayable: boolean };
  owner: string;
  requiresPassword: boolean;
  locked: boolean;
  allowDownload: boolean;
  expiresAt: string | null;
  sources?: PlaybackSource[];
  poster?: string | null;
  downloadUrl?: string | null;
}

/** Public, minimal player page for share links — exposes nothing else from the owner's storage. */
export function SharePage() {
  const { token = '' } = useParams();
  const storageKey = `vv-share-${token}`;
  const [access, setAccess] = useState(() => sessionStorage.getItem(storageKey) ?? '');
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const { mode, setMode } = useTheme();

  const { data, error, isLoading } = useQuery({
    queryKey: ['public-share', token, access],
    queryFn: () => api<SharedVideo>(`/api/public/s/${token}`, { headers: access ? { 'X-Share-Access': access } : {}, silent401: true }),
    retry: false,
    staleTime: 30 * 60_000,
  });

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlocking(true);
    setUnlockError(null);
    try {
      const { accessToken } = await api<{ accessToken: string }>(`/api/public/s/${token}/unlock`, { body: { password }, silent401: true });
      sessionStorage.setItem(storageKey, accessToken);
      setAccess(accessToken);
    } catch (err) {
      setUnlockError(err instanceof ApiError && err.status === 429 ? 'Too many attempts. Please wait a few minutes.' : (err as Error).message);
    } finally {
      setUnlocking(false);
    }
  };

  const err = error as ApiError | null;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Logo />
        <button className="btn-ghost text-xs" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}>
          {mode === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-0 pb-12 sm:px-6">
        {isLoading ? (
          <div className="flex justify-center py-20"><Spinner size={28} /></div>
        ) : err ? (
          <div className="mx-auto flex max-w-sm flex-col items-center px-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500 dark:bg-white/5">
              {err.status === 410 ? <Clock size={26} /> : <Link2Off size={26} />}
            </div>
            <h1 className="text-xl font-semibold">{err.status === 410 ? 'This link has expired' : 'Video unavailable'}</h1>
            <p className="mt-2 text-sm text-zinc-500">{err.status === 410 ? 'Ask the owner for a new link.' : 'The link may be incorrect, disabled, or the video was removed.'}</p>
          </div>
        ) : data?.locked ? (
          <form onSubmit={unlock} className="card mx-auto w-full max-w-sm p-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              <Lock size={22} />
            </div>
            <h1 className="font-semibold">{data.video.title}</h1>
            <p className="mt-1 text-sm text-zinc-500">This video is password protected</p>
            <input className="input mt-5" type="password" placeholder="Enter password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required />
            {unlockError && <p className="mt-2 text-sm text-red-600">{unlockError}</p>}
            <button className="btn-primary mt-4 w-full" disabled={unlocking}>
              {unlocking && <Spinner size={16} />} Watch video
            </button>
          </form>
        ) : data?.sources ? (
          <div>
            <div className="overflow-hidden shadow-2xl sm:rounded-3xl">
              <VideoPlayer sources={data.sources} poster={data.poster} downloadUrl={data.downloadUrl} knownDuration={data.video.duration} />
            </div>
            <div className="mt-5 flex flex-wrap items-start gap-4 px-4 sm:px-0">
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-semibold break-words">{data.video.title}</h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Shared by {data.owner} · {formatDuration(data.video.duration)} · {formatBytes(data.video.size)} · {formatDate(data.video.createdAt)}
                  {data.expiresAt && ` · link expires ${formatDate(data.expiresAt, true)}`}
                </p>
              </div>
              {data.allowDownload && data.downloadUrl && (
                <a className="btn-secondary" href={data.downloadUrl}>
                  <Download size={16} /> Download
                </a>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
