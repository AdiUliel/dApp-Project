// Generates subgraph.sepolia.yaml from subgraph.yaml: swaps network/address/
// startBlock to the live Sepolia deployment. The address + startBlock come from
// the canonical deployments/sepolia.json (single source of truth, shared with
// the frontend), so they are never hand-edited here. Run by redeploy-sepolia.bat;
// the generated file is gitignored.
import fs from 'fs'

const deployment = JSON.parse(
  fs.readFileSync(new URL('../deployments/sepolia.json', import.meta.url), 'utf8'),
)
const SEPOLIA_ADDRESS = deployment.address
const SEPOLIA_START_BLOCK = deployment.startBlock

const manifest = fs.readFileSync(new URL('./subgraph.yaml', import.meta.url), 'utf8')
const sepolia = manifest
  .replace(/network: localhost/g, 'network: sepolia')
  .replace(/address: '0x[0-9a-fA-F]{40}'/g, `address: '${SEPOLIA_ADDRESS}'`)
  .replace(/startBlock: \d+/g, `startBlock: ${SEPOLIA_START_BLOCK}`)

fs.writeFileSync(new URL('./subgraph.sepolia.yaml', import.meta.url), sepolia)
console.log(`subgraph.sepolia.yaml written (address ${SEPOLIA_ADDRESS}, startBlock ${SEPOLIA_START_BLOCK})`)
