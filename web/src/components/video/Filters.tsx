import clsx from 'clsx';
import { X } from 'lucide-react';
import type { Folder, SortKey } from '../../lib/types';
import type { VideoFilters } from '../../lib/queries';
import { flattenTree } from '../folders/folderTree';

export interface FilterState {
  date: 'any' | 'today' | '7d' | '30d' | 'year' | 'custom';
  from?: string;
  to?: string;
  size: 'any' | 'lt100m' | '100m-1g' | '1g-5g' | 'gt5g';
  duration: 'any' | 'lt1' | '1-5' | '5-20' | 'gt20';
  formats: string[];
  folder: string; // 'any' | 'root' | folderId
}

export const emptyFilters: FilterState = { date: 'any', size: 'any', duration: 'any', formats: [], folder: 'any' };

export const SORTS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'largest', label: 'Largest' },
  { value: 'smallest', label: 'Smallest' },
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
];

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const FORMATS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'];

export function countActive(f: FilterState) {
  return [f.date !== 'any', f.size !== 'any', f.duration !== 'any', f.formats.length > 0, f.folder !== 'any'].filter(Boolean).length;
}

/** Converts UI filter presets to API query parameters. */
export function toQuery(f: FilterState): VideoFilters {
  const q: VideoFilters = {};
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (f.date) {
    case 'today':
      q.from = startOfDay.toISOString();
      break;
    case '7d':
      q.from = new Date(Date.now() - 7 * 86400_000).toISOString();
      break;
    case '30d':
      q.from = new Date(Date.now() - 30 * 86400_000).toISOString();
      break;
    case 'year':
      q.from = new Date(now.getFullYear(), 0, 1).toISOString();
      break;
    case 'custom':
      if (f.from) q.from = new Date(`${f.from}T00:00:00`).toISOString();
      if (f.to) q.to = new Date(`${f.to}T23:59:59.999`).toISOString();
      break;
  }
  const sizes: Record<string, [number?, number?]> = {
    lt100m: [undefined, 100 * MB],
    '100m-1g': [100 * MB, GB],
    '1g-5g': [GB, 5 * GB],
    gt5g: [5 * GB, undefined],
  };
  if (f.size !== 'any') [q.minSize, q.maxSize] = sizes[f.size];
  const durations: Record<string, [number?, number?]> = { lt1: [undefined, 60], '1-5': [60, 300], '5-20': [300, 1200], gt20: [1200, undefined] };
  if (f.duration !== 'any') [q.minDuration, q.maxDuration] = durations[f.duration];
  if (f.formats.length) q.format = f.formats.join(',');
  if (f.folder !== 'any') q.folderId = f.folder;
  return q;
}

function Pills<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={clsx(
            'rounded-full border px-3 py-1 text-xs font-medium transition',
            value === v
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-white/10 dark:text-zinc-300 dark:hover:border-white/25',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function FiltersPanel({
  value,
  onChange,
  folders,
  showFolder,
}: {
  value: FilterState;
  onChange: (f: FilterState) => void;
  folders: Folder[];
  showFolder: boolean;
}) {
  const set = (p: Partial<FilterState>) => onChange({ ...value, ...p });
  return (
    <div className="card grid animate-slide-up gap-5 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <div className="label">Date uploaded</div>
        <Pills
          value={value.date}
          onChange={(date) => set({ date })}
          options={[
            ['any', 'Any time'],
            ['today', 'Today'],
            ['7d', 'Last 7 days'],
            ['30d', 'Last 30 days'],
            ['year', 'This year'],
            ['custom', 'Custom'],
          ]}
        />
        {value.date === 'custom' && (
          <div className="mt-2 flex items-center gap-2">
            <input type="date" className="input py-1.5" value={value.from ?? ''} onChange={(e) => set({ from: e.target.value })} aria-label="From" />
            <span className="text-zinc-400">–</span>
            <input type="date" className="input py-1.5" value={value.to ?? ''} onChange={(e) => set({ to: e.target.value })} aria-label="To" />
          </div>
        )}
      </div>
      <div>
        <div className="label">File size</div>
        <Pills
          value={value.size}
          onChange={(size) => set({ size })}
          options={[
            ['any', 'Any'],
            ['lt100m', '< 100 MB'],
            ['100m-1g', '100 MB – 1 GB'],
            ['1g-5g', '1 – 5 GB'],
            ['gt5g', '> 5 GB'],
          ]}
        />
      </div>
      <div>
        <div className="label">Duration</div>
        <Pills
          value={value.duration}
          onChange={(duration) => set({ duration })}
          options={[
            ['any', 'Any'],
            ['lt1', '< 1 min'],
            ['1-5', '1 – 5 min'],
            ['5-20', '5 – 20 min'],
            ['gt20', '> 20 min'],
          ]}
        />
      </div>
      <div className="space-y-4">
        <div>
          <div className="label">Format</div>
          <div className="flex flex-wrap gap-1.5">
            {FORMATS.map((f) => {
              const on = value.formats.includes(f);
              return (
                <button
                  key={f}
                  onClick={() => set({ formats: on ? value.formats.filter((x) => x !== f) : [...value.formats, f] })}
                  className={clsx(
                    'rounded-full border px-2.5 py-1 text-xs font-semibold uppercase transition',
                    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-300',
                  )}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </div>
        {showFolder && (
          <label className="block">
            <span className="label">Folder</span>
            <select className="input py-1.5" value={value.folder} onChange={(e) => set({ folder: e.target.value })}>
              <option value="any">All folders</option>
              <option value="root">Not in a folder</option>
              {flattenTree(folders).map((f) => (
                <option key={f.id} value={f.id}>
                  {'\u00a0\u00a0\u00a0'.repeat(f.depth)}
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {countActive(value) > 0 && (
        <div className="sm:col-span-2 lg:col-span-4">
          <button className="btn-ghost -ml-2 text-xs" onClick={() => onChange(emptyFilters)}>
            <X size={14} /> Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
