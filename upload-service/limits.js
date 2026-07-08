// Hard upload limits. These are enforced authoritatively by the server; the
// frontend mirrors the same numbers only as a first-pass filter for UX. Keep the
// two copies in sync (frontend: reddit-dapp-project/src/ipfs.ts).
'use strict'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB per file
const MAX_FILES = 4 // per upload request (matches the post image cap)
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

module.exports = { MAX_FILE_SIZE_BYTES, MAX_FILES, ALLOWED_MIME_TYPES }
