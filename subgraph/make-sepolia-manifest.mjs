// Generates subgraph.sepolia.yaml from subgraph.yaml (single source of truth):
// swaps network/address/startBlock to the live Sepolia deployment. Run by
// redeploy-sepolia.bat; the generated file is gitignored.
import fs from 'fs'

const SEPOLIA_ADDRESS = '0x49eEDCBdd425Df634A3c11405eE139f446d6141a'
const SEPOLIA_START_BLOCK = 11216989 // block the contract was deployed in

const manifest = fs.readFileSync(new URL('./subgraph.yaml', import.meta.url), 'utf8')
const sepolia = manifest
  .replace(/network: localhost/g, 'network: sepolia')
  .replace(/address: '0x[0-9a-fA-F]{40}'/g, `address: '${SEPOLIA_ADDRESS}'`)
  .replace(/startBlock: \d+/g, `startBlock: ${SEPOLIA_START_BLOCK}`)

fs.writeFileSync(new URL('./subgraph.sepolia.yaml', import.meta.url), sepolia)
console.log(`subgraph.sepolia.yaml written (address ${SEPOLIA_ADDRESS}, startBlock ${SEPOLIA_START_BLOCK})`)
