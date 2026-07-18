// Records a fresh Ignition deployment into the canonical deployments/*.json
// (single source of truth - the frontend and the subgraph manifests are derived
// from it via `npm run sync` / make-sepolia-manifest.mjs).
//
// Usage: node scripts/update-deployment.mjs <local|sepolia>
// Reads the address from ignition/deployments/chain-<id>/deployed_addresses.json
// and the deployment block from the journal. Never touches key files.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..')

const network = process.argv[2]
if (network !== 'local' && network !== 'sepolia') {
  console.error('Usage: node scripts/update-deployment.mjs <local|sepolia>')
  process.exit(1)
}

const chainId = network === 'local' ? 31337 : 11155111
const deployDir = path.join(here, '..', 'ignition', 'deployments', `chain-${chainId}`)

const addresses = JSON.parse(fs.readFileSync(path.join(deployDir, 'deployed_addresses.json'), 'utf8'))
const address = addresses['ForumModule#DecentralizedForum']
if (!address) {
  console.error('ForumModule#DecentralizedForum not found in deployed_addresses.json - did the deploy succeed?')
  process.exit(1)
}

// Deploy block = highest receipt block in the journal (--reset starts a fresh
// journal, so it only contains this deployment). Small back-margin so the
// subgraph can never start past the deploy tx; local always indexes from 0.
let startBlock = 0
if (network === 'sepolia') {
  const journal = fs.readFileSync(path.join(deployDir, 'journal.jsonl'), 'utf8')
  let max = 0
  for (const match of journal.matchAll(/"blockNumber":\s*(\d+)/g)) {
    max = Math.max(max, Number(match[1]))
  }
  if (max === 0) {
    console.error('No blockNumber found in the Ignition journal - cannot set startBlock.')
    process.exit(1)
  }
  startBlock = Math.max(0, max - 5)
}

const deploymentFile = path.join(repoRoot, 'deployments', `${network}.json`)
const record = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'))
const previous = record.address
record.address = address
record.startBlock = startBlock
fs.writeFileSync(deploymentFile, JSON.stringify(record, null, 2) + '\n')

// The local subgraph manifest carries the address directly (the Sepolia one is
// generated from deployments/sepolia.json), so keep it in step here.
if (network === 'local') {
  const manifestPath = path.join(repoRoot, 'subgraph', 'subgraph.yaml')
  const manifest = fs.readFileSync(manifestPath, 'utf8')
  fs.writeFileSync(manifestPath, manifest.replace(/address: '0x[0-9a-fA-F]{40}'/, `address: '${address}'`))
}

console.log(`deployments/${network}.json updated:`)
console.log(`  address:    ${previous} -> ${address}`)
console.log(`  startBlock: ${startBlock}`)
