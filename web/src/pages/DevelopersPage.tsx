import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '../components/layout/AppShell';

const origin = window.location.origin;

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-zinc-900 p-4 text-[12.5px] leading-relaxed text-zinc-100 dark:bg-black/50">
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

const endpoints: [string, string, string][] = [
  ['POST', '/api/auth/token', 'Sign in with email + password → returns a Bearer token (used by the Android app)'],
  ['GET', '/api/me/stats', 'Storage used / limit, video count'],
  ['GET', '/api/videos', 'List videos — q, folderId, format, from, to, minSize, maxSize, minDuration, maxDuration, sort, page, pageSize'],
  ['GET', '/api/videos/:id', 'Video details'],
  ['PATCH', '/api/videos/:id', 'Rename { filename } or move { folderId }'],
  ['DELETE', '/api/videos/:id', 'Move to trash (?permanent=true deletes forever)'],
  ['GET', '/api/videos/:id/playback', 'Short-lived signed streaming URLs'],
  ['GET', '/api/videos/:id/download', 'Redirects to a signed download URL'],
  ['PUT', '/api/videos/:id/share', 'Create / update share link { isPublic, password, expiresAt, allowDownload, allowEmbed }'],
  ['DELETE', '/api/videos/:id/share', 'Disable sharing'],
  ['GET', '/api/folders', 'List folders'],
  ['POST', '/api/folders', 'Create folder { name, parentId }'],
  ['POST', '/api/uploads', 'Start or resume a chunked upload'],
  ['POST', '/api/uploads/:id/parts', 'Get upload URLs for chunks { partNumbers: [1,2,…] }'],
  ['POST', '/api/uploads/:id/complete', 'Finish the upload'],
  ['DELETE', '/api/uploads/:id', 'Cancel an upload'],
];

const publicEndpoints: [string, string, string][] = [
  ['GET', '/embed/:token', 'Embeddable player page (use in an <iframe>)'],
  ['GET', '/api/public/s/:token', 'Share metadata + signed sources (JSON, CORS enabled)'],
  ['GET', '/api/public/s/:token/stream', 'Direct video URL for <video src> (?quality=720p)'],
  ['GET', '/api/public/s/:token/poster', 'Thumbnail image'],
  ['GET', '/api/public/s/:token/download', 'Download (if the owner allows it)'],
  ['GET', '/api/public/oembed?url=…', 'oEmbed JSON for a share link'],
];

function Table({ rows }: { rows: [string, string, string][] }) {
  const color: Record<string, string> = {
    GET: 'text-emerald-600 dark:text-emerald-400',
    POST: 'text-sky-600 dark:text-sky-400',
    PUT: 'text-amber-600 dark:text-amber-400',
    PATCH: 'text-amber-600 dark:text-amber-400',
    DELETE: 'text-red-600 dark:text-red-400',
  };
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
          {rows.map(([m, p, d]) => (
            <tr key={m + p}>
              <td className={`w-20 px-4 py-2.5 font-mono text-xs font-bold ${color[m]}`}>{m}</td>
              <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{p}</td>
              <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Public developer documentation: embedding videos on other sites and the REST API. */
export function DevelopersPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200/70 bg-zinc-50/80 px-4 py-3 backdrop-blur sm:px-8 dark:border-white/5 dark:bg-[#0b0b12]/80">
        <Logo />
        <Link to="/" className="btn-secondary text-sm">
          Open app
        </Link>
      </header>
      <main className="mx-auto max-w-4xl space-y-10 px-4 py-10 sm:px-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Developers</h1>
          <p className="mt-2 text-zinc-500">Show VidVault videos on any website, and automate uploads and management through the API.</p>
          <nav className="mt-4 flex flex-wrap gap-2 text-sm">
            {[
              ['embed', 'Embed a video'],
              ['direct', 'Direct video URL'],
              ['auth', 'Authentication'],
              ['api', 'API reference'],
              ['upload', 'Uploading'],
            ].map(([id, label]) => (
              <a key={id} href={`#${id}`} className="chip border border-zinc-200 px-3 py-1 hover:border-brand-400 dark:border-white/10">
                {label}
              </a>
            ))}
          </nav>
        </div>

        <Section id="embed" title="1. Embed a video on your website">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Open a video → <b>Share</b> → create a public link → <b>Embed on a website</b>. Copy the code into your page. Viewers see only the player
            — never your library. Password-protected links ask for the password inside the player.
          </p>
          <Code>{`<!-- Responsive (recommended) -->
<div style="position:relative;padding-top:56.25%">
  <iframe src="${origin}/embed/SHARE_TOKEN"
          style="position:absolute;inset:0;width:100%;height:100%;border:0"
          allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
</div>`}</Code>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Add <code>?autoplay=1</code> to the iframe URL to start playback automatically (most browsers only allow muted autoplay). Turning off
            “Allow embedding” or disabling the share link stops the embed everywhere instantly.
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <b>WordPress, Notion, chat apps:</b> share pages publish Open Graph and{' '}
            <a className="text-brand-600 hover:underline dark:text-brand-400" href="https://oembed.com" target="_blank" rel="noopener">
              oEmbed
            </a>{' '}
            data, so pasting the share link shows a preview or player where supported.
          </p>
        </Section>

        <Section id="direct" title="2. Direct video URL (your own player)">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            For public links without a password, use the stream URL with any HTML5 player (Video.js, Plyr, …). It redirects to a short-lived signed
            storage URL, so the link keeps working while your files stay private.
          </p>
          <Code>{`<video controls playsinline preload="metadata"
       poster="${origin}/api/public/s/SHARE_TOKEN/poster"
       src="${origin}/api/public/s/SHARE_TOKEN/stream"></video>`}</Code>
          <Code>{`// Or fetch metadata + all quality sources (CORS enabled)
const r = await fetch('${origin}/api/public/s/SHARE_TOKEN');
const { video, sources, poster } = await r.json();`}</Code>
          <Table rows={publicEndpoints} />
        </Section>

        <Section id="auth" title="3. Authentication">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Create an API key in <Link to="/settings" className="text-brand-600 hover:underline dark:text-brand-400">Settings → API keys</Link> and send
            it as a Bearer token. Keys act as your account — keep them on your server, never in public JavaScript.
          </p>
          <Code>{`curl ${origin}/api/videos?sort=newest \\
  -H "Authorization: Bearer vv_YOUR_KEY"`}</Code>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Errors are JSON: <code>{`{ "error": { "code": "QUOTA_EXCEEDED", "message": "…" } }`}</code>. Requests are rate limited (HTTP 429).
          </p>
        </Section>

        <Section id="api" title="4. API reference">
          <Table rows={endpoints} />
        </Section>

        <Section id="upload" title="5. Uploading a video">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Uploads are chunked and resumable. The bytes go straight to storage through short-lived URLs; calling <code>POST /api/uploads</code> again
            with the same <code>fingerprint</code> resumes and returns the chunks already received.
          </p>
          <Code>{`# 1. start (or resume)
curl -X POST ${origin}/api/uploads -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"filename":"clip.mp4","size":52428800,"mimeType":"video/mp4","fingerprint":"<sha256 hex, optional>"}'
# → { "uploadId", "chunkSize", "totalChunks", "uploadedParts": [] }

# 2. get URLs for chunks, then PUT each chunk's bytes (bytes [(n-1)*chunkSize, n*chunkSize) )
curl -X POST ${origin}/api/uploads/UPLOAD_ID/parts -H "Authorization: Bearer $KEY" \\
  -H "Content-Type: application/json" -d '{"partNumbers":[1,2,3]}'
curl -X PUT --data-binary @chunk1.bin "<url from response>"   # relative URLs are on ${origin}

# 3. finish
curl -X POST ${origin}/api/uploads/UPLOAD_ID/complete -H "Authorization: Bearer $KEY"`}</Code>
        </Section>
      </main>
    </div>
  );
}
