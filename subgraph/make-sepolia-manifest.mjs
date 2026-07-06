// Generates subgraph.sepolia.yaml from subgraph.yaml (single source of truth):
// swaps network/address/startBlock to the live Sepolia deployment. Run by
// redeploy-sepolia.bat; the generated file is gitignored.
import fs from 'fs'

const SEPOLIA_ADDRESS = '0xddCC23D3051de84c546f9d8DaA3f25795fb9502B'
const SEPOLIA_START_BLOCK = 11213451 // block the contract was deployed in

const manifest = fs.readFileSync(new URL('./subgraph.yaml', import.meta.url), 'utf8')
const sepolia = manifest
  .replace(/network: localhost/g, 'network: sepolia')
  .replace(/address: '0x[0-9a-fA-F]{40}'/g, `address: '${SEPOLIA_ADDRESS}'`)
  .replace(/startBlock: \d+/g, `startBlock: ${SEPOLIA_START_BLOCK}`)

fs.writeFileSync(new URL('./subgraph.sepolia.yaml', import.meta.url), sepolia)
console.log(`subgraph.sepolia.yaml written (address ${SEPOLIA_ADDRESS}, startBlock ${SEPOLIA_START_BLOCK})`)
