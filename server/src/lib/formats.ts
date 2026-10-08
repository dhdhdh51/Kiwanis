/** Supported video container formats and server-side content sniffing. */

type Family = 'isobmff' | 'matroska' | 'avi';

interface FormatInfo {
  ext: string;
  mime: string;
  family: Family;
  /** Additional MIME types browsers commonly report for this extension */
  aliases: string[];
  /** Whether mainstream browsers can usually play it natively */
  browserPlayable: boolean;
}

export const FORMATS: FormatInfo[] = [
  { ext: 'mp4', mime: 'video/mp4', family: 'isobmff', aliases: [], browserPlayable: true },
  { ext: 'm4v', mime: 'video/x-m4v', family: 'isobmff', aliases: ['video/mp4'], browserPlayable: true },
  { ext: 'mov', mime: 'video/quicktime', family: 'isobmff', aliases: ['video/mp4'], browserPlayable: true },
  { ext: 'webm', mime: 'video/webm', family: 'matroska', aliases: ['audio/webm'], browserPlayable: true },
  { ext: 'mkv', mime: 'video/x-matroska', family: 'matroska', aliases: ['video/matroska', 'video/mkv'], browserPlayable: false },
  { ext: 'avi', mime: 'video/x-msvideo', family: 'avi', aliases: ['video/avi', 'video/msvideo', 'video/vnd.avi'], browserPlayable: false },
];

const GENERIC_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

export function extensionOf(filename: string) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(filename.trim());
  return m ? m[1].toLowerCase() : '';
}

export function formatFor(filename: string): FormatInfo | undefined {
  return FORMATS.find((f) => f.ext === extensionOf(filename));
}

/** Validates the client-declared MIME type against the extension. Returns canonical MIME. */
export function resolveMime(filename: string, declared: string | undefined): FormatInfo | null {
  const fmt = formatFor(filename);
  if (!fmt) return null;
  const d = (declared ?? '').toLowerCase().split(';')[0].trim();
  if (GENERIC_MIME.has(d) || d === fmt.mime || fmt.aliases.includes(d)) return fmt;
  // A video/* type that disagrees with the extension is suspicious but not fatal; content sniffing decides.
  if (d.startsWith('video/')) return fmt;
  return null;
}

/** Detects the container family from the first bytes of a file. */
export function sniffFamily(head: Buffer): Family | null {
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return 'matroska';
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'AVI ') return 'avi';
  if (head.length >= 8) {
    const box = head.toString('latin1', 4, 8);
    if (['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip', 'pnot'].includes(box)) return 'isobmff';
  }
  return null;
}

export function matchesFamily(filename: string, head: Buffer) {
  const fmt = formatFor(filename);
  const fam = sniffFamily(head);
  return !!fmt && fam === fmt.family;
}

export function isImage(head: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Strips path components / control characters and limits length of user-provided names. */
export function sanitizeName(name: string, max = 255) {
  return name
    .replace(/[\\/]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}
