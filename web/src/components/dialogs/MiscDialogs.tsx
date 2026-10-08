import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Folder as FolderIcon, FolderPlus, HardDrive } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/misc';
import { api } from '../../lib/api';
import { moveVideos } from '../../lib/actions';
import { formatBytes, formatDate, formatDuration } from '../../lib/format';
import { invalidateLibrary, useFolders } from '../../lib/queries';
import { errorMessage, toast } from '../../lib/toast';
import type { Folder } from '../../lib/types';
import { useUi } from '../../lib/ui';
import { flattenTree } from '../folders/folderTree';
import { Thumbnail } from '../video/VideoCard';

export function ConfirmDialog() {
  const confirm = useUi((s) => s.confirm);
  const set = useUi((s) => s.set);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [confirm]);
  const close = () => !busy && set({ confirm: null });
  return (
    <Modal
      open={!!confirm}
      onClose={close}
      locked={busy}
      size="sm"
      title={confirm?.title}
      footer={
        <>
          <button className="btn-secondary" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            data-autofocus
            className={confirm?.danger ? 'btn-danger' : 'btn-primary'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await confirm?.onConfirm();
                set({ confirm: null });
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner size={16} />} {confirm?.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        {confirm?.danger && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/15">
            <AlertTriangle size={20} />
          </div>
        )}
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{confirm?.message}</p>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

export function RenameDialog() {
  const video = useUi((s) => s.rename);
  const set = useUi((s) => s.set);
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!video) return;
    setName(video.filename);
    // Pre-select the name without the extension, like desktop file managers.
    setTimeout(() => {
      const dot = video.filename.lastIndexOf('.');
      input.current?.focus();
      input.current?.setSelectionRange(0, dot > 0 ? dot : video.filename.length);
    }, 50);
  }, [video]);

  const close = () => set({ rename: null });
  const save = async () => {
    if (!video || !name.trim() || name === video.filename) return close();
    setBusy(true);
    try {
      await api(`/api/videos/${video.id}`, { method: 'PATCH', body: { filename: name.trim() } });
      invalidateLibrary(qc);
      toast.success('Renamed');
      close();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!video}
      onClose={close}
      size="sm"
      title="Rename video"
      footer={
        <>
          <button className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy || !name.trim()}>
            {busy && <Spinner size={16} />} Save
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input ref={input} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} aria-label="Video name" />
      </form>
    </Modal>
  );
}

export function FolderPicker({ value, onChange, folders, disabledIds }: { value: string | null; onChange: (id: string | null) => void; folders: Folder[]; disabledIds?: Set<string> }) {
  const flat = flattenTree(folders);
  const item = (id: string | null, label: string, depth: number, icon: React.ReactNode) => (
    <button
      key={id ?? 'root'}
      disabled={id ? disabledIds?.has(id) : false}
      onClick={() => onChange(id)}
      className={clsx(
        'flex w-full items-center gap-2.5 rounded-xl py-2 pr-3 text-left text-sm transition disabled:opacity-40',
        value === id ? 'bg-brand-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-white/5',
      )}
      style={{ paddingLeft: 12 + depth * 18 }}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
  return (
    <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-2xl border border-zinc-200 p-1.5 dark:border-white/10">
      {item(null, 'My Videos (no folder)', 0, <HardDrive size={16} />)}
      {flat.map((f) => item(f.id, f.name, f.depth + 1, <FolderIcon size={16} />))}
    </div>
  );
}

export function MoveDialog() {
  const move = useUi((s) => s.move);
  const set = useUi((s) => s.set);
  const qc = useQueryClient();
  const { data } = useFolders();
  const [target, setTarget] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (move) {
      setTarget(move.videos.length === 1 ? move.videos[0].folderId : null);
      setNewName('');
      setCreating(false);
    }
  }, [move]);

  const close = () => set({ move: null });
  const createFolder = async () => {
    if (!newName.trim()) return;
    try {
      const { folder } = await api<{ folder: Folder }>('/api/folders', { body: { name: newName.trim(), parentId: target } });
      await qc.invalidateQueries({ queryKey: ['folders'] });
      setTarget(folder.id);
      setCreating(false);
      setNewName('');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Modal
      open={!!move}
      onClose={close}
      title={move?.title ?? (move?.videos.length === 1 ? 'Move video' : `Move ${move?.videos.length} videos`)}
      description={move?.videos.length === 1 ? move.videos[0].filename : 'Choose a destination folder'}
      footer={
        <>
          <button className="btn-ghost mr-auto" onClick={() => setCreating(true)}>
            <FolderPlus size={16} /> New folder
          </button>
          <button className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await moveVideos(move!.videos, target, qc);
              move!.onDone?.();
              setBusy(false);
              close();
            }}
          >
            {busy && <Spinner size={16} />} {move?.title === 'Add to folder' ? 'Add' : 'Move here'}
          </button>
        </>
      }
    >
      {creating && (
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void createFolder();
          }}
        >
          <input className="input" autoFocus placeholder="Folder name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} />
          <button className="btn-primary shrink-0" disabled={!newName.trim()}>
            Create
          </button>
        </form>
      )}
      <FolderPicker value={target} onChange={setTarget} folders={data?.folders ?? []} />
    </Modal>
  );
}

export function DetailsDialog() {
  const video = useUi((s) => s.details);
  const set = useUi((s) => s.set);
  const close = () => set({ details: null });
  if (!video) return null;
  const share = video.share;
  const rows: [string, React.ReactNode][] = [
    ['Name', video.filename],
    ['Original filename', video.originalFilename],
    ['Format', `${video.format.toUpperCase()} (${video.mimeType})`],
    ['Size', `${formatBytes(video.size, 2)} (${video.size.toLocaleString()} bytes)`],
    ['Duration', formatDuration(video.duration)],
    ['Resolution', video.width ? `${video.width} × ${video.height}` : '—'],
    ['Qualities', ['Original', ...video.qualities].join(', ')],
    ['Folder', video.folder?.name ?? 'My Videos'],
    ['Uploaded', formatDate(video.createdAt, true)],
    ['Last modified', formatDate(video.updatedAt, true)],
    ['Status', video.status === 'READY' ? 'Ready' : video.status === 'PROCESSING' ? 'Processing' : video.status],
    ['Sharing', share ? (share.active ? `Public link${share.hasPassword ? ' · password' : ''}${share.expiresAt ? ` · expires ${formatDate(share.expiresAt)}` : ''} · ${share.views} views` : share.expired ? 'Link expired' : 'Link private') : 'Private'],
    ['Video ID', <code className="text-xs">{video.id}</code>],
  ];
  return (
    <Modal open onClose={close} title="Video details" size="md">
      <Thumbnail video={video} className="mb-4 aspect-video w-full rounded-2xl" />
      <dl className="divide-y divide-zinc-100 text-sm dark:divide-white/5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 py-2">
            <dt className="w-36 shrink-0 text-zinc-500">{k}</dt>
            <dd className="min-w-0 flex-1 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {!video.browserPlayable && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          {video.format.toUpperCase()} files may not play in every browser. Download to watch locally, or enable server transcoding to generate a web-friendly version.
        </p>
      )}
    </Modal>
  );
}
