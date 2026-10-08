export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** Network failures, timeouts, 5xx and 429 are worth retrying automatically. */
  get retriable() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

interface Options {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Don't fire the global sign-out handler on 401 */
  silent401?: boolean;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'VidVault', ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body instanceof Blob) body = opts.body;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin', signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Network error — check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && !opts.silent401) onUnauthorized?.();
    throw new ApiError(
      res.status,
      e?.code ?? 'HTTP_' + res.status,
      e?.message ?? (res.status >= 500 ? 'Server error — please try again.' : `Request failed (${res.status})`),
      e?.details,
    );
  }
  return data as T;
}

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};
