import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Copy, Globe, Link2, Lock, RefreshCw, ShieldOff } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Segmented, Spinner, Toggle } from '../ui/misc';
import { api } from '../../lib/api';
import { copyText, formatDate } from '../../lib/format';
import { invalidateLibrary } from '../../lib/queries';
import { errorMessage, toast } from '../../lib/toast';
import type { Share, Video } from '../../lib/types';
import { useUi } from '../../lib/ui';

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input className="input font-mono text-xs" readOnly value={value} onFocus={(e) => e.target.select()} aria-label="Share link" />
      <button
        className="btn-primary shrink-0"
        onClick={async () => {
          if (await copyText(value)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const EXPIRY: [string, string, number | null][] = [
  ['never', 'Never', null],
  ['1h', '1 hour', 3600_000],
  ['1d', '24 hours', 86400_000],
  ['7d', '7 days', 7 * 86400_000],
  ['30d', '30 days', 30 * 86400_000],
];

function toLocalInput(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function SingleShare({ video }: { video: Video }) {
  const qc = useQueryClient();
  const key = ['share', video.id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<{ share: Share | null }>(`/api/videos/${video.id}/share`).then((r) => r.share),
  });
  const [password, setPassword] = useState('');
  const [editingPassword, setEditingPassword] = useState(false);
  const [customExpiry, setCustomExpiry] = useState('');

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ share: Share }>(`/api/videos/${video.id}/share`, { method: 'PUT', body }).then((r) => r.share),
    onSuccess: (share) => {
      qc.setQueryData(key, share);
      invalidateLibrary(qc);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const regenerate = useMutation({
    mutationFn: () => api<{ share: Share }>(`/api/videos/${video.id}/share/regenerate`, { method: 'POST' }).then((r) => r.share),
    onSuccess: (share) => {
      qc.setQueryData(key, share);
      toast.success('New link generated — the old link no longer works');
    },
  });
  const disable = useMutation({
    mutationFn: () => api(`/api/videos/${video.id}/share`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.setQueryData(key, null);
      invalidateLibrary(qc);
      toast.success('Sharing disabled');
    },
  });

  const share = data;
  useEffect(() => setCustomExpiry(share?.expiresAt ? toLocalInput(share.expiresAt) : ''), [share?.expiresAt]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (!share) {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
          <Link2 size={26} />
        </div>
        <p className="font-medium">This video is private</p>
        <p className="mt-1 max-w-xs text-sm text-zinc-500">Create a link to let others watch it in a clean player page — without access to the rest of your storage.</p>
        <button className="btn-primary mt-5" disabled={update.isPending} onClick={() => update.mutate({ isPublic: true })}>
          {update.isPending ? <Spinner size={16} /> : <Link2 size={16} />} Create share link
        </button>
      </div>
    );
  }

  const busy = update.isPending;
  return (
    <div className="space-y-5">
      <div
        className={clsx(
          'flex items-center gap-2 rounded-xl px-3 py-2 text-sm',
          share.active ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-400',
        )}
      >
        {share.active ? <Globe size={16} /> : <Lock size={16} />}
        {share.expired ? 'Link has expired' : share.isPublic ? `Anyone with the link can view${share.hasPassword ? ' (password required)' : ''}` : 'Link is private — only you can access this video'}
        <span className="ml-auto text-xs opacity-70">{share.views} views</span>
      </div>

      <CopyField value={share.url} />

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Access</div>
          <div className="text-xs text-zinc-500">Private links stop working until made public again</div>
        </div>
        <Segmented
          value={share.isPublic ? 'public' : 'private'}
          onChange={(v) => update.mutate({ isPublic: v === 'public' })}
          options={[
            { value: 'public', label: <><Globe size={14} /> Public</> },
            { value: 'private', label: <><Lock size={14} /> Private</> },
          ]}
        />
      </div>

      <div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Password protection</div>
            <div className="text-xs text-zinc-500">{share.hasPassword ? 'Viewers must enter a password' : 'Optional'}</div>
          </div>
          <Toggle
            checked={share.hasPassword || editingPassword}
            disabled={busy}
            label="Password protection"
            onChange={(on) => {
              if (on) setEditingPassword(true);
              else {
                setEditingPassword(false);
                if (share.hasPassword) update.mutate({ password: null });
              }
            }}
          />
        </div>
        {(editingPassword || share.hasPassword) && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (password.length < 4) return toast.error('Password must be at least 4 characters');
              update.mutate(
                { password },
                {
                  onSuccess: () => {
                    setPassword('');
                    setEditingPassword(false);
                    toast.success('Password saved');
                  },
                },
              );
            }}
          >
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder={share.hasPassword ? 'Enter a new password to change it' : 'Set a password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="btn-secondary shrink-0" disabled={busy || !password}>
              Save
            </button>
          </form>
        )}
      </div>

      <div>
        <div className="mb-1.5 text-sm font-medium">Link expiration</div>
        <div className="flex flex-wrap gap-1.5">
          {EXPIRY.map(([k, label, ms]) => (
            <button
              key={k}
              disabled={busy}
              onClick={() => update.mutate({ expiresAt: ms ? new Date(Date.now() + ms).toISOString() : null })}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-medium transition',
                (k === 'never' && !share.expiresAt) ? 'border-brand-600 bg-brand-600 text-white' : 'border-zinc-200 hover:border-zinc-300 dark:border-white/10',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="datetime-local"
            className="input py-1.5"
            value={customExpiry}
            min={toLocalInput(new Date().toISOString())}
            onChange={(e) => setCustomExpiry(e.target.value)}
            aria-label="Custom expiration"
          />
          <button className="btn-secondary shrink-0" disabled={!customExpiry || busy} onClick={() => update.mutate({ expiresAt: new Date(customExpiry).toISOString() })}>
            Set
          </button>
        </div>
        {share.expiresAt && (
          <p className={clsx('mt-1.5 text-xs', share.expired ? 'text-red-600' : 'text-zinc-500')}>
            {share.expired ? 'Expired' : 'Expires'} {formatDate(share.expiresAt, true)}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Allow downloads</div>
          <div className="text-xs text-zinc-500">Show a download button on the shared page</div>
        </div>
        <Toggle checked={share.allowDownload} disabled={busy} onChange={(v) => update.mutate({ allowDownload: v })} label="Allow downloads" />
      </div>

      <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-white/5">
        <button className="btn-ghost" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
          <RefreshCw size={15} /> New link
        </button>
        <button className="btn-ghost text-red-600 dark:text-red-400" disabled={disable.isPending} onClick={() => disable.mutate()}>
          <ShieldOff size={15} /> Disable sharing
        </button>
      </div>
    </div>
  );
}

function BulkShare({ videos }: { videos: Video[] }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['bulk-share', videos.map((v) => v.id).join(',')],
    queryFn: () =>
      api<{ results: { videoId: string; filename: string; share: Share }[] }>('/api/videos/share/bulk', { body: { ids: videos.map((v) => v.id) } }).then((r) => {
        invalidateLibrary(qc);
        return r.results;
      }),
    staleTime: Infinity,
    gcTime: 0,
  });
  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (error) return <p className="py-6 text-center text-sm text-red-600">{(error as Error).message}</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">Public links are enabled for these videos. Open a single video's Share settings to add a password or expiry.</p>
      <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-white/5 dark:border-white/10">
        {data!.map((r) => (
          <li key={r.videoId} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{r.filename}</div>
              <div className="truncate font-mono text-xs text-zinc-500">{r.share.url}</div>
            </div>
            <button className="btn-icon btn-ghost h-8 w-8" onClick={() => copyText(r.share.url).then(() => toast.success('Link copied'))} aria-label="Copy link">
              <Copy size={15} />
            </button>
          </li>
        ))}
      </ul>
      <button
        className="btn-primary w-full"
        onClick={() => copyText(data!.map((r) => `${r.filename}: ${r.share.url}`).join('\n')).then(() => toast.success(`${data!.length} links copied`))}
      >
        <Copy size={16} /> Copy all links
      </button>
    </div>
  );
}

export function ShareDialog() {
  const videos = useUi((s) => s.share);
  const set = useUi((s) => s.set);
  const close = () => set({ share: null });
  const single = videos?.length === 1 ? videos[0] : null;
  return (
    <Modal
      open={!!videos}
      onClose={close}
      title={single ? 'Share video' : `Share ${videos?.length ?? 0} videos`}
      description={single ? single.filename : undefined}
    >
      {single ? <SingleShare video={single} /> : videos ? <BulkShare videos={videos} /> : null}
    </Modal>
  );
}
