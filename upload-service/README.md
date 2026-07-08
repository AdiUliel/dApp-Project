# Upload service

A tiny backend that pins IPFS content for the dApp so the **Pinata JWT never ships
to the browser**. Previously the frontend embedded `VITE_PINATA_JWT` directly in
the JS bundle (anyone could read it from devtools and pin/unpin on our account).
Now the browser talks only to this service; the token lives here in `.env`.

## Run

```bash
cd upload-service
npm install
cp .env.example .env        # then paste your Pinata JWT
npm start                   # http://localhost:8787
```

Point the frontend at it with `VITE_UPLOAD_SERVICE_URL=http://localhost:8787`
(defaults to that if unset).

## Endpoints

| Method | Path               | Body                    | Returns        |
|--------|--------------------|-------------------------|----------------|
| GET    | `/health`          | –                       | status + stats |
| POST   | `/api/upload`      | multipart, field `file` | `{ cid }`      |
| POST   | `/api/upload-json` | JSON                    | `{ cid }`      |
| POST   | `/api/confirm`     | `{ cids: string[] }`    | `{ confirmed }`|

## Enforced limits (authoritative — see `limits.js`)

- Max **5 MB** per file
- Max **4 files** per request
- MIME allowlist: `image/png`, `image/jpeg`, `image/gif`, `image/webp`

The frontend applies the same limits as a first-pass filter for UX, but the
server is the source of truth — a client can bypass the browser check, not this.

## Orphaned files & cleanup

Pinning to IPFS and referencing the CID on-chain are **two separate steps with no
shared transaction** (see the repo's `ARCHITECTURE.md`). A pin whose transaction
is never sent/mined becomes an orphan.

This service tracks every pin (`pending-store.js`):

1. On pin → recorded as `pending`.
2. Frontend calls `/api/confirm` after the referencing tx is mined → `confirmed`.
3. `npm run cleanup` unpins anything still `pending` past `PENDING_TTL_MS` (24h
   default). Use `npm run cleanup -- --dry-run` to preview.

Cleanup is **manual today**; a production deployment should schedule it (cron or a
hosted scheduled function). It is deliberately not auto-run by the server so a live
demo can't have content unpinned mid-session.
