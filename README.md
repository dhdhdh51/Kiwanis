# VidVault — cloud storage built for video

A Google Drive–style platform for videos. You can select 1, 10, 50 or more videos, upload them all at once and watch each file's progress. Uploads are chunked and resumable. Finished videos show up in the library, where you can stream, organise and share them.

## Architecture

```
Browser (React SPA)
  │  1. POST /api/uploads            → API checks the file and the quota, opens a multipart upload
  │  2. POST /api/uploads/:id/parts  → API returns short-lived presigned URLs
  │  3. PUT chunk bytes ─────────────────────────────────────────►  Object storage (S3 / R2 / MinIO)
  │  4. POST /api/uploads/:id/complete → API assembles the parts, checks the content, queues processing
  ▼
API (Node/Express, stateless) ── PostgreSQL (metadata via Prisma)
```

- **Video bytes never pass through the API** when the S3 driver is used. The browser uploads chunks straight to storage over presigned URLs, and playback and downloads use signed GET URLs that support HTTP Range. Storage credentials stay on the server.
- **The API is stateless.** Sessions live in Postgres, so you can run it behind a load balancer. For multi-instance rate limits, plug in a shared store (e.g. Redis) at `middleware/rateLimit.ts`.
- **Storage drivers:** `s3` (AWS S3 and S3-compatible stores) for production, and `local` (disk, with the same multipart/presigned semantics) for development.
- **Processing:** this is a DB-backed queue that recovers after a restart. With ffmpeg installed it extracts duration and resolution, makes a thumbnail, and can optionally create 720p/480p renditions for quality selection. Without ffmpeg, the browser captures duration and a thumbnail before upload. To scale this out, move `services/processing.ts` to a worker behind SQS or BullMQ.

## Feature map

| Area | Where |
|---|---|
| Upload engine: queue, parallel chunks, retry/backoff, offline pause, resume, cancel, duplicate detection | `web/src/upload/engine.ts` |
| Upload preview, progress panel, drag-and-drop anywhere | `web/src/components/upload/*` |
| Upload API + server validation (extension, MIME, size, quota with a row lock, magic-byte sniffing) | `server/src/routes/uploads.ts`, `server/src/lib/formats.ts` |
| Library grid/list, search, filters (date, size, duration, folder, format), 6 sort orders, multi-select bulk actions | `web/src/components/video/*` |
| Folders (nested, rename, delete → contents to Trash, upload into a folder) | `server/src/routes/folders.ts`, `web/src/pages/LibraryPages.tsx` |
| Player: seek, volume, fullscreen, speed, quality, picture-in-picture, keyboard shortcuts | `web/src/components/video/VideoPlayer.tsx` |
| Sharing: unguessable token, public/private, password, expiry, download toggle, regenerate, disable; clean public page | `server/src/routes/public.ts`, `web/src/pages/SharePage.tsx` |
| Auth: register, login, logout, forgot/reset password (Argon2id, hashed server-side session tokens) | `server/src/routes/auth.ts` |
| Admin: stats, users (quota, suspend, role, delete), all videos, live uploads, activity log | `server/src/routes/admin.ts`, `web/src/pages/AdminPage.tsx` |
| Dashboard, Trash, Settings (profile, password, theme, upload concurrency) | `web/src/pages/*` |

**Security:** every query is scoped to the owner, and other users' IDs return 404. Videos are private by default. Cookies are HttpOnly, SameSite=Lax and Secure in production. CSRF is blocked with a custom header plus an Origin check. Login, reset, upload, share-password and public endpoints are rate-limited. Helmet sets a strict CSP. Storage URLs are HMAC- or SigV4-signed and short-lived. Password reset responses do not reveal whether an account exists. A share-password grant is revoked when the password changes.

## Run locally

Requirements: Node 20+ and PostgreSQL. ffmpeg is optional.

```bash
npm install
cp server/.env.example server/.env      # set DATABASE_URL and APP_SECRET
npm run db:deploy                        # apply migrations
npm run dev:server                       # API on :4000
npm run dev:web                          # web on :5173 (proxies /api)
```

On startup the server creates the admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. If SMTP isn't configured, password-reset emails are written to the server log.

### Full stack with Docker (Postgres + MinIO + app)

```bash
docker compose up --build   # http://localhost:4000
```

## Production notes

- Set `NODE_ENV=production`, a long random `APP_SECRET`, and `TRUST_PROXY` (the number of proxies in front of the API). Use HTTPS.
- Run `npm run build`, then `npm start`. The API serves `web/dist` from the same origin.
- **S3 bucket CORS** must allow the browser's direct uploads. Example:
  ```json
  [{ "AllowedOrigins": ["https://your-app.example"], "AllowedMethods": ["PUT", "GET", "HEAD"],
     "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
  ```
  `ETag` must be exposed. Keep the bucket private, with no public access.
- Add an S3 lifecycle rule to abort incomplete multipart uploads after a few days, as a backstop to the built-in cleanup job.
- Tune the limits in `.env`: `MAX_FILE_SIZE_GB`, `DEFAULT_STORAGE_LIMIT_GB`, `UPLOAD_CHUNK_SIZE_MB`, `MAX_CONCURRENT_FILES`, `MAX_CONCURRENT_CHUNKS`, `TRASH_RETENTION_DAYS`.
