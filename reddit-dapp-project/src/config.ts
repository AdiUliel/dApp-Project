// Network-aware configuration. The same build runs against the local Hardhat
// chain (31337) or public Sepolia (11155111); the active chain is chosen by the
// network MetaMask is connected to.

export const LOCAL_CHAIN_ID = 31337
export const SEPOLIA_CHAIN_ID = 11155111

// Deterministic first-deploy address on a fresh Hardhat node.
const DEFAULT_LOCAL_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

// Live shared deployment on Sepolia (v2, deployed 2026-07-06: moderator-only
// recommendations + post locking + comment hiding). Public info, safe to
// commit - this is what lets every teammate hit the same forum by default.
const DEFAULT_SEPOLIA_ADDRESS = '0x49eEDCBdd425Df634A3c11405eE139f446d6141a'

const env = import.meta.env

export const CONTRACT_ADDRESSES: Record<number, string> = {
  [LOCAL_CHAIN_ID]: env.VITE_LOCAL_CONTRACT_ADDRESS || DEFAULT_LOCAL_ADDRESS,
  [SEPOLIA_CHAIN_ID]: env.VITE_SEPOLIA_CONTRACT_ADDRESS || DEFAULT_SEPOLIA_ADDRESS,
}

export const GRAPH_ENDPOINTS: Record<number, string> = {
  [LOCAL_CHAIN_ID]: env.VITE_LOCAL_GRAPH_URL || 'http://localhost:8000/subgraphs/name/reppit',
  // Served by the dedicated Sepolia graph stack (subgraph/redeploy-sepolia.bat,
  // port 8100 - independent of the local stack on 8000 so they can run together).
  // If the stack isn't running, graphQuery() detects it and the app falls back to chain reads.
  [SEPOLIA_CHAIN_ID]: env.VITE_SEPOLIA_GRAPH_URL || 'http://localhost:8100/subgraphs/name/reppit-sepolia',
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
