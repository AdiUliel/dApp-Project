// Orphan cleanup: unpin files that were pinned but never confirmed on-chain
// within the TTL. Run manually (`npm run cleanup`) for now; a future deployment
// should schedule this (cron / a hosted scheduled function) to run periodically.
//
// It is intentionally NOT invoked automatically by the server so a live demo can
// never have content unpinned out from under it mid-session.
'use strict'

require('dotenv').config()

const pending = require('./pending-store')
const { unpin } = require('./pinata')

// Default: anything pending for over 24h is treated as an orphan.
const PENDING_TTL_MS = Number(process.env.PENDING_TTL_MS || 24 * 60 * 60 * 1000)
const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run')

async function main() {
  const orphans = pending.listOrphans(PENDING_TTL_MS)
  console.log(`Found ${orphans.length} orphan candidate(s) older than ${PENDING_TTL_MS}ms.`)

  for (const record of orphans) {
    if (DRY_RUN) {
      console.log(`[dry-run] would unpin ${record.cid} (${record.kind}, age ${Date.now() - record.createdAt}ms)`)
      continue
    }
    try {
      const ok = await unpin(record.cid)
      pending.remove(record.cid)
      console.log(`${ok ? 'Unpinned' : 'Already gone'}: ${record.cid}`)
    } catch (e) {
      console.error(`Failed to unpin ${record.cid}:`, e.message)
    }
  }

  console.log('Cleanup complete. Store stats:', pending.stats())
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
