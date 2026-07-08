// Tracks every pin this service creates so orphans can be found and cleaned up.
//
// WHY THIS EXISTS (see ARCHITECTURE.md, "Orphaned IPFS files"): pinning a file to
// IPFS and referencing its CID on-chain are two SEPARATE steps with no shared
// transaction. A user can upload an image (pinned) and then never send - or fail
// to mine - the post/comment transaction that references it. That CID is now an
// orphan: paid-for storage nothing points to.
//
// The lifecycle: a pin starts as `pending`. Once the referencing transaction is
// mined the frontend calls /api/confirm and it flips to `confirmed`. Anything
// still `pending` past a TTL is an orphan candidate for cleanup (unpin).
//
// Storage is a flat JSON file - deliberately dependency-free for a course
// project. Swap for SQLite/Postgres if this ever needs concurrency.
'use strict'

const fs = require('fs')
const path = require('path')

const STORE_PATH = path.join(__dirname, 'pending-uploads.json')

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeAll(records) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(records, null, 2) + '\n')
}

// kind: 'file' | 'json'. Recorded the moment a pin succeeds.
function recordPending(cid, kind) {
  const records = readAll()
  // Keep the earliest createdAt if the same CID is pinned again (dedup content).
  if (!records[cid]) {
    records[cid] = { cid, kind, status: 'pending', createdAt: Date.now(), confirmedAt: null }
    writeAll(records)
  }
  return records[cid]
}

// Called after the on-chain transaction that references these CIDs is mined.
function confirm(cids) {
  const records = readAll()
  let changed = 0
  for (const cid of cids) {
    if (records[cid] && records[cid].status !== 'confirmed') {
      records[cid].status = 'confirmed'
      records[cid].confirmedAt = Date.now()
      changed++
    }
  }
  if (changed > 0) writeAll(records)
  return changed
}

// Orphan candidates: still pending and older than maxAgeMs.
function listOrphans(maxAgeMs) {
  const now = Date.now()
  return Object.values(readAll()).filter(
    (r) => r.status === 'pending' && now - r.createdAt > maxAgeMs,
  )
}

function remove(cid) {
  const records = readAll()
  if (records[cid]) {
    delete records[cid]
    writeAll(records)
  }
}

function stats() {
  const all = Object.values(readAll())
  return {
    total: all.length,
    pending: all.filter((r) => r.status === 'pending').length,
    confirmed: all.filter((r) => r.status === 'confirmed').length,
  }
}

module.exports = { recordPending, confirm, listOrphans, remove, stats, STORE_PATH }
