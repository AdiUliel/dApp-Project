#!/usr/bin/env node
// Fails CI when the deployed (runtime) bytecode of any of the three split
// contracts crosses the EIP-170 limit, so an undeployable contract is caught
// before it reaches a public network. Run after `hardhat compile`.
const fs = require('fs')
const path = require('path')

// EIP-170 caps deployed bytecode at 24,576 bytes; above it the contract cannot
// be deployed to mainnet/testnets at all. CI fails here.
const LIMIT = 24576
// Soft budget: print a warning (does not fail CI) once we cross it, so the team
// sees a contract getting tight well before it hits the hard cap.
const WARN_LIMIT = 23000

const artifactsDir = path.join(__dirname, '..', 'artifacts', 'contracts')
const CONTRACTS = [
  { name: 'DecentralizedForum', sourceFile: 'mainContract.sol/DecentralizedForum.json' },
  { name: 'UsernameRegistry', sourceFile: 'UsernameRegistry.sol/UsernameRegistry.json' },
  { name: 'ForumModeration', sourceFile: 'ForumModeration.sol/ForumModeration.json' },
]

let failed = false

for (const { name, sourceFile } of CONTRACTS) {
  const artifactPath = path.join(artifactsDir, sourceFile)

  if (!fs.existsSync(artifactPath)) {
    console.error('Artifact not found - run `npm run compile` first:', artifactPath)
    process.exit(1)
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const hex = (artifact.deployedBytecode || '').replace(/^0x/, '')
  const bytes = hex.length / 2
  const margin = LIMIT - bytes

  console.log(`${name} runtime bytecode: ${bytes} / ${LIMIT} bytes (margin ${margin}).`)

  if (bytes > LIMIT) {
    console.error(`FAIL: ${name} exceeds the EIP-170 limit by ${bytes - LIMIT} bytes.`)
    failed = true
  } else if (bytes > WARN_LIMIT) {
    console.warn(`WARN: ${name} is over the ${WARN_LIMIT}-byte soft budget by ${bytes - WARN_LIMIT} bytes (still deployable).`)
  }
}

if (failed) {
  process.exit(1)
}

console.log('OK: all contracts within the deployable size limit.')
