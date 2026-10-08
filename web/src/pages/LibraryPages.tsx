import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronRight, Film, Folder as FolderIcon, FolderOpen, FolderPlus, HardDrive, MoreVertical, Pencil, Share2, Trash2, UploadCloud, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { deleteForever, restoreVideos } from '../lib/actions';
import { formatBytes, formatDate, timeAgo } from '../lib/format';
import { folderPath, invalidateLibrary, useFolders, useTrash } from '../lib/queries';
import { errorMessage, toast } from '../lib/toast';
import type { Folder, Video } from '../lib/types';
import { pickVideos, ui, useUi } from '../lib/ui';
import { Modal } from '../components/ui/Modal';
import { Menu } from '../components/ui/Menu';
import { Checkbox, EmptyState, Spinner } from '../components/ui/misc';
import { VideoBrowser } from '../components/video/VideoBrowser';
import { Thumbnail } from '../components/video/VideoCard';
import { buildTree, type TreeNode } from '../components/folders/folderTree';

function PageTitle({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-zinc-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const uploadEmpty = (folderId: string | null) => ({
  icon: <UploadCloud />,
  title: 'Nothing here yet',
  message: 'Upload videos from your device or drag and drop them onto this page.',
  action: (
    <button className="btn-primary" onClick={() => pickVideos(folderId)}>
      <UploadCloud size={16} /> Upload Videos
    </button>
  ),
});

export function VideosPage() {
  return (
    <div className="space-y-5">
      <PageTitle
        title="All videos"
        subtitle="Every video in your storage"
        actions={
          <button className="btn-primary" onClick={() => pickVideos(null)}>
            <UploadCloud size={16} /> Upload Videos
          </button>
        }
      />
      <VideoBrowser empty={uploadEmpty(null)} />
    </div>
  );
}

export function SharedPage() {
  return (
    <div className="space-y-5">
      <PageTitle title="Shared" subtitle="Videos with a share link. Open a video's menu → Share to change access, password or expiry." />
      <VideoBrowser
        shared
        empty={{
          icon: <Share2 />,
          title: 'No shared videos',
          message: 'Videos are private by default. Use “Share” on any video to create a link others can watch.',
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Folders
// ------------------------------------------------------------------------------------------------

function FolderNameDialog({ open, initial, title, onClose, onSave }: { open: boolean; initial: string; title: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(initial), [initial, open]);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave(name.trim());
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={submit}>
            {busy && <Spinner size={16} />} Save
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input className="input" autoFocus placeholder="Folder name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </form>
    </Modal>
  );
}

function TreeItem({ node, activeId, open, toggle }: { node: TreeNode; activeId?: string; open: Set<string>; toggle: (id: string) => void }) {
  const isOpen = open.has(node.id);
  return (
    <li>
      <div
        className={clsx(
          'flex items-center rounded-lg pr-2 text-sm transition',
          activeId === node.id ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'hover:bg-zinc-100 dark:hover:bg-white/5',
        )}
        style={{ paddingLeft: node.depth * 14 }}
      >
        <button className={clsx('flex h-7 w-6 shrink-0 items-center justify-center text-zinc-400', !node.children.length && 'invisible')} onClick={() => toggle(node.id)} aria-label={isOpen ? 'Collapse' : 'Expand'}>
          <ChevronRight size={14} className={clsx('transition', isOpen && 'rotate-90')} />
        </button>
        <Link to={`/folders/${node.id}`} className="flex min-w-0 flex-1 items-center gap-2 py-1.5">
          {activeId === node.id ? <FolderOpen size={15} /> : <FolderIcon size={15} />}
          <span className="truncate">{node.name}</span>
          <span className="ml-auto text-xs text-zinc-400">{node.videoCount || ''}</span>
        </Link>
      </div>
      {isOpen && node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeItem key={c.id} node={c} activeId={activeId} open={open} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FoldersPage() {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useFolders();
  const set = useUi((s) => s.set);
  const folders = useMemo(() => data?.folders ?? [], [data]);
  const current = folders.find((f) => f.id === folderId) ?? null;
  const path = folderPath(folders, folderId);
  const children = folders.filter((f) => f.parentId === (folderId ?? null)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const tree = useMemo(() => buildTree(folders), [folders]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<null | { mode: 'create' } | { mode: 'rename'; folder: Folder }>(null);

  // Uploads / drops on this page go into the open folder.
  useEffect(() => {
    set({ currentFolderId: folderId ?? null });
    return () => set({ currentFolderId: null });
  }, [folderId, set]);
  useEffect(() => setOpen((o) => new Set([...o, ...path.map((p) => p.id)])), [folderId, folders.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (folderId && !isLoading && !current) {
    return <EmptyState icon={<FolderIcon />} title="Folder not found" message="It may have been deleted." action={<Link className="btn-secondary" to="/folders">Back to folders</Link>} />;
  }

  const removeFolder = (f: Folder) =>
    ui.confirm({
      title: `Delete folder “${f.name}”?`,
      message: 'The folder and all its sub-folders will be deleted. Videos inside are moved to Trash, where you can restore them.',
      confirmLabel: 'Delete folder',
      danger: true,
      onConfirm: async () => {
        await api(`/api/folders/${f.id}`, { method: 'DELETE' });
        invalidateLibrary(qc);
        toast.success('Folder deleted');
        if (f.id === folderId || path.some((p) => p.id === f.id)) navigate(f.parentId ? `/folders/${f.parentId}` : '/folders');
      },
    });

  const folderMenu = (f: Folder) => [
    { label: 'Open', icon: <FolderOpen size={16} />, onClick: () => navigate(`/folders/${f.id}`) },
    { label: 'Upload here', icon: <UploadCloud size={16} />, onClick: () => pickVideos(f.id) },
    { label: 'Rename', icon: <Pencil size={16} />, onClick: () => setDialog({ mode: 'rename', folder: f }) },
    { label: 'Delete', icon: <Trash2 size={16} />, onClick: () => removeFolder(f), danger: true, divider: true },
  ];

  return (
    <div className="flex gap-6">
      {/* Tree (desktop) */}
      <aside className="hidden w-60 shrink-0 xl:block">
        <div className="card sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto p-2">
          <Link
            to="/folders"
            className={clsx('flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium', !folderId ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'hover:bg-zinc-100 dark:hover:bg-white/5')}
          >
            <HardDrive size={15} /> Videos
          </Link>
          <ul className="mt-0.5">
            {tree.map((n) => (
              <TreeItem key={n.id} node={n} activeId={folderId} open={open} toggle={(id) => setOpen((o) => (o.has(id) ? new Set([...o].filter((x) => x !== id)) : new Set([...o, id])))} />
            ))}
          </ul>
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-5">
        <nav className="flex flex-wrap items-center gap-1 text-sm text-zinc-500" aria-label="Breadcrumb">
          <Link to="/folders" className="rounded px-1 hover:text-zinc-900 dark:hover:text-white">
            📁 Videos
          </Link>
          {path.map((p) => (
            <span key={p.id} className="flex items-center gap-1">
              <ChevronRight size={14} />
              <Link to={`/folders/${p.id}`} className={clsx('rounded px-1 hover:text-zinc-900 dark:hover:text-white', p.id === folderId && 'font-medium text-zinc-900 dark:text-white')}>
                {p.name}
              </Link>
            </span>
          ))}
        </nav>

        <PageTitle
          title={current?.name ?? 'Folders'}
          subtitle={current ? `${current.videoCount} videos · ${formatBytes(current.totalSize)}` : 'Organise your videos into folders'}
          actions={
            <>
              {current && (
                <Menu
                  items={folderMenu(current).slice(1)}
                  trigger={(p) => (
                    <button {...p} className="btn-secondary" aria-label="Folder actions">
                      <MoreVertical size={16} />
                    </button>
                  )}
                />
              )}
              <button className="btn-secondary" onClick={() => setDialog({ mode: 'create' })}>
                <FolderPlus size={16} /> New folder
              </button>
              <button className="btn-primary" onClick={() => pickVideos(folderId ?? null)}>
                <UploadCloud size={16} /> Upload{current ? ' here' : ''}
              </button>
            </>
          }
        />

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-zinc-200/70 dark:bg-white/5" />)}
          </div>
        ) : children.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {children.map((f) => (
              <div key={f.id} className="card group flex items-center gap-3 p-3 transition hover:border-brand-300 hover:shadow-md dark:hover:border-brand-500/40">
                <Link to={`/folders/${f.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                    <FolderIcon size={20} fill="currentColor" fillOpacity={0.15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{f.name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {f.videoCount} videos · {formatBytes(f.totalSize)}
                    </span>
                  </span>
                </Link>
                <Menu
                  items={folderMenu(f)}
                  trigger={(p) => (
                    <button {...p} className="btn-icon btn-ghost h-8 w-8" aria-label={`Actions for ${f.name}`}>
                      <MoreVertical size={16} />
                    </button>
                  )}
                />
              </div>
            ))}
          </div>
        ) : (
          !folderId && (
            <EmptyState
              icon={<FolderPlus />}
              title="No folders yet"
              message="Create folders like “January”, “Projects” or “Personal” to keep your videos organised."
              action={<button className="btn-primary" onClick={() => setDialog({ mode: 'create' })}><FolderPlus size={16} /> New folder</button>}
            />
          )
        )}

        <div>
          <h2 className="mb-3 text-sm font-semibold text-zinc-500">{current ? 'Videos in this folder' : 'Videos not in a folder'}</h2>
          <VideoBrowser key={folderId ?? 'root'} folderId={folderId ?? 'root'} empty={uploadEmpty(folderId ?? null)} />
        </div>
      </div>

      <FolderNameDialog
        open={!!dialog}
        title={dialog?.mode === 'rename' ? 'Rename folder' : current ? `New folder in “${current.name}”` : 'New folder'}
        initial={dialog?.mode === 'rename' ? dialog.folder.name : ''}
        onClose={() => setDialog(null)}
        onSave={async (name) => {
          if (dialog?.mode === 'rename') await api(`/api/folders/${dialog.folder.id}`, { method: 'PATCH', body: { name } });
          else await api('/api/folders', { body: { name, parentId: folderId ?? null } });
          invalidateLibrary(qc);
          toast.success(dialog?.mode === 'rename' ? 'Folder renamed' : 'Folder created');
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Trash
// ------------------------------------------------------------------------------------------------

export function TrashPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useTrash();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const items = data?.items ?? [];
  const sel = items.filter((v) => selected.has(v.id));
  const total = items.reduce((s, v) => s + v.size, 0);
  const toggle = (v: Video) => setSelected((s) => (s.has(v.id) ? new Set([...s].filter((x) => x !== v.id)) : new Set([...s, v.id])));
  const clear = () => setSelected(new Set());

  return (
    <div className="space-y-5">
      <PageTitle
        title="Trash"
        subtitle={items.length ? `${items.length} videos · ${formatBytes(total)} — still counts toward your storage until deleted forever` : 'Deleted videos stay here before being permanently removed'}
        actions={
          items.length > 0 && (
            <button
              className="btn-secondary text-red-600 dark:text-red-400"
              onClick={() =>
                ui.confirm({
                  title: 'Empty Trash?',
                  message: `All ${items.length} videos in Trash will be permanently deleted. This cannot be undone.`,
                  confirmLabel: 'Empty Trash',
                  danger: true,
                  onConfirm: async () => {
                    await api('/api/videos/trash', { method: 'DELETE' });
                    invalidateLibrary(qc);
                    clear();
                    toast.success('Trash emptied');
                  },
                })
              }
            >
              <Trash2 size={16} /> Empty Trash
            </button>
          )
        }
      />

      {sel.length > 0 && (
        <div className="sticky top-20 z-20 flex items-center gap-2 rounded-2xl bg-zinc-900 px-3 py-1.5 text-white shadow-xl dark:bg-zinc-800">
          <span className="mr-auto text-sm font-medium">{sel.length} selected</span>
          <button className="btn h-8 px-2.5 text-white hover:bg-white/10" onClick={() => restoreVideos(sel, qc).then(clear)}>
            <Undo2 size={16} /> Restore
          </button>
          <button className="btn h-8 px-2.5 text-red-300 hover:bg-red-500/20" onClick={() => deleteForever(sel, qc, clear)}>
            <Trash2 size={16} /> Delete forever
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !items.length ? (
        <EmptyState icon={<Trash2 />} title="Trash is empty" message="Videos you delete appear here and can be restored." />
      ) : (
        <div className="card divide-y divide-zinc-100 overflow-hidden dark:divide-white/5">
          <div className="flex items-center gap-3 px-4 py-2 text-xs font-semibold text-zinc-500 uppercase">
            <Checkbox checked={sel.length === items.length} indeterminate={sel.length > 0 && sel.length < items.length} onChange={(on) => setSelected(on ? new Set(items.map((v) => v.id)) : new Set())} label="Select all" />
            Name
          </div>
          {items.map((v) => (
            <div key={v.id} className={clsx('flex items-center gap-3 px-4 py-2.5', selected.has(v.id) && 'bg-brand-50 dark:bg-brand-500/10')}>
              <Checkbox checked={selected.has(v.id)} onChange={() => toggle(v)} label={`Select ${v.filename}`} />
              <Thumbnail video={v} className="aspect-video w-20 shrink-0 rounded-lg opacity-70" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{v.filename}</div>
                <div className="text-xs text-zinc-500">
                  {formatBytes(v.size)} · deleted {v.deletedAt ? timeAgo(v.deletedAt) : ''} · uploaded {formatDate(v.createdAt)}
                </div>
              </div>
              <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => restoreVideos([v], qc)}>
                <Undo2 size={14} /> <span className="hidden sm:inline">Restore</span>
              </button>
              <button className="btn-ghost h-8 px-2.5 text-xs text-red-600 dark:text-red-400" onClick={() => deleteForever([v], qc)}>
                <Trash2 size={14} /> <span className="hidden sm:inline">Delete forever</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NotFoundPage() {
  return <EmptyState icon={<Film />} title="Page not found" message="The page you're looking for doesn't exist." action={<Link to="/" className="btn-primary">Go to dashboard</Link>} />;
}
