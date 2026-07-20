// Contract ABI wiring. The artifact JSON files here are generated - they are
// copied in by blockchain/scripts/sync-artifacts.cjs after every `npm run
// compile`, so never hand-edit them.
import { ethers } from 'ethers'
import contractArtifact from '@/DecentralizedForum.json'
import usernameRegistryArtifact from '@/UsernameRegistry.json'
import moderationArtifact from '@/ForumModeration.json'
import type { ContractName } from '@/types/forum'

export { contractArtifact, usernameRegistryArtifact, moderationArtifact }

export const CONTRACT_ABIS: Record<ContractName, ethers.InterfaceAbi> = {
  forum: contractArtifact.abi,
  usernameRegistry: usernameRegistryArtifact.abi,
  moderation: moderationArtifact.abi,
}

// Every custom-error selector across the three contracts, combined into one
// fragment list - selectors are signature-based (not contract-scoped), so a
// single Interface built from all three ABIs decodes reverts from any of them.
// Constructors are dropped: each contract has its own, and Interface only
// supports one, so keeping them would log a "duplicate definition" warning
// for a fragment type this list is never used to construct anything from.
export const ALL_ABI_FRAGMENTS = [
  ...contractArtifact.abi,
  ...usernameRegistryArtifact.abi,
  ...moderationArtifact.abi,
].filter((fragment: { type?: string }) => fragment.type !== 'constructor')

export const EMPTY_ADDRESS = '0x0000000000000000000000000000000000000000'
