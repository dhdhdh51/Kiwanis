import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, FilePlus2, FileVideo, Folder as FolderIcon, UploadCloud, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useConfig, useFolders, useStats } from '../../lib/queries';
import { extOf, formatBytes } from '../../lib/format';
import { pickVideos, useUi } from '../../lib/ui';
import { enqueue } from '../../upload/engine';
import { flattenTree } from '../folders/folderTree';

interface Checked {
  file: File;
  key: string;
  error?: string;
}

/** Step 2 of the upload flow: preview the selected files, choose a destination, start. */
export function UploadDialog() {
  const dialog = useUi((s) => s.uploadDialog);
  const set = useUi((s) => s.set);
  const { data: config } = useConfig();
  const { data: stats } = useStats();
  const { data: folderData } = useFolders();
  const [folderOverride, setFolderOverride] = useState<string | null | undefined>(undefined);
  const [dragging, setDragging] = useState(false);

  const files = dialog?.files ?? [];
  const folderId = folderOverride !== undefined ? folderOverride : (dialog?.folderId ?? null);
  const close = () => {
    set({ uploadDialog: null });
    setFolderOverride(undefined);
  };

  const checked: Checked[] = useMemo(() => {
    const allowed = new Set(config?.formats.map((f) => f.ext) ?? ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v']);
    const max = config?.maxFileSize ?? Infinity;
    const seen = new Set<string>();
    return files.map((file, i) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      let error: string | undefined;
      if (!allowed.has(extOf(file.name))) error = `Unsupported format${extOf(file.name) ? ` (.${extOf(file.name)})` : ''}`;
      else if (file.size === 0) error = 'File is empty';
      else if (file.size > max) error = `File too large (max ${formatBytes(max)})`;
      else if (seen.has(key)) error = 'Already selected';
      seen.add(key);
      return { file, key: `${key}:${i}`, error };
    });
  }, [files, config]);

  const valid = checked.filter((c) => !c.error);
  const totalSize = valid.reduce((s, c) => s + c.file.size, 0);
  const available = stats?.storageAvailable ?? Infinity;
  const overQuota = totalSize > available;
  const folders = flattenTree(folderData?.folders ?? []);

  const removeAt = (idx: number) => set({ uploadDialog: { files: files.filter((_, i) => i !== idx), folderId: dialog?.folderId ?? null } });
  const addFiles = (more: File[]) => dialog && set({ uploadDialog: { ...dialog, files: [...files, ...more] } });

  const start = () => {
    enqueue(
      valid.map((c) => c.file),
      folderId,
    );
    close();
  };

  return (
    <Modal
      open={!!dialog}
      onClose={close}
      size="lg"
      title={files.length ? `Upload ${valid.length} video${valid.length === 1 ? '' : 's'}` : 'Upload videos'}
      description={files.length ? `${formatBytes(totalSize)} total · review your selection, then start the upload` : 'Select or drop video files'}
      footer={
        <>
          <button className="btn-ghost mr-auto" onClick={() => pickVideos(folderId)}>
            <FilePlus2 size={16} /> Add more
          </button>
          <button className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!valid.length} onClick={start} data-autofocus>
            <UploadCloud size={16} /> Start upload{valid.length > 1 ? ` (${valid.length})` : ''}
          </button>
        </>
      }
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="label">Destination</span>
          <div className="relative">
            <FolderIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
            <select className="input appearance-none pl-9" value={folderId ?? ''} onChange={(e) => setFolderOverride(e.target.value || null)}>
              <option value="">My Videos (no folder)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {'\u00a0\u00a0\u00a0'.repeat(f.depth)}
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </label>

        {overQuota && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Storage limit exceeded: this selection needs {formatBytes(totalSize)} but only {formatBytes(available)} is available. Videos that don't
              fit will fail with a storage-limit error.
            </span>
          </div>
        )}

        {files.length === 0 ? (
          <button
            onClick={() => pickVideos(folderId)}
            className={clsx(
              'flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition',
              dragging ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-zinc-300 hover:border-brand-400 dark:border-white/15',
            )}
          >
            <UploadCloud size={36} className="mb-3 text-brand-500" />
            <span className="font-medium">Drop videos here or click to browse</span>
            <span className="mt-1 text-sm text-zinc-500">MP4, MOV, MKV, AVI, WEBM, M4V</span>
          </button>
        ) : (
          <ul
            className={clsx(
              'divide-y divide-zinc-100 overflow-hidden rounded-2xl border transition dark:divide-white/5',
              dragging ? 'border-brand-500' : 'border-zinc-200 dark:border-white/10',
            )}
          >
            {checked.map((c, i) => (
              <li key={c.key} className={clsx('flex items-center gap-3 px-3 py-2.5', c.error && 'bg-red-50/60 dark:bg-red-500/5')}>
                <div
                  className={clsx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    c.error ? 'bg-red-100 text-red-600 dark:bg-red-500/15' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300',
                  )}
                >
                  <FileVideo size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    <span className="mr-2 text-zinc-400 tabular-nums">{i + 1}.</span>
                    {c.file.name}
                  </div>
                  <div className={clsx('text-xs', c.error ? 'text-red-600 dark:text-red-400' : 'text-zinc-500')}>
                    {formatBytes(c.file.size)}
                    {c.error ? ` — ${c.error}` : ` · ${extOf(c.file.name).toUpperCase()}`}
                  </div>
                </div>
                <button className="btn-icon btn-ghost h-8 w-8" onClick={() => removeAt(i)} aria-label={`Remove ${c.file.name}`}>
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {checked.some((c) => c.error) && (
          <p className="text-xs text-zinc-500">Files with errors are skipped. Supported: MP4, MOV, MKV, AVI, WEBM, M4V.</p>
        )}
      </div>
    </Modal>
  );
}
