// Records a fresh Ignition deployment into the canonical deployments/*.json
// (single source of truth - the frontend mirror and the subgraph manifests are
// derived from it via `npm run sync` / make-sepolia-manifest.mjs).
//
// Three-contract split: one Ignition module (ForumModule) deploys
// DecentralizedForum, UsernameRegistry and ForumModeration; each gets its own
// address + startBlock record.
//
// Usage: node scripts/update-deployment.mjs <local|sepolia>
// Reads addresses from ignition/deployments/chain-<id>/deployed_addresses.json
// and per-contract deploy blocks from the journal. Never touches key files.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..')

const CONTRACTS = ['DecentralizedForum', 'UsernameRegistry', 'ForumModeration']

const network = process.argv[2]
if (network !== 'local' && network !== 'sepolia') {
  console.error('Usage: node scripts/update-deployment.mjs <local|sepolia>')
  process.exit(1)
}

const chainId = network === 'local' ? 31337 : 11155111
const deployDir = path.join(here, '..', 'ignition', 'deployments', `chain-${chainId}`)

const addresses = JSON.parse(fs.readFileSync(path.join(deployDir, 'deployed_addresses.json'), 'utf8'))

// Per-contract deploy block from the journal (--reset starts a fresh journal, so
// it only contains this deployment). Small back-margin so the subgraph can never
// start past the deploy tx; local always indexes from 0.
function deployBlocks() {
  const blocks = {}
  if (network === 'local') {
    for (const name of CONTRACTS) blocks[name] = 0
    return blocks
  }

  const journal = fs.readFileSync(path.join(deployDir, 'journal.jsonl'), 'utf8')
  for (const line of journal.split('\n')) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const blockNumber = entry.receipt && entry.receipt.blockNumber
    if (!entry.futureId || !blockNumber) continue
    for (const name of CONTRACTS) {
      if (entry.futureId === `ForumModule#${name}`) {
        blocks[name] = Math.max(blocks[name] || 0, blockNumber)
      }
    }
  }

  for (const name of CONTRACTS) {
    if (!blocks[name]) {
      console.error(`No deploy block found in the journal for ${name} - did the deploy succeed?`)
      process.exit(1)
    }
    blocks[name] = Math.max(0, blocks[name] - 5)
  }
  return blocks
}

const blocks = deployBlocks()
const contracts = {}
for (const name of CONTRACTS) {
  const address = addresses[`ForumModule#${name}`]
  if (!address) {
    console.error(`ForumModule#${name} not found in deployed_addresses.json - did the deploy succeed?`)
    process.exit(1)
  }
  contracts[name] = { address, startBlock: blocks[name] }
}

const deploymentFile = path.join(repoRoot, 'deployments', `${network}.json`)
const record = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'))
const previous = record.contracts || {}
record.contracts = contracts
fs.writeFileSync(deploymentFile, JSON.stringify(record, null, 2) + '\n')

// The local subgraph manifest carries the addresses directly (the Sepolia one is
// generated from deployments/sepolia.json), so keep each dataSource in step.
// Same chunk-per-dataSource technique as make-sepolia-manifest.mjs.
if (network === 'local') {
  const manifestPath = path.join(repoRoot, 'subgraph', 'subgraph.yaml')
  const manifest = fs.readFileSync(manifestPath, 'utf8')
  const chunks = manifest.split(/(?=  - kind: ethereum)/)
  const updated = chunks
    .map((chunk) => {
      const nameMatch = chunk.match(/^ {4}name: (\w+)/m)
      const contract = nameMatch && contracts[nameMatch[1]]
      if (!contract) return chunk
      return chunk.replace(/address: '0x[0-9a-fA-F]{40}'/, `address: '${contract.address}'`)
    })
    .join('')
  fs.writeFileSync(manifestPath, updated)
}

console.log(`deployments/${network}.json updated:`)
for (const name of CONTRACTS) {
  const before = previous[name] ? previous[name].address : '(none)'
  console.log(`  ${name}: ${before} -> ${contracts[name].address} (startBlock ${contracts[name].startBlock})`)
}
