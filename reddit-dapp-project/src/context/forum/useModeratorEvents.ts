import { useEffect, type RefObject } from 'react'
import { ethers } from 'ethers'
import { contractArtifact } from '@/lib/contracts'
import type { Translator } from '@/lib/i18n'

type Options = {
  t: Translator
  walletAddress: string
  contractAddress: string
  lang: string
  knownModeratorCommunities: RefObject<Set<string>>
  getCommunityName: (communityId: string) => Promise<string>
  flashModNotification: (message: string) => void
  refreshAfterRoleChange: (account: string) => void
}

/**
 * Live moderator-role notifications straight from contract events, so a user
 * promoted, removed or nominated while the tab is open finds out immediately
 * rather than on next reload.
 */
export function useModeratorEvents({
  t,
  walletAddress,
  contractAddress,
  lang,
  knownModeratorCommunities,
  getCommunityName,
  flashModNotification,
  refreshAfterRoleChange,
}: Options) {
  useEffect(() => {
    if (!walletAddress || !contractAddress || !window.ethereum) return

    let cancelled = false
    const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider)
    const contract = new ethers.Contract(contractAddress, contractArtifact.abi, provider)

    const announceNewModerator = async (communityId: string) => {
      if (knownModeratorCommunities.current.has(communityId)) return
      knownModeratorCommunities.current.add(communityId)

      const name = await getCommunityName(communityId)
      if (cancelled) return

      flashModNotification(t('becameModerator', { name }))
      refreshAfterRoleChange(walletAddress)
    }

    const announceModeratorRemoved = async (communityId: string) => {
      if (!knownModeratorCommunities.current.has(communityId)) return
      knownModeratorCommunities.current.delete(communityId)

      const name = await getCommunityName(communityId)
      if (cancelled) return

      flashModNotification(t('noLongerModerator', { name }))
      refreshAfterRoleChange(walletAddress)
    }

    const onModeratorAdded = (communityId: bigint, moderator: string) => {
      if (moderator.toLowerCase() === walletAddress.toLowerCase()) {
        announceNewModerator(communityId.toString())
      }
    }

    const onModeratorRemoved = (communityId: bigint, moderator: string) => {
      if (moderator.toLowerCase() === walletAddress.toLowerCase()) {
        announceModeratorRemoved(communityId.toString())
      }
    }

    const onActiveModeratorsUpdated = async (communityId: bigint, first: string, second: string) => {
      const address = walletAddress.toLowerCase()

      if (first.toLowerCase() === address || second.toLowerCase() === address) {
        announceNewModerator(communityId.toString())
        return
      }

      // I may have just been displaced from the automatic active pair; only
      // announce if I hold no other moderator role in that community.
      if (knownModeratorCommunities.current.has(communityId.toString())) {
        try {
          const stillModerator = await contract.isUserModeratorOfCommunity(communityId, walletAddress)
          if (!stillModerator) announceModeratorRemoved(communityId.toString())
        } catch (error) {
          console.error('Failed to re-check moderator status:', error)
        }
      }
    }

    const onModeratorOfferCreated = async (communityId: bigint, candidate: string) => {
      if (candidate.toLowerCase() !== walletAddress.toLowerCase()) return

      const name = await getCommunityName(communityId.toString())
      if (cancelled) return

      flashModNotification(t('moderatorOfferToast', { name }))
      refreshAfterRoleChange(walletAddress)
    }

    const onRemovalProposalCreated = async (
      _proposalId: bigint,
      communityId: bigint,
      _target: string,
      proposer: string
    ) => {
      if (proposer.toLowerCase() === walletAddress.toLowerCase()) return
      if (!knownModeratorCommunities.current.has(communityId.toString())) return

      const name = await getCommunityName(communityId.toString())
      if (cancelled) return

      flashModNotification(t('removalVoteToast', { name }))
      refreshAfterRoleChange(walletAddress)
    }

    contract.on('ModeratorAdded', onModeratorAdded)
    contract.on('ModeratorRemoved', onModeratorRemoved)
    contract.on('ActiveModeratorsUpdated', onActiveModeratorsUpdated)
    contract.on('ModeratorOfferCreated', onModeratorOfferCreated)
    contract.on('RemoveModeratorProposalCreated', onRemovalProposalCreated)

    return () => {
      cancelled = true
      contract.off('ModeratorAdded', onModeratorAdded)
      contract.off('ModeratorRemoved', onModeratorRemoved)
      contract.off('ActiveModeratorsUpdated', onActiveModeratorsUpdated)
      contract.off('ModeratorOfferCreated', onModeratorOfferCreated)
      contract.off('RemoveModeratorProposalCreated', onRemovalProposalCreated)
    }
  }, [walletAddress, contractAddress, lang])
}
