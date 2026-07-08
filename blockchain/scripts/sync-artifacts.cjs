#!/usr/bin/env node
// Single source of truth propagation. Runs automatically after `npm run compile`
// (see the "postcompile" script). Copies the freshly compiled ABI from Hardhat's
// artifacts into the two consumers - the frontend and the subgraph - and mirrors
// the canonical deployment records (deployments/*.json) into the frontend, so
// addresses/ABI never drift between packages.
const fs = require('fs')
const path = require('path')

const repoRoot = path.join(__dirname, '..', '..')
const artifactPath = path.join(
  __dirname,
  '..',
  'artifacts',
  'contracts',
  'mainContract.sol',
  'DecentralizedForum.json',
)

if (!fs.existsSync(artifactPath)) {
  console.error('Artifact not found - run `npm run compile` first:', artifactPath)
  process.exit(1)
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))

const frontendDir = path.join(repoRoot, 'reddit-dapp-project', 'src')
const subgraphAbiPath = path.join(repoRoot, 'subgraph', 'abis', 'DecentralizedForum.json')

// Frontend consumes the whole artifact (imported as `contractArtifact`).
fs.writeFileSync(path.join(frontendDir, 'DecentralizedForum.json'), JSON.stringify(artifact, null, 2) + '\n')
// The subgraph only needs the ABI array.
fs.writeFileSync(subgraphAbiPath, JSON.stringify(artifact.abi, null, 2) + '\n')

// Canonical deployments -> a chainId-keyed map the frontend imports (kept inside
// src so Vite/tsc can resolve it without crossing the package boundary).
const deploymentsDir = path.join(repoRoot, 'deployments')
const byChain = {}
for (const file of ['local.json', 'sepolia.json']) {
  const full = path.join(deploymentsDir, file)
  if (!fs.existsSync(full)) continue
  const d = JSON.parse(fs.readFileSync(full, 'utf8'))
  byChain[d.chainId] = { address: d.address, startBlock: d.startBlock, network: d.network }
}
fs.writeFileSync(path.join(frontendDir, 'deployments.json'), JSON.stringify(byChain, null, 2) + '\n')

console.log('Synced ABI -> frontend + subgraph; deployments -> frontend (chains: ' + Object.keys(byChain).join(', ') + ').')
