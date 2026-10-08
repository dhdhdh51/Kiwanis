/** Browser-side helpers for selected video files: fingerprinting and metadata/thumbnail extraction. */

const SAMPLE = 4 * 1024 * 1024;

/**
 * Quick content fingerprint: SHA-256 over size + first 4 MB + middle 1 MB + last 4 MB.
 * Lets the server resume interrupted uploads of the same file and detect duplicates
 * without hashing multi-gigabyte files end to end.
 */
export async function fingerprint(file: File): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const parts: BlobPart[] = [new TextEncoder().encode(`${file.size}:`)];
  if (file.size <= SAMPLE * 3) parts.push(file);
  else {
    const mid = Math.floor(file.size / 2);
    parts.push(file.slice(0, SAMPLE), file.slice(mid, mid + 1024 * 1024), file.slice(file.size - SAMPLE));
  }
  const buf = await new Blob(parts).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface VideoMeta {
  duration?: number;
  width?: number;
  height?: number;
  thumbnail?: Blob;
}

// Limit simultaneous <video> decoders when many files are queued.
let active = 0;
const waiters: (() => void)[] = [];
async function acquire() {
  if (active < 2) return void active++;
  await new Promise<void>((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  waiters.shift()?.();
}

/** Reads duration/resolution and captures a JPEG thumbnail using the browser's decoder. */
export async function extractMeta(file: File, timeoutMs = 12000): Promise<VideoMeta> {
  await acquire();
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  const meta: VideoMeta = {};
  try {
    return await new Promise<VideoMeta>((resolve) => {
      const done = () => resolve(meta);
      const timer = setTimeout(done, timeoutMs);
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.onerror = () => {
        clearTimeout(timer);
        done();
      };
      let probingDuration = false;
      video.onloadedmetadata = () => {
        if (video.videoWidth) {
          meta.width = video.videoWidth;
          meta.height = video.videoHeight;
        }
        if (Number.isFinite(video.duration) && video.duration > 0) {
          meta.duration = video.duration;
          video.currentTime = Math.min(2, meta.duration * 0.1);
        } else {
          // Streamed WebM/MKV often lack a duration header: seeking past the end makes the browser compute it.
          probingDuration = true;
          video.currentTime = 1e101;
        }
      };
      video.onseeked = () => {
        if (probingDuration) {
          probingDuration = false;
          if (Number.isFinite(video.duration) && video.duration > 0) meta.duration = video.duration;
          video.currentTime = Math.min(2, (meta.duration ?? 1) * 0.1);
          return;
        }
        try {
          const w = Math.min(640, video.videoWidth || 640);
          const h = Math.round((w / (video.videoWidth || 16)) * (video.videoHeight || 9));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
          canvas.toBlob(
            (blob) => {
              clearTimeout(timer);
              if (blob && blob.size > 1000) meta.thumbnail = blob;
              done();
            },
            'image/jpeg',
            0.82,
          );
        } catch {
          clearTimeout(timer);
          done();
        }
      };
      video.src = url;
    });
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    release();
  }
}
