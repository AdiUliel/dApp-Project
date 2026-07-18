#!/usr/bin/env node
// Single source of truth propagation. Runs automatically after `npm run compile`
// (see the "postcompile" script). Copies the freshly compiled ABI for each of
// the three split contracts (DecentralizedForum/UsernameRegistry/
// ForumModeration) into the two consumers - the frontend and the subgraph -
// and mirrors the canonical deployment records (deployments/*.json) into the
// frontend, so addresses/ABI never drift between packages.
const fs = require('fs')
const path = require('path')

const repoRoot = path.join(__dirname, '..', '..')
const artifactsDir = path.join(__dirname, '..', 'artifacts', 'contracts')

// sourceFile is relative to artifactsDir; each contract's artifact JSON is
// named after the contract, not the .sol file it lives in.
const CONTRACTS = [
  { name: 'DecentralizedForum', sourceFile: 'mainContract.sol/DecentralizedForum.json' },
  { name: 'UsernameRegistry', sourceFile: 'UsernameRegistry.sol/UsernameRegistry.json' },
  { name: 'ForumModeration', sourceFile: 'ForumModeration.sol/ForumModeration.json' },
]

const frontendDir = path.join(repoRoot, 'reddit-dapp-project', 'src')
const subgraphAbiDir = path.join(repoRoot, 'subgraph', 'abis')

for (const { name, sourceFile } of CONTRACTS) {
  const artifactPath = path.join(artifactsDir, sourceFile)
  if (!fs.existsSync(artifactPath)) {
    console.error('Artifact not found - run `npm run compile` first:', artifactPath)
    process.exit(1)
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))

  // Frontend consumes the whole artifact (imported as e.g. `contractArtifact`).
  fs.writeFileSync(path.join(frontendDir, `${name}.json`), JSON.stringify(artifact, null, 2) + '\n')
  // The subgraph only needs the ABI array.
  fs.writeFileSync(path.join(subgraphAbiDir, `${name}.json`), JSON.stringify(artifact.abi, null, 2) + '\n')
}

// Canonical deployments -> a chainId-keyed, per-contract map the frontend
// imports (kept inside src so Vite/tsc can resolve it without crossing the
// package boundary).
const deploymentsDir = path.join(repoRoot, 'deployments')
const byChain = {}
for (const file of ['local.json', 'sepolia.json']) {
  const full = path.join(deploymentsDir, file)
  if (!fs.existsSync(full)) continue
  const d = JSON.parse(fs.readFileSync(full, 'utf8'))
  byChain[d.chainId] = { network: d.network, contracts: d.contracts }
}
fs.writeFileSync(path.join(frontendDir, 'deployments.json'), JSON.stringify(byChain, null, 2) + '\n')

console.log(
  'Synced ABI (' + CONTRACTS.map((c) => c.name).join(', ') + ') -> frontend + subgraph; ' +
  'deployments -> frontend (chains: ' + Object.keys(byChain).join(', ') + ').',
)
