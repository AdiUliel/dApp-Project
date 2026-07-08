// Minimal IPFS upload service. Purpose: keep the Pinata JWT off the browser.
// The frontend POSTs files/JSON here; this process (and only this process) holds
// the token and talks to Pinata. It also enforces hard upload limits and tracks
// every pin so orphaned files can be cleaned up later (see pending-store.js).
'use strict'

require('dotenv').config()

const express = require('express')
const cors = require('cors')
const multer = require('multer')

const { pinFile, pinJson } = require('./pinata')
const pending = require('./pending-store')
const { MAX_FILE_SIZE_BYTES, MAX_FILES, ALLOWED_MIME_TYPES } = require('./limits')

const PORT = process.env.PORT || 8787
// Restrict who may call the service. Comma-separated origins, or '*' for dev.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*'

const app = express()
app.use(
  cors({
    origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN.split(',').map((o) => o.trim()),
  }),
)
app.use(express.json({ limit: '1mb' }))

// Multer holds files in memory (they're small and forwarded straight on), and
// enforces the size + count limits. fileFilter enforces the MIME allowlist -
// this is the AUTHORITATIVE check; the browser's accept="" attribute is only a
// hint a malicious client can ignore.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new MulterTypeError(`Unsupported file type: ${file.mimetype}`))
    }
  },
})

class MulterTypeError extends Error {}

app.get('/health', (_req, res) => {
  res.json({ ok: true, jwtConfigured: Boolean(process.env.PINATA_JWT), pending: pending.stats() })
})

// Pin one image. Field name: "file".
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: mapUploadError(err) })
    if (!req.file) return res.status(400).json({ error: 'No file provided' })

    try {
      const cid = await pinFile(req.file.buffer, req.file.originalname, req.file.mimetype)
      pending.recordPending(cid, 'file')
      res.json({ cid })
    } catch (e) {
      console.error('Pin failed:', e)
      res.status(502).json({ error: 'Upstream pinning failed' })
    }
  })
})

// Pin JSON metadata (post/comment bodies).
app.post('/api/upload-json', async (req, res) => {
  const data = req.body && req.body.pinataContent !== undefined ? req.body.pinataContent : req.body
  if (data === undefined || data === null) {
    return res.status(400).json({ error: 'No JSON body provided' })
  }
  try {
    const cid = await pinJson(data)
    pending.recordPending(cid, 'json')
    res.json({ cid })
  } catch (e) {
    console.error('JSON pin failed:', e)
    res.status(502).json({ error: 'Upstream pinning failed' })
  }
})

// The frontend calls this once the transaction referencing these CIDs is mined,
// flipping them from "pending" to "confirmed" so cleanup never touches them.
app.post('/api/confirm', (req, res) => {
  const cids = Array.isArray(req.body && req.body.cids) ? req.body.cids : []
  const confirmed = pending.confirm(cids)
  res.json({ confirmed })
})

function mapUploadError(err) {
  if (err instanceof MulterTypeError) return err.message
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return `File too large (max ${Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB)`
  }
  if (err && err.code === 'LIMIT_FILE_COUNT') return `Too many files (max ${MAX_FILES})`
  return 'Upload rejected'
}

app.listen(PORT, () => {
  console.log(`Upload service on http://localhost:${PORT}`)
  console.log(`  JWT configured: ${Boolean(process.env.PINATA_JWT)}`)
  console.log(`  Limits: ${MAX_FILES} files, ${Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB each, [${ALLOWED_MIME_TYPES.join(', ')}]`)
})

module.exports = app
