// Network-aware configuration. The same build runs against the local Hardhat
// chain (31337) or public Sepolia (11155111); the active chain is chosen by the
// network MetaMask is connected to.

// Canonical addresses + deploy blocks live in /deployments/*.json and are mirrored
// here (as src/deployments.json) by the blockchain build step - the single source
// of truth, so nothing is hand-copied. See blockchain/scripts/sync-artifacts.cjs.
import deployments from './deployments.json'

export const LOCAL_CHAIN_ID = 31337
export const SEPOLIA_CHAIN_ID = 11155111

// Deterministic first-deploy address on a fresh Hardhat node.
const DEFAULT_LOCAL_ADDRESS = deployments[LOCAL_CHAIN_ID].address

// Live shared deployment on Sepolia - what lets every teammate hit the same
// forum by default. Public info, safe to commit.
const DEFAULT_SEPOLIA_ADDRESS = deployments[SEPOLIA_CHAIN_ID].address

// IMPORTANT: read each var by its specific name. Never alias the whole object
// (`const env = import.meta.env`) - that makes Vite inline EVERY VITE_-prefixed
// var into the bundle, which would re-leak secrets like a stray VITE_PINATA_JWT.
// Direct property access only emits the specific values referenced here.
export const CONTRACT_ADDRESSES: Record<number, string> = {
  [LOCAL_CHAIN_ID]: import.meta.env.VITE_LOCAL_CONTRACT_ADDRESS || DEFAULT_LOCAL_ADDRESS,
  [SEPOLIA_CHAIN_ID]: import.meta.env.VITE_SEPOLIA_CONTRACT_ADDRESS || DEFAULT_SEPOLIA_ADDRESS,
}

export const GRAPH_ENDPOINTS: Record<number, string> = {
  [LOCAL_CHAIN_ID]: import.meta.env.VITE_LOCAL_GRAPH_URL || 'http://localhost:8000/subgraphs/name/reppit',
  // Served by the dedicated Sepolia graph stack (subgraph/redeploy-sepolia.bat,
  // port 8100 - independent of the local stack on 8000 so they can run together).
  // If the stack isn't running, graphQuery() detects it and the app falls back to chain reads.
  [SEPOLIA_CHAIN_ID]: import.meta.env.VITE_SEPOLIA_GRAPH_URL || 'http://localhost:8100/subgraphs/name/reppit-sepolia',
}

export const NETWORK_NAMES: Record<number, string> = {
  [LOCAL_CHAIN_ID]: 'Localhost 8545',
  [SEPOLIA_CHAIN_ID]: 'Sepolia',
}

export function contractAddressForChain(chainId: number): string {
  return CONTRACT_ADDRESSES[chainId] || ''
}

export function isSupportedChain(chainId: number): boolean {
  return Boolean(CONTRACT_ADDRESSES[chainId])
}
