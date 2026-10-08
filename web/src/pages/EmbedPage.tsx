import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { PlaybackSource } from '../lib/types';
import { Spinner } from '../components/ui/misc';
import { VideoPlayer } from '../components/video/VideoPlayer';

interface Embedded {
  video: { title: string; duration: number | null };
  locked: boolean;
  allowEmbed: boolean;
  sources?: PlaybackSource[];
  poster?: string | null;
  downloadUrl?: string | null;
}

/**
 * Chrome-less player for <iframe> embeds on other websites: /embed/:token
 * Only the video is exposed — no dashboard, no owner data beyond the title.
 */
export function EmbedPage() {
  const { token = '' } = useParams();
  const key = `vv-share-${token}`;
  const [access, setAccess] = useState(() => {
    try {
      return sessionStorage.getItem(key) ?? '';
    } catch {
      return ''; // storage can be blocked inside third-party iframes
    }
  });
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const autoplay = params.get('autoplay') === '1';

  const { data, error, isLoading } = useQuery({
    queryKey: ['embed', token, access],
    queryFn: () => api<Embedded>(`/api/public/s/${token}`, { headers: access ? { 'X-Share-Access': access } : {}, silent401: true }),
    retry: false,
    staleTime: 30 * 60_000,
  });

  const shell = (children: React.ReactNode) => (
    <div className="dark flex h-screen w-screen items-center justify-center overflow-hidden bg-black text-white">{children}</div>
  );

  if (isLoading) return shell(<Spinner size={28} />);
  if (error) {
    const e = error as ApiError;
    return shell(<p className="px-6 text-center text-sm text-white/70">{e.status === 410 ? 'This video link has expired.' : 'This video is unavailable.'}</p>);
  }
  if (!data) return null;
  if (!data.allowEmbed) {
    return shell(
      <p className="px-6 text-center text-sm text-white/70">
        The owner has disabled embedding for this video.{' '}
        <a className="underline" href={`/s/${token}`} target="_blank" rel="noopener">
          Watch on VidVault
        </a>
      </p>,
    );
  }
  if (data.locked) {
    return shell(
      <form
        className="w-full max-w-xs px-6 text-center"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const { accessToken } = await api<{ accessToken: string }>(`/api/public/s/${token}/unlock`, { body: { password }, silent401: true });
            try {
              sessionStorage.setItem(key, accessToken);
            } catch {
              /* ignore */
            }
            setAccess(accessToken);
          } catch (e2) {
            setErr((e2 as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Lock className="mx-auto mb-2 text-white/70" size={22} />
        <p className="truncate text-sm font-medium">{data.video.title}</p>
        <input
          className="mt-3 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:border-brand-400"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
        <button className="btn-primary mt-3 w-full" disabled={busy}>
          {busy && <Spinner size={14} />} Watch
        </button>
      </form>,
    );
  }
  return (
    <div className="dark relative h-screen w-screen overflow-hidden bg-black">
      <VideoPlayer fill sources={data.sources!} poster={data.poster} downloadUrl={data.downloadUrl} knownDuration={data.video.duration} autoPlay={autoplay} />
      <a
        href={`/s/${token}`}
        target="_blank"
        rel="noopener"
        className="absolute top-2 right-2 rounded-lg bg-black/50 px-2 py-1 text-[11px] font-medium text-white/80 backdrop-blur hover:text-white"
      >
        VidVault ↗
      </a>
    </div>
  );
}
