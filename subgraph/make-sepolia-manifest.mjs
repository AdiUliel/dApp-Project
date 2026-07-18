// Generates subgraph.sepolia.yaml from subgraph.yaml (single source of truth):
// swaps network/address/startBlock to the live Sepolia deployment. The
// addresses + startBlocks come from the canonical deployments/sepolia.json
// (single source of truth, shared with the frontend - see
// blockchain/scripts/sync-artifacts.cjs), so they are never hand-edited here.
// Run by redeploy-sepolia.bat / redeploy-sepolia.sh; the generated file is
// gitignored.
//
// Each contract (DecentralizedForum/UsernameRegistry/ForumModeration) gets its
// own address/startBlock since they're three separate deployments (the
// three-contract split), unlike the pre-split single-contract manifest this
// replaced.
import fs from 'fs'

const deployment = JSON.parse(
  fs.readFileSync(new URL('../deployments/sepolia.json', import.meta.url), 'utf8'),
)
const SEPOLIA_DEPLOYMENTS = deployment.contracts

const manifest = fs.readFileSync(new URL('./subgraph.yaml', import.meta.url), 'utf8')

// Split into per-dataSource chunks so each one's address/startBlock is only
// swapped for its own deployment, not blanket-replaced with a single value.
const chunks = manifest.split(/(?=  - kind: ethereum)/)
const sepolia = chunks
  .map((chunk) => {
    const nameMatch = chunk.match(/^ {4}name: (\w+)/m)
    const contractDeployment = nameMatch && SEPOLIA_DEPLOYMENTS[nameMatch[1]]
    if (!contractDeployment) return chunk.replace(/network: localhost/g, 'network: sepolia')

    return chunk
      .replace(/network: localhost/g, 'network: sepolia')
      .replace(/address: '0x[0-9a-fA-F]{40}'/, `address: '${contractDeployment.address}'`)
      .replace(/startBlock: \d+/, `startBlock: ${contractDeployment.startBlock}`)
  })
  .join('')

fs.writeFileSync(new URL('./subgraph.sepolia.yaml', import.meta.url), sepolia)
for (const [name, { address, startBlock }] of Object.entries(SEPOLIA_DEPLOYMENTS)) {
  console.log(`${name}: address ${address}, startBlock ${startBlock}`)
}
console.log('subgraph.sepolia.yaml written')
