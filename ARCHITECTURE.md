# Architecture notes

## IPFS uploads go through a backend service (security)

The Pinata JWT is a write credential for our pinning account. It must **never**
reach the browser: anything in a Vite `import.meta.env.VITE_*` var is inlined into
the shipped JS bundle and is trivially readable in devtools.

So uploads are brokered by [`upload-service/`](upload-service/):

```
browser ──(file/JSON, no token)──▶ upload-service ──(Bearer JWT)──▶ Pinata
```

- The browser ([`reddit-dapp-project/src/ipfs.ts`](reddit-dapp-project/src/ipfs.ts))
  POSTs to `VITE_UPLOAD_SERVICE_URL` and gets back a CID. It holds no token.
- **Reads** stay client-side (public IPFS gateways) — no credential needed.

### File validation (defense in depth)

Limits live in [`upload-service/limits.js`](upload-service/limits.js) and are
**enforced server-side** (multer size/count limits + a MIME allowlist). The
frontend applies the same numbers first as a UX filter, but the server is
authoritative because a hostile client can skip the browser check.

- ≤ 5 MB per file, ≤ 4 files per request
- MIME allowlist: `image/png`, `image/jpeg`, `image/gif`, `image/webp`

## Orphaned IPFS files: EVM ↔ IPFS is not transactional

There is **no atomic transaction spanning IPFS and the EVM.** Publishing content
is two independent steps:

1. Pin the image/metadata to IPFS → get a CID.
2. Send an on-chain transaction (`createPost`, `addComment`, …) that stores the CID.

If step 2 is never sent, reverts, or is dropped, the pin from step 1 is an
**orphan**: storage we pay for that nothing on-chain references. (The reverse —
an on-chain CID whose pin is gone — degrades gracefully already: reads fall back
across multiple gateways in `ipfs.ts`.)

We do **not** try to make these two steps atomic (you can't 2-phase-commit an
external network and a blockchain). Instead the upload service tracks the
lifecycle so orphans can be reclaimed:

| State       | When                                             |
|-------------|--------------------------------------------------|
| `pending`   | the moment a file/JSON is pinned                 |
| `confirmed` | frontend calls `/api/confirm` after the tx mines |

Anything left `pending` past a TTL (24h default) is an orphan candidate.
`upload-service/pending-store.js` records the state; `upload-service/cleanup.js`
(`npm run cleanup`) unpins the stale ones.

### Planned: periodic cleanup

Cleanup is **manual today** and intentionally not auto-run by the server (so a live
demo can't have content unpinned mid-session). The forward plan is to schedule
`cleanup.js` periodically once the service is hosted:

- a cron job / hosted **scheduled function** invoking `npm run cleanup`, or
- an internal `setInterval` gated behind an env flag (e.g. `AUTO_CLEANUP=1`).

Until then, run it by hand (or `--dry-run` to preview) — the tracking data it needs
is already being collected on every upload.
