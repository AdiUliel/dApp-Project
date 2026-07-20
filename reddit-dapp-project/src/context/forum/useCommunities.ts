import { useMemo, useRef, useState } from 'react'
import { ethers } from 'ethers'
import { waitForGraphBlock } from '@/services/graph'
import { isValidCommunityName } from '@/lib/usernamePolicy'
import type { ForumCore } from './core'
import type { Community, ModeratorRole, RemovalVote } from '@/types/forum'

type Options = {
  publishToIpfs: (metadata: { description: string; rules?: string[] }) => Promise<string>
  loadModeratorInfo: (communityId: string) => Promise<void>
}

/**
 * The community list, the viewer's membership/moderator standing in each, open
 * moderator-removal votes, and the create/join/leave writes.
 */
export function useCommunities(core: ForumCore, { publishToIpfs, loadModeratorInfo }: Options) {
  const { t, walletAddress, getCurrentWalletAddress, getContract, setTemporaryStatus, failWith } = core

  const [communities, setCommunities] = useState<Community[]>([])
  const [removalVotes, setRemovalVotes] = useState<RemovalVote[]>([])
  const [newCommunityName, setNewCommunityName] = useState('')
  const [newCommunityDesc, setNewCommunityDesc] = useState('')
  const [showCreateCommunityModal, setShowCreateCommunityModal] = useState(false)
  const [newSubCommunityName, setNewSubCommunityName] = useState('')
  const [newSubCommunityDesc, setNewSubCommunityDesc] = useState('')
  const [showCreateSubCommunityModal, setShowCreateSubCommunityModal] = useState(false)

  // Communities where we already know we hold a moderator role, so the event
  // listener only announces genuine transitions.
  const knownModeratorCommunities = useRef(new Set<string>())

  const communitiesByParent = useMemo(() => {
    const grouped = communities.reduce<Record<string, Community[]>>((acc, community) => {
      const parentId = community.parentCommunityId || '0'
      acc[parentId] = acc[parentId] || []
      acc[parentId].push(community)
      return acc
    }, {})
    // Alphabetical by name so the home community list has a stable, scannable order.
    for (const parentId of Object.keys(grouped)) {
      grouped[parentId].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    }
    return grouped
  }, [communities])

  const rootCommunities = communitiesByParent['0'] || []

  const moderatorOffers = useMemo(
    () => communities.filter((community) => community.hasModeratorOffer),
    [communities],
  )

  const pendingRemovalVotes = useMemo(() => removalVotes.filter((vote) => !vote.approvedByMe), [removalVotes])

  // Open (not yet executed) moderator-removal votes in communities I moderate,
  // shown in the notifications panel so every moderator can weigh in.
  const loadRemovalVotes = async (communityList: Community[], account: string) => {
    if (!account) {
      setRemovalVotes([])
      return
    }

    try {
      const contract = await getContract(false)
      const votes: RemovalVote[] = []

      for (const community of communityList) {
        if (!community.isModerator) continue

        const proposalIds = await contract.getRemovalProposalsByCommunity(community.id)
        if (proposalIds.length === 0) continue

        for (const proposalId of proposalIds) {
          const proposal = await contract.getRemoveModeratorProposal(proposalId)
          if (proposal[5]) continue // already executed

          const deadline = Number(proposal[9])
          // Hide proposals that have expired (still valid on-chain but dead).
          if (deadline * 1000 < Date.now()) continue

          const approvedByMe = await contract.hasApprovedRemoveModeratorProposal(proposalId, account)

          votes.push({
            proposalId: proposal[0].toString(),
            communityId: proposal[1].toString(),
            communityName: community.name,
            target: proposal[2],
            approvals: Number(proposal[4]),
            // Snapshotted threshold from the proposal itself, not recomputed.
            required: Number(proposal[8]),
            approvedByMe,
            reason: proposal[7],
            deadline,
          })
        }
      }

      setRemovalVotes(votes)
    } catch (error) {
      console.error('Failed to load removal votes:', error)
      setRemovalVotes([])
    }
  }

  const loadCommunities = async (account = walletAddress, seedKnownModerators = false) => {
    try {
      const contract = await getContract(false)
      const ids = await contract.getAllCommunityIds()
      // Load every community in parallel, and within each fire the per-account
      // reads together, so a forum with many communities isn't gated on a long
      // chain of sequential round-trips (the dominant read latency on Sepolia).
      const loadedCommunities: Community[] = await Promise.all(
        ids.map(async (id: bigint): Promise<Community> => {
          let community
          let parentCommunityId = '0'

          try {
            community = await contract.getCommunityV2(id)
            parentCommunityId = community[7].toString()
          } catch {
            community = await contract.getCommunity(id)
          }

          const communityId = community[0].toString()

          let isMember = false
          let isModerator = false
          let isBanned = false
          let hasModeratorOffer = false
          let moderatorRole: ModeratorRole | undefined

          if (account) {
            const [memberRes, modRes, banRes, offerRes, roleRes] = await Promise.all([
              contract.isUserMemberOfCommunity(communityId, account),
              contract.isUserModeratorOfCommunity(communityId, account),
              contract.isUserBannedFromCommunity(communityId, account),
              contract.hasPendingModeratorOffer(communityId, account).catch(() => false),
              contract.getModeratorRole(communityId, account).catch(() => null),
            ])
            isMember = memberRes
            isModerator = modRes
            isBanned = banRes
            hasModeratorOffer = offerRes
            moderatorRole = roleRes
              ? {
                  isModerator: roleRes[0],
                  isCreatorModerator: roleRes[1],
                  isActiveBasedModerator: roleRes[2],
                  isAppointedModerator: roleRes[3],
                }
              : { isModerator, isCreatorModerator: false, isActiveBasedModerator: false, isAppointedModerator: false }
          }

          return {
            id: communityId,
            name: community[1],
            creator: community[2],
            metadataCID: community[3],
            membersCount: community[5].toString(),
            isMember,
            isModerator,
            isBanned,
            parentCommunityId,
            moderatorRole,
            hasModeratorOffer,
          }
        }),
      )

      setCommunities(loadedCommunities)

      if (account && seedKnownModerators) {
        loadedCommunities.forEach((community) => {
          if (community.isModerator) {
            knownModeratorCommunities.current.add(community.id)
          }
        })
      }

      loadRemovalVotes(loadedCommunities, account)
    } catch (error) {
      console.error('Failed to load communities:', error)
      setTemporaryStatus(t('loadCommunitiesFailed'))
    }
  }

  const getCommunityName = async (communityId: string) => {
    const cached = communities.find((community) => community.id === communityId)
    if (cached) return cached.name

    const contract = await getContract(false)

    try {
      const community = await contract.getCommunityV2(communityId)
      return community[1] as string
    } catch {
      const community = await contract.getCommunity(communityId)
      return community[1] as string
    }
  }

  // Inserts a temporary community into the list so it shows the instant the tx
  // is submitted; its description is already in ipfsCache from publishToIpfs.
  const addOptimisticCommunity = (name: string, metadataCID: string, parentCommunityId: string, account: string) => {
    setCommunities((prev) => [
      ...prev,
      {
        id: `pending-${Date.now()}`,
        name,
        creator: account,
        metadataCID,
        membersCount: '1',
        isMember: true,
        isModerator: true,
        isBanned: false,
        parentCommunityId,
        moderatorRole: { isModerator: true, isCreatorModerator: true, isActiveBasedModerator: false, isAppointedModerator: false },
        hasModeratorOffer: false,
        confirming: true,
      },
    ])
  }

  const reconcileCommunityCreate = async (
    tx: ethers.ContractTransactionResponse,
    account: string,
    successMessage: string,
  ) => {
    try {
      const receipt = await tx.wait()
      if (receipt) await waitForGraphBlock(receipt.blockNumber)
      await loadCommunities(account)
      setTemporaryStatus(successMessage)
    } catch (error) {
      console.error('Community creation reconciliation failed:', error)
      await loadCommunities(account).catch(() => {})
      failWith('createCommunityFailed', error)
    }
  }

  const createCommunity = async () => {
    if (!newCommunityName.trim() || !newCommunityDesc.trim()) {
      alert(t('fillNameDesc'))
      return
    }

    if (!isValidCommunityName(newCommunityName.trim())) {
      alert(t('communityNameInvalid'))
      return
    }

    try {
      const description = newCommunityDesc.trim()
      const metadataCID = await publishToIpfs({
        description,
        rules: ['Be respectful', 'Keep posts relevant', 'No spam'],
      })

      const contract = await getContract(true)
      const communityName = newCommunityName.trim()
      const tx = await contract.createCommunity(communityName, metadataCID, description)

      const account = walletAddress
      addOptimisticCommunity(communityName, metadataCID, '0', account)
      setNewCommunityName('')
      setNewCommunityDesc('')
      setShowCreateCommunityModal(false)
      setTemporaryStatus(t('communityConfirming'))

      void reconcileCommunityCreate(tx, account, t('communityCreated', { name: communityName }))
    } catch (error) {
      console.error('Community creation failed:', error)
      failWith('createCommunityFailed', error)
    }
  }

  const createSubCommunity = async (parentCommunityId: string) => {
    if (!parentCommunityId || !newSubCommunityName.trim() || !newSubCommunityDesc.trim()) {
      alert(t('fillSubFields'))
      return
    }

    if (!isValidCommunityName(newSubCommunityName.trim())) {
      alert(t('communityNameInvalid'))
      return
    }

    try {
      const description = newSubCommunityDesc.trim()
      const metadataCID = await publishToIpfs({
        description,
        rules: ['Follow parent community rules', 'Keep discussions focused'],
      })

      const contract = await getContract(true)
      const subName = newSubCommunityName.trim()
      const tx = await contract.createSubCommunity(parentCommunityId, subName, metadataCID, description)

      const account = walletAddress
      addOptimisticCommunity(subName, metadataCID, parentCommunityId, account)
      setNewSubCommunityName('')
      setNewSubCommunityDesc('')
      setShowCreateSubCommunityModal(false)
      setTemporaryStatus(t('communityConfirming'))

      void reconcileCommunityCreate(tx, account, t('subCreated', { name: subName }))
    } catch (error) {
      console.error('Sub-community creation failed:', error)
      failWith('subFailed', error)
    }
  }

  const joinCommunity = async (communityId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.joinCommunity(communityId)

      setTemporaryStatus(t('joinSent'))
      await tx.wait()

      const account = await getCurrentWalletAddress()
      await loadCommunities(account)
      await loadModeratorInfo(communityId)
      setTemporaryStatus(t('joined'))
    } catch (error) {
      console.error('Failed to join community:', error)
      failWith('joinFailed', error)
    }
  }

  // Members can leave for free, but it forfeits their activity points here.
  const leaveCommunity = async (communityId: string) => {
    if (!window.confirm(t('leaveConfirm'))) return
    try {
      const contract = await getContract(true)
      const tx = await contract.leaveCommunity(communityId)
      setTemporaryStatus(t('txSent'))
      await tx.wait()
      const account = await getCurrentWalletAddress()
      await loadCommunities(account)
      await loadModeratorInfo(communityId)
      setTemporaryStatus(t('leftCommunityToast'))
    } catch (error) {
      console.error('Leave community failed:', error)
      failWith('leaveFailed', error)
    }
  }

  return {
    communities,
    communitiesByParent,
    rootCommunities,
    moderatorOffers,
    removalVotes,
    pendingRemovalVotes,
    knownModeratorCommunities,
    loadCommunities,
    getCommunityName,
    joinCommunity,
    leaveCommunity,
    newCommunityName,
    setNewCommunityName,
    newCommunityDesc,
    setNewCommunityDesc,
    showCreateCommunityModal,
    setShowCreateCommunityModal,
    createCommunity,
    newSubCommunityName,
    setNewSubCommunityName,
    newSubCommunityDesc,
    setNewSubCommunityDesc,
    showCreateSubCommunityModal,
    setShowCreateSubCommunityModal,
    createSubCommunity,
  }
}
