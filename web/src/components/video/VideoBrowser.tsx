import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, FolderInput, FolderPlus, LayoutGrid, List, Search, Share2, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { downloadVideos, trashVideos } from '../../lib/actions';
import { useFolders, useVideos } from '../../lib/queries';
import type { SortKey, Video } from '../../lib/types';
import { ui } from '../../lib/ui';
import { Checkbox, EmptyState, Segmented, Spinner } from '../ui/misc';
import { countActive, emptyFilters, FiltersPanel, SORTS, toQuery, type FilterState } from './Filters';
import { ListHeader, VideoCard, VideoRow } from './VideoCard';

interface Props {
  /** Fixed folder scope ('root' = videos without a folder) */
  folderId?: string;
  shared?: boolean;
  empty: { icon: ReactNode; title: string; message?: string; action?: ReactNode };
  header?: ReactNode;
}

type View = 'grid' | 'list';

export function VideoBrowser({ folderId, shared, empty, header }: Props) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(search);
  const [sort, setSort] = useState<SortKey>(() => (localStorage.getItem('vv-sort') as SortKey) || 'newest');
  const [view, setView] = useState<View>(() => (localStorage.getItem('vv-view') as View) || 'grid');
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Map<string, Video>>(new Map());
  const lastIndex = useRef<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const { data: folderData } = useFolders();

  // Topbar search navigates here with ?q= — only react to external URL changes.
  const written = useRef(params.get('q') ?? '');
  useEffect(() => {
    const q = params.get('q') ?? '';
    if (q === written.current) return;
    written.current = q;
    setSearch(q);
    setDebounced(q);
  }, [params]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      written.current = search;
      const next = new URLSearchParams(params);
      if (search) next.set('q', search);
      else next.delete('q');
      if (next.toString() !== params.toString()) setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => localStorage.setItem('vv-sort', sort), [sort]);
  useEffect(() => localStorage.setItem('vv-view', view), [view]);
  useEffect(() => setSelected(new Map()), [folderId, shared]);

  const query = useMemo(
    () => ({ ...toQuery(filters), ...(folderId ? { folderId } : {}), shared, q: debounced || undefined, sort }),
    [filters, folderId, shared, debounced, sort],
  );
  const { data, isLoading, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage, error } = useVideos(query);
  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const total = data?.pages[0]?.total ?? 0;

  // Infinite scroll
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && hasNextPage && !isFetchingNextPage && fetchNextPage(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Keep selection objects fresh and drop vanished items
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const byId = new Map(items.map((v) => [v.id, v]));
      const next = new Map<string, Video>();
      prev.forEach((_, id) => byId.has(id) && next.set(id, byId.get(id)!));
      return next.size === prev.size && [...next].every(([id, v]) => prev.get(id) === v) ? prev : next;
    });
  }, [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role=dialog]') && setSelected(new Map());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSelect = (v: Video, _additive: boolean, range: boolean) => {
    const idx = items.findIndex((x) => x.id === v.id);
    setSelected((prev) => {
      const next = new Map(prev);
      if (range && lastIndex.current !== null) {
        const [a, b] = [Math.min(lastIndex.current, idx), Math.max(lastIndex.current, idx)];
        items.slice(a, b + 1).forEach((x) => next.set(x.id, x));
      } else if (next.has(v.id)) next.delete(v.id);
      else next.set(v.id, v);
      return next;
    });
    lastIndex.current = idx;
  };

  const sel = [...selected.values()];
  const allSelected = items.length > 0 && sel.length === items.length;
  const toggleAll = (on: boolean) => setSelected(on ? new Map(items.map((v) => [v.id, v])) : new Map());
  const clear = () => setSelected(new Map());
  const filterCount = countActive(filters);
  const isFiltered = !!debounced || filterCount > 0;

  return (
    <div className="space-y-4">
      {header}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
          <input className="input pl-9" placeholder="Search videos by name…" value={search} onChange={(e) => setSearch(e.target.value)} type="search" aria-label="Search videos" />
          {isFetching && !isLoading && <Spinner size={14} className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-400" />}
        </div>
        <button className={clsx('btn-secondary', (showFilters || filterCount > 0) && 'border-brand-500 text-brand-700 dark:text-brand-300')} onClick={() => setShowFilters((s) => !s)}>
          <SlidersHorizontal size={16} /> Filters
          {filterCount > 0 && <span className="chip bg-brand-600 px-1.5 text-white">{filterCount}</span>}
        </button>
        <select className="input w-auto py-2 pr-8" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: <LayoutGrid size={16} />, title: 'Grid view' },
            { value: 'list', label: <List size={16} />, title: 'List view' },
          ]}
        />
      </div>

      {showFilters && <FiltersPanel value={filters} onChange={setFilters} folders={folderData?.folders ?? []} showFolder={!folderId} />}

      {/* Selection / bulk toolbar */}
      {sel.length > 0 ? (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-1 rounded-2xl bg-zinc-900 px-2 py-1.5 text-white shadow-xl sm:top-20 dark:bg-zinc-800">
          <button className="btn-icon h-8 w-8 text-white hover:bg-white/10" onClick={clear} aria-label="Clear selection">
            <X size={16} />
          </button>
          <span className="mr-auto pl-1 text-sm font-medium">{sel.length} selected</span>
          <button className="btn h-8 px-2.5 text-white hover:bg-white/10" onClick={() => downloadVideos(sel)} title="Download selected">
            <Download size={16} /> <span className="hidden md:inline">Download</span>
          </button>
          <button className="btn h-8 px-2.5 text-white hover:bg-white/10" onClick={() => ui.share(sel)} title="Share selected">
            <Share2 size={16} /> <span className="hidden md:inline">Share</span>
          </button>
          <button className="btn h-8 px-2.5 text-white hover:bg-white/10" onClick={() => ui.move(sel, undefined, clear)} title="Move selected">
            <FolderInput size={16} /> <span className="hidden md:inline">Move</span>
          </button>
          <button className="btn h-8 px-2.5 text-white hover:bg-white/10" onClick={() => ui.move(sel, 'Add to folder', clear)} title="Add to folder">
            <FolderPlus size={16} /> <span className="hidden lg:inline">Add to folder</span>
          </button>
          <button className="btn h-8 px-2.5 text-red-300 hover:bg-red-500/20" onClick={() => trashVideos(sel, qc, clear)} title="Delete selected">
            <Trash2 size={16} /> <span className="hidden md:inline">Delete</span>
          </button>
        </div>
      ) : (
        items.length > 0 && (
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <Checkbox checked={false} onChange={() => toggleAll(true)} label="Select all" />
            <span>
              {total} video{total === 1 ? '' : 's'}
              {isFiltered && ' found'}
            </span>
          </div>
        )
      )}

      {/* Results */}
      {error ? (
        <EmptyState icon={<X />} title="Couldn't load videos" message={(error as Error).message} action={<button className="btn-secondary" onClick={() => qc.invalidateQueries({ queryKey: ['videos'] })}>Retry</button>} />
      ) : isLoading ? (
        <div className={clsx(view === 'grid' ? 'grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : 'space-y-2')}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={clsx('animate-pulse rounded-2xl bg-zinc-200/70 dark:bg-white/5', view === 'grid' ? 'aspect-[4/3.6]' : 'h-16')} />
          ))}
        </div>
      ) : items.length === 0 ? (
        isFiltered ? (
          <EmptyState icon={<Search />} title="No matching videos" message="Try a different search term or clear your filters." action={<button className="btn-secondary" onClick={() => (setFilters(emptyFilters), setSearch(''))}>Clear search & filters</button>} />
        ) : (
          <EmptyState {...empty} />
        )
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {items.map((v) => (
            <VideoCard key={v.id} video={v} selected={selected.has(v.id)} selectionMode={sel.length > 0} onSelect={onSelect} />
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <ListHeader allSelected={allSelected} someSelected={sel.length > 0} onToggleAll={toggleAll} />
          <div className="divide-y divide-zinc-100 dark:divide-white/5">
            {items.map((v) => (
              <VideoRow key={v.id} video={v} selected={selected.has(v.id)} selectionMode={sel.length > 0} onSelect={onSelect} />
            ))}
          </div>
        </div>
      )}
      <div ref={sentinel} />
      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}
    </div>
  );
}
