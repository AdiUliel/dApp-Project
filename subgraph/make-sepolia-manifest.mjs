// Generates subgraph.sepolia.yaml from subgraph.yaml (single source of truth):
// swaps network/address/startBlock to the live Sepolia deployment. Run by
// redeploy-sepolia.bat / redeploy-sepolia.sh; the generated file is gitignored.
//
// Deployed via `npx hardhat ignition deploy ignition/modules/Forum.ts --network
// sepolia` (three-contract split, 2026-07-10) - each contract gets its own
// address/startBlock since they're three separate deployments now, unlike the
// pre-split single-contract manifest this replaced.
import fs from 'fs'

const SEPOLIA_DEPLOYMENTS = {
  DecentralizedForum: { address: '0x021cc657D6B63c6B23bED4cf9A7d9a2457f0f29E', startBlock: 11244720 },
  UsernameRegistry: { address: '0x63d5b97665F27eaf7Ffa4B97ef851c4daA41d92A', startBlock: 11244732 },
  ForumModeration: { address: '0xb3C16C2196f466D86e4D9400538dB6A3f4950eCF', startBlock: 11244737 },
}

const manifest = fs.readFileSync(new URL('./subgraph.yaml', import.meta.url), 'utf8')

// Split into per-dataSource chunks so each one's address/startBlock is only
// swapped for its own deployment, not blanket-replaced with a single value.
const chunks = manifest.split(/(?=  - kind: ethereum)/)
const sepolia = chunks
  .map((chunk) => {
    const nameMatch = chunk.match(/^ {4}name: (\w+)/m)
    const deployment = nameMatch && SEPOLIA_DEPLOYMENTS[nameMatch[1]]
    if (!deployment) return chunk.replace(/network: localhost/g, 'network: sepolia')

    return chunk
      .replace(/network: localhost/g, 'network: sepolia')
      .replace(/address: '0x[0-9a-fA-F]{40}'/, `address: '${deployment.address}'`)
      .replace(/startBlock: \d+/, `startBlock: ${deployment.startBlock}`)
  })
  .join('')

fs.writeFileSync(new URL('./subgraph.sepolia.yaml', import.meta.url), sepolia)
for (const [name, { address, startBlock }] of Object.entries(SEPOLIA_DEPLOYMENTS)) {
  console.log(`${name}: address ${address}, startBlock ${startBlock}`)
}
console.log('subgraph.sepolia.yaml written')
