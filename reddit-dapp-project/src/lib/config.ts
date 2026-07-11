// Network-aware configuration. The same build runs against the local Hardhat
// chain (31337) or public Sepolia (11155111); the active chain is chosen by the
// network MetaMask is connected to.

export const LOCAL_CHAIN_ID = 31337
export const SEPOLIA_CHAIN_ID = 11155111

// Deterministic first-deploy addresses on a fresh Hardhat node (Ignition
// deploy order: DecentralizedForum, UsernameRegistry, ForumModeration).
const DEFAULT_LOCAL_FORUM_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const DEFAULT_LOCAL_USERNAME_REGISTRY_ADDRESS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'
const DEFAULT_LOCAL_MODERATION_ADDRESS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0'

// Live shared deployment on Sepolia (v3, deployed 2026-07-10: three-contract
// split - DecentralizedForum/UsernameRegistry/ForumModeration). Public info,
// safe to commit - this is what lets every teammate hit the same forum by
// default. See subgraph/make-sepolia-manifest.mjs for the matching subgraph
// dataSource addresses/startBlocks.
const DEFAULT_SEPOLIA_ADDRESS = '0x021cc657D6B63c6B23bED4cf9A7d9a2457f0f29E'
const DEFAULT_SEPOLIA_USERNAME_REGISTRY_ADDRESS = '0x63d5b97665F27eaf7Ffa4B97ef851c4daA41d92A'
const DEFAULT_SEPOLIA_MODERATION_ADDRESS = '0xb3C16C2196f466D86e4D9400538dB6A3f4950eCF'

const env = import.meta.env

export const CONTRACT_ADDRESSES: Record<number, string> = {
  [LOCAL_CHAIN_ID]: env.VITE_LOCAL_CONTRACT_ADDRESS || DEFAULT_LOCAL_FORUM_ADDRESS,
  [SEPOLIA_CHAIN_ID]: env.VITE_SEPOLIA_CONTRACT_ADDRESS || DEFAULT_SEPOLIA_ADDRESS,
}

export const USERNAME_REGISTRY_ADDRESSES: Record<number, string> = {
  [LOCAL_CHAIN_ID]: env.VITE_LOCAL_USERNAME_REGISTRY_ADDRESS || DEFAULT_LOCAL_USERNAME_REGISTRY_ADDRESS,
  [SEPOLIA_CHAIN_ID]: env.VITE_SEPOLIA_USERNAME_REGISTRY_ADDRESS || DEFAULT_SEPOLIA_USERNAME_REGISTRY_ADDRESS,
}

export const MODERATION_ADDRESSES: Record<number, string> = {
  [LOCAL_CHAIN_ID]: env.VITE_LOCAL_MODERATION_ADDRESS || DEFAULT_LOCAL_MODERATION_ADDRESS,
  [SEPOLIA_CHAIN_ID]: env.VITE_SEPOLIA_MODERATION_ADDRESS || DEFAULT_SEPOLIA_MODERATION_ADDRESS,
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

export function usernameRegistryAddressForChain(chainId: number): string {
  return USERNAME_REGISTRY_ADDRESSES[chainId] || ''
}

export function moderationAddressForChain(chainId: number): string {
  return MODERATION_ADDRESSES[chainId] || ''
}

export function isSupportedChain(chainId: number): boolean {
  return Boolean(CONTRACT_ADDRESSES[chainId])
}
