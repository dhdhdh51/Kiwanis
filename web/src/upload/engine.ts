/**
 * Upload engine — lives outside React so uploads keep running while the user navigates the app.
 *
 *  - Files are processed by a queue with a configurable number of concurrent files.
 *  - Each file is split into chunks uploaded in parallel (configurable) straight to object storage
 *    using short-lived presigned URLs requested from the API.
 *  - Chunks retry automatically with exponential backoff; uploads pause while the browser is offline.
 *  - Interrupted uploads resume: the server matches the file fingerprint to its multipart session
 *    and reports which chunks it already has, so only the missing chunks are sent.
 */
import { create } from 'zustand';
import { api, ApiError } from '../lib/api';
import { extractMeta, fingerprint, type VideoMeta } from '../lib/videoFile';

export type UploadState =
  | 'queued'
  | 'preparing'
  | 'uploading'
  | 'offline'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'duplicate';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  type: string;
  folderId: string | null;
  state: UploadState;
  uploadedBytes: number;
  /** bytes / second (smoothed) */
  speed: number;
  error?: string;
  errorCode?: string;
  canRetry: boolean;
  resumed: boolean;
  videoId?: string;
  addedAt: number;
  finishedAt?: number;
}

export interface UploadSettings {
  concurrentFiles: number;
  concurrentChunks: number;
  maxRetries: number;
}

interface Internal {
  file: File;
  run: number;
  uploadId?: string;
  xhrs: Set<XMLHttpRequest>;
  stopped: boolean;
  partBytes: Map<number, number>;
  completedBytes: number;
  sample?: { t: number; bytes: number };
  allowDuplicate: boolean;
  meta?: Promise<VideoMeta>;
  fp?: Promise<string | undefined>;
  lastHeartbeat: number;
}

interface SessionResponse {
  uploadId: string;
  videoId: string;
  chunkSize: number;
  totalChunks: number;
  uploadedParts: number[];
  uploadedBytes: number;
  resumed: boolean;
}

const ACTIVE: UploadState[] = ['preparing', 'uploading', 'offline', 'finalizing'];
export const isActive = (s: UploadState) => ACTIVE.includes(s);

const SETTINGS_KEY = 'vv-upload-settings';
const defaultSettings: UploadSettings = { concurrentFiles: 3, concurrentChunks: 3, maxRetries: 6 };
const loadSettings = (): UploadSettings => {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaultSettings;
  }
};

interface UploadStore {
  items: UploadItem[];
  settings: UploadSettings;
  limits: { maxFiles: number; maxChunks: number };
  panel: 'open' | 'minimized' | 'hidden';
  setPanel: (p: UploadStore['panel']) => void;
  setSettings: (s: Partial<UploadSettings>) => void;
}

export const useUploads = create<UploadStore>((set, get) => ({
  items: [],
  settings: loadSettings(),
  limits: { maxFiles: 6, maxChunks: 6 },
  panel: 'hidden',
  setPanel: (panel) => set({ panel }),
  setSettings: (s) => {
    const settings = { ...get().settings, ...s };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    set({ settings });
    pump();
  },
}));

const internals = new Map<string, Internal>();
const completionListeners = new Set<(item: UploadItem) => void>();
export const onUploadComplete = (fn: (item: UploadItem) => void) => {
  completionListeners.add(fn);
  return () => completionListeners.delete(fn);
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);

function patch(id: string, p: Partial<UploadItem>) {
  useUploads.setState((s) => ({ items: s.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }));
}
const getItem = (id: string) => useUploads.getState().items.find((i) => i.id === id);

class StopError extends Error {}
class PartError extends Error {
  constructor(public status: number) {
    super(status === 0 ? 'Network error' : `Chunk upload failed (HTTP ${status})`);
  }
  get retriable() {
    return this.status === 0 || this.status === 403 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

function effectiveSettings() {
  const { settings, limits } = useUploads.getState();
  return {
    files: Math.max(1, Math.min(settings.concurrentFiles, limits.maxFiles)),
    chunks: Math.max(1, Math.min(settings.concurrentChunks, limits.maxChunks)),
    retries: Math.max(0, Math.min(settings.maxRetries, 20)),
  };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export function setServerLimits(maxFiles: number, maxChunks: number) {
  useUploads.setState({ limits: { maxFiles, maxChunks } });
}

export function enqueue(files: File[], folderId: string | null) {
  const items: UploadItem[] = files.map((f) => ({
    id: uid(),
    name: f.name,
    size: f.size,
    type: f.type,
    folderId,
    state: 'queued',
    uploadedBytes: 0,
    speed: 0,
    canRetry: false,
    resumed: false,
    addedAt: Date.now(),
  }));
  items.forEach((it, i) =>
    internals.set(it.id, { file: files[i], run: 0, xhrs: new Set(), stopped: false, partBytes: new Map(), completedBytes: 0, allowDuplicate: false, lastHeartbeat: 0 }),
  );
  useUploads.setState((s) => ({ items: [...s.items, ...items], panel: 'open' }));
  pump();
}

export function cancel(id: string) {
  const it = getItem(id);
  const int = internals.get(id);
  if (!it || !int || ['completed', 'cancelled'].includes(it.state)) return;
  stopInternal(int);
  patch(id, { state: 'cancelled', speed: 0, error: undefined, finishedAt: Date.now(), canRetry: true });
  if (int.uploadId) api(`/api/uploads/${int.uploadId}`, { method: 'DELETE' }).catch(() => undefined);
  int.uploadId = undefined;
  pump();
}

export function retry(id: string) {
  const it = getItem(id);
  if (!it || !['failed', 'cancelled', 'duplicate'].includes(it.state)) return;
  patch(id, { state: 'queued', error: undefined, errorCode: undefined, speed: 0, finishedAt: undefined });
  pump();
}

export function uploadAnyway(id: string) {
  const int = internals.get(id);
  if (int) int.allowDuplicate = true;
  retry(id);
}

export function retryAllFailed() {
  useUploads.getState().items.filter((i) => i.state === 'failed' && i.canRetry).forEach((i) => retry(i.id));
}

export function cancelAll() {
  useUploads.getState().items.filter((i) => i.state === 'queued' || isActive(i.state)).forEach((i) => cancel(i.id));
}

export function clearFinished() {
  const keep = useUploads.getState().items.filter((i) => i.state === 'queued' || isActive(i.state) || i.state === 'failed');
  useUploads.getState().items.forEach((i) => !keep.includes(i) && internals.delete(i.id));
  useUploads.setState({ items: keep, panel: keep.length ? useUploads.getState().panel : 'hidden' });
}

export function dismissAll() {
  cancelAll();
  internals.clear();
  useUploads.setState({ items: [], panel: 'hidden' });
}

// ---------------------------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------------------------

function pump() {
  const { files } = effectiveSettings();
  const items = useUploads.getState().items;
  let running = items.filter((i) => isActive(i.state)).length;
  for (const it of items) {
    if (running >= files) break;
    if (it.state !== 'queued') continue;
    running++;
    void runItem(it.id);
  }
  ensureTicker();
}

function stopInternal(int: Internal) {
  int.stopped = true;
  int.xhrs.forEach((x) => x.abort());
  int.xhrs.clear();
  int.partBytes.clear();
}

async function withRetry<T>(fn: () => Promise<T>, int: Internal, run: number, retries: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (int.stopped || int.run !== run) throw new StopError();
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ApiError) || !err.retriable || attempt >= retries) throw err;
      await waitOnline(int);
      await sleep(backoff(attempt));
    }
  }
}

function waitOnline(int: Internal, id?: string): Promise<void> {
  if (navigator.onLine) return Promise.resolve();
  if (id) patch(id, { state: 'offline', speed: 0 });
  return new Promise((resolve) => {
    const on = () => {
      window.removeEventListener('online', on);
      if (id && !int.stopped) patch(id, { state: 'uploading' });
      resolve();
    };
    window.addEventListener('online', on);
  });
}

async function runItem(id: string) {
  const int = internals.get(id);
  if (!int) return;
  const run = ++int.run;
  int.stopped = false;
  int.partBytes.clear();
  int.sample = undefined;
  const { chunks, retries } = effectiveSettings();
  const file = int.file;
  const item = getItem(id)!;

  try {
    patch(id, { state: 'preparing', error: undefined, errorCode: undefined, canRetry: false });
    int.fp ??= fingerprint(file).catch(() => undefined);
    int.meta ??= extractMeta(file).catch(() => ({}));
    const fp = await int.fp;
    // Wait briefly for duration so it is stored right away (thumbnail is uploaded after completion).
    const early = await Promise.race([int.meta, sleep(1500).then(() => ({}) as VideoMeta)]);

    const session = await withRetry(
      () =>
        api<SessionResponse>('/api/uploads', {
          body: {
            filename: file.name,
            size: file.size,
            mimeType: file.type || undefined,
            folderId: item.folderId,
            fingerprint: fp,
            duration: early.duration,
            width: early.width,
            height: early.height,
            allowDuplicate: int.allowDuplicate || undefined,
          },
        }),
      int,
      run,
      retries,
    );
    int.uploadId = session.uploadId;
    int.completedBytes = session.uploadedBytes;
    patch(id, { state: 'uploading', uploadedBytes: session.uploadedBytes, resumed: session.resumed, videoId: session.videoId });

    const done = new Set(session.uploadedParts);
    const all = Array.from({ length: session.totalChunks }, (_, i) => i + 1);
    await uploadParts(id, int, run, session, all.filter((n) => !done.has(n)), chunks, retries);

    // ---- Finalise (re-sends any chunk the server reports missing) ----
    patch(id, { state: 'finalizing', speed: 0 });
    let video: { id: string } | undefined;
    for (let pass = 0; pass < 3 && !video; pass++) {
      try {
        video = (await withRetry(() => api<{ video: { id: string } }>(`/api/uploads/${session.uploadId}/complete`, { method: 'POST' }), int, run, retries)).video;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'UPLOAD_INCOMPLETE' && pass < 2) {
          const missing = ((err.details as { missingParts?: number[] })?.missingParts ?? []).filter((n) => n <= session.totalChunks);
          int.completedBytes = Math.max(0, file.size - missing.reduce((s, n) => s + partSize(session, file.size, n), 0));
          patch(id, { state: 'uploading' });
          await uploadParts(id, int, run, session, missing, chunks, retries);
          patch(id, { state: 'finalizing' });
          continue;
        }
        throw err;
      }
    }
    if (!video) throw new ApiError(500, 'INTERNAL', 'Could not finalise upload');

    // ---- Best-effort client-side metadata (when the server has no ffmpeg) ----
    const meta = await Promise.race([int.meta, sleep(8000).then(() => ({}) as VideoMeta)]);
    if (meta.thumbnail) {
      await api(`/api/videos/${video.id}/thumbnail`, { method: 'PUT', body: meta.thumbnail, headers: { 'Content-Type': 'image/jpeg' } }).catch(() => undefined);
    }
    if (meta.duration && !early.duration) {
      await api(`/api/videos/${video.id}/metadata`, { body: { duration: meta.duration, width: meta.width, height: meta.height } }).catch(() => undefined);
    }

    if (int.run !== run) return;
    int.uploadId = undefined;
    patch(id, { state: 'completed', uploadedBytes: file.size, speed: 0, finishedAt: Date.now(), videoId: video.id });
    const finished = getItem(id);
    if (finished) completionListeners.forEach((fn) => fn(finished));
  } catch (err) {
    if (err instanceof StopError || int.run !== run) return;
    if ((err as Error).name === 'AbortError') return;
    stopInternal(int);
    if (err instanceof ApiError && err.code === 'DUPLICATE') {
      const dup = (err.details as { video?: { id: string } })?.video;
      patch(id, { state: 'duplicate', error: err.message, errorCode: err.code, canRetry: true, speed: 0, videoId: dup?.id, finishedAt: Date.now() });
    } else {
      const code = err instanceof ApiError ? err.code : err instanceof PartError ? (err.status === 0 ? 'NETWORK' : 'CHUNK_FAILED') : 'UNKNOWN';
      const permanent = ['UNSUPPORTED_FORMAT', 'FILE_TOO_LARGE', 'INVALID_FILE'].includes(code);
      const message =
        code === 'NETWORK' ? 'Network failure — upload interrupted. Retry to resume where it stopped.' : (err as Error).message || 'Upload failed';
      patch(id, { state: 'failed', error: message, errorCode: code, canRetry: !permanent, speed: 0, finishedAt: Date.now() });
    }
  } finally {
    if (int.run === run) pump();
  }
}

function partSize(session: SessionResponse, size: number, n: number) {
  return n < session.totalChunks ? session.chunkSize : size - session.chunkSize * (session.totalChunks - 1);
}

async function uploadParts(
  id: string,
  int: Internal,
  run: number,
  session: SessionResponse,
  pending: number[],
  concurrency: number,
  retries: number,
) {
  const file = int.file;
  const queue = [...pending];
  const urls = new Map<number, Promise<{ url: string; at: number }>>();
  const URL_TTL = 40 * 60_000;

  const getUrl = async (n: number) => {
    const cached = urls.get(n);
    if (cached) {
      const v = await cached.catch(() => null);
      if (v && Date.now() - v.at < URL_TTL) return v.url;
      urls.delete(n);
    }
    // Presign this part plus the next few queued ones in one request.
    const batch = [n, ...queue.filter((p) => !urls.has(p) && p !== n).slice(0, 19)];
    const req = withRetry(
      () => api<{ parts: { partNumber: number; url: string }[] }>(`/api/uploads/${session.uploadId}/parts`, { body: { partNumbers: batch } }),
      int,
      run,
      retries,
    ).then((r) => new Map(r.parts.map((p) => [p.partNumber, p.url])));
    for (const p of batch) {
      urls.set(
        p,
        req.then((m) => ({ url: m.get(p)!, at: Date.now() })),
      );
    }
    try {
      return (await urls.get(n)!).url;
    } catch (err) {
      batch.forEach((p) => urls.delete(p));
      throw err;
    }
  };

  const putPart = (url: string, n: number, blob: Blob) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      int.xhrs.add(xhr);
      xhr.open('PUT', url);
      xhr.timeout = 15 * 60_000;
      xhr.upload.onprogress = (e) => int.partBytes.set(n, e.loaded);
      xhr.onload = () => {
        int.xhrs.delete(xhr);
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new PartError(xhr.status));
      };
      xhr.onerror = () => (int.xhrs.delete(xhr), reject(new PartError(0)));
      xhr.ontimeout = () => (int.xhrs.delete(xhr), reject(new PartError(408)));
      xhr.onabort = () => (int.xhrs.delete(xhr), reject(new StopError()));
      xhr.send(blob);
    });

  const uploadOne = async (n: number) => {
    const start = (n - 1) * session.chunkSize;
    const len = partSize(session, file.size, n);
    const blob = file.slice(start, start + len);
    for (let attempt = 0; ; attempt++) {
      if (int.stopped || int.run !== run) throw new StopError();
      await waitOnline(int, id);
      try {
        const url = await getUrl(n);
        await putPart(url, n, blob);
        int.partBytes.delete(n);
        int.completedBytes += len;
        return;
      } catch (err) {
        int.partBytes.delete(n);
        if (err instanceof StopError || int.stopped) throw new StopError();
        if (err instanceof PartError && err.status === 403) urls.delete(n); // expired URL → re-sign
        const retriable = err instanceof PartError ? err.retriable : err instanceof ApiError ? err.retriable : false;
        if (!retriable || attempt >= retries) throw err;
        if (!navigator.onLine) continue; // wait for network without consuming a retry
        await sleep(backoff(attempt));
      }
    }
  };

  let failure: unknown;
  const worker = async () => {
    while (queue.length && !failure) {
      const n = queue.shift()!;
      try {
        await uploadOne(n);
      } catch (err) {
        failure ??= err;
        // Stop sibling chunk uploads for this file.
        int.xhrs.forEach((x) => x.abort());
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  if (failure) throw failure;
}

// ---------------------------------------------------------------------------------------------
// Progress ticker (throttled store updates, speed calculation, server heartbeats)
// ---------------------------------------------------------------------------------------------

let ticker: ReturnType<typeof setInterval> | null = null;

function ensureTicker() {
  if (ticker) return;
  ticker = setInterval(tick, 400);
}

function tick() {
  const items = useUploads.getState().items;
  const active = items.filter((i) => i.state === 'uploading' || i.state === 'offline');
  if (!items.some((i) => isActive(i.state) || i.state === 'queued')) {
    clearInterval(ticker!);
    ticker = null;
    return;
  }
  if (!active.length) return;
  const now = performance.now();
  const updates = new Map<string, Partial<UploadItem>>();
  for (const it of active) {
    const int = internals.get(it.id);
    if (!int) continue;
    let inflight = 0;
    int.partBytes.forEach((b) => (inflight += b));
    const bytes = Math.min(it.size, int.completedBytes + inflight);
    let speed = it.speed;
    if (!int.sample) int.sample = { t: now, bytes };
    else if (now - int.sample.t >= 1000) {
      const inst = Math.max(0, ((bytes - int.sample.bytes) * 1000) / (now - int.sample.t));
      speed = speed ? speed * 0.6 + inst * 0.4 : inst;
      int.sample = { t: now, bytes };
    }
    updates.set(it.id, { uploadedBytes: bytes, speed: it.state === 'offline' ? 0 : speed });
    if (int.uploadId && Date.now() - int.lastHeartbeat > 5000) {
      int.lastHeartbeat = Date.now();
      api(`/api/uploads/${int.uploadId}/progress`, { body: { uploadedBytes: int.completedBytes } }).catch(() => undefined);
    }
  }
  useUploads.setState((s) => ({ items: s.items.map((i) => (updates.has(i.id) ? { ...i, ...updates.get(i.id) } : i)) }));
}

// Warn before leaving the page while uploads are running (SPA navigation is unaffected).
window.addEventListener('beforeunload', (e) => {
  if (useUploads.getState().items.some((i) => isActive(i.state) || i.state === 'queued')) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/** Aggregate numbers for the panel header: "Uploading 20 videos — 72%". */
export function summarize(items: UploadItem[]) {
  const relevant = items.filter((i) => i.state !== 'cancelled');
  const total = relevant.length;
  const completed = relevant.filter((i) => i.state === 'completed').length;
  const failed = relevant.filter((i) => i.state === 'failed').length;
  const duplicates = relevant.filter((i) => i.state === 'duplicate').length;
  const active = relevant.filter((i) => isActive(i.state)).length;
  const queued = relevant.filter((i) => i.state === 'queued').length;
  const counted = relevant.filter((i) => i.state !== 'duplicate' && !(i.state === 'failed' && !i.canRetry));
  const totalBytes = counted.reduce((s, i) => s + i.size, 0);
  const sentBytes = counted.reduce((s, i) => s + (i.state === 'completed' ? i.size : i.uploadedBytes), 0);
  const speed = relevant.reduce((s, i) => s + (i.state === 'uploading' ? i.speed : 0), 0);
  return {
    total,
    completed,
    failed,
    duplicates,
    active,
    queued,
    totalBytes,
    sentBytes,
    speed,
    percent: totalBytes ? Math.min(100, (sentBytes / totalBytes) * 100) : completed === total && total ? 100 : 0,
    running: active + queued > 0,
  };
}
