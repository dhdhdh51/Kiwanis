export function formatBytes(bytes: number, digits = 1) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${v.toFixed(i === 0 ? 0 : v >= 100 ? 0 : digits)} ${units[i]}`;
}

export function formatSpeed(bps: number) {
  return bps > 0 ? `${formatBytes(bps)}/s` : '—';
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatEta(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min left`;
  return `${(seconds / 3600).toFixed(1)} h left`;
}

export function formatDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return formatDate(iso);
}

export function extOf(name: string) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Triggers a browser download without navigating away (works with signed URLs and API redirects). */
export function triggerDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
