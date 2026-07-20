import { useState } from 'react'
import { waitForGraphBlock } from '@/services/graph'
import type { ForumCore } from './core'

type Options = {
  resolveUserInput: (input: string) => Promise<string | null>
  loadCommunities: (account?: string) => Promise<void>
  loadPosts: (communityId: string) => Promise<void>
  loadModeratorInfo: (communityId: string) => Promise<void>
}

/**
 * Moderator write actions: review-queue decisions, comment hiding, and the
 * governance calls (recommend, propose removal, approve, ban, resign) plus the
 * accept/decline side of a moderator offer.
 *
 * Created after posts/communities so it can take their loaders directly - see
 * useModeratorRoster for why the read side is separate.
 */
export function useModerationActions(
  core: ForumCore,
  { resolveUserInput, loadCommunities, loadPosts, loadModeratorInfo }: Options,
) {
  const { t, getContract, setTemporaryStatus, failWith } = core

  const [recommendInput, setRecommendInput] = useState('')
  const [removeTargetInput, setRemoveTargetInput] = useState('')
  const [removeReasonInput, setRemoveReasonInput] = useState('')
  const [banTargetInput, setBanTargetInput] = useState('')
  const [banReasonInput, setBanReasonInput] = useState('')
  const [showModeratorActionsModal, setShowModeratorActionsModal] = useState(false)

  const decidePendingPost = async (postId: string, communityId: string, approved: boolean) => {
    try {
      const contract = await getContract(true, 'moderation')
      setTemporaryStatus(t('approvingItem'))
      const tx = approved ? await contract.approvePendingPost(postId) : await contract.rejectPendingPost(postId)
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadPosts(communityId)
      setTemporaryStatus(approved ? t('postApprovedToast') : t('postRejectedToast'))
    } catch (error) {
      console.error('Moderation decision failed:', error)
      failWith('decisionFailed', error)
    }
  }

  const decidePendingComment = async (commentId: string, communityId: string, approved: boolean) => {
    try {
      const contract = await getContract(true, 'moderation')
      setTemporaryStatus(t('approvingItem'))
      const tx = approved
        ? await contract.approvePendingComment(commentId)
        : await contract.rejectPendingComment(commentId)
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadPosts(communityId)
      setTemporaryStatus(approved ? t('commentApprovedToast') : t('commentRejectedToast'))
    } catch (error) {
      console.error('Moderation decision failed:', error)
      failWith('decisionFailed', error)
    }
  }

  // Hides an on-chain comment. Ids are global now, so both clean (c-) and
  // approved-formerly-flagged (p-) comments share one hide path.
  const hideChainComment = async (commentId: string, communityId: string) => {
    const numericId = commentId.replace(/^[cp]-/, '')
    try {
      const contract = await getContract(true, 'moderation')
      const tx = await contract.hideComment(numericId)

      setTemporaryStatus(t('txSent'))
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadPosts(communityId)
      setTemporaryStatus(t('commentHiddenToast'))
    } catch (error) {
      console.error('Failed to hide comment:', error)
      failWith('hideFailed', error)
    }
  }

  const recommendModerator = async (communityId: string) => {
    if (!communityId || !recommendInput.trim()) {
      alert(t('enterAddress'))
      return
    }

    const candidate = await resolveUserInput(recommendInput)
    if (!candidate) {
      alert(t('userNotFound'))
      return
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.recommendModerator(communityId, candidate)
      setTemporaryStatus(t('recommendationSending'))
      await tx.wait()
      setRecommendInput('')

      const reader = await getContract(false)
      const status = await reader.getModeratorRecommendationStatus(communityId, candidate)
      setTemporaryStatus(
        t('recommendationSent', { count: status[0].toString(), required: status[1].toString() })
      )

      await loadModeratorInfo(communityId)
    } catch (error) {
      console.error('Moderator recommendation failed:', error)
      failWith('recommendationFailed', error)
    }
  }

  const acceptModeratorOffer = async (communityId: string, selectedCommunityId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.acceptModeratorRole(communityId)
      setTemporaryStatus(t('acceptingRole'))
      await tx.wait()
      await loadCommunities()
      if (communityId === selectedCommunityId) await loadModeratorInfo(communityId)
    } catch (error) {
      console.error('Accepting moderator role failed:', error)
      failWith('offerActionFailed', error)
    }
  }

  const declineModeratorOffer = async (communityId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.declineModeratorRole(communityId)
      setTemporaryStatus(t('decliningRole'))
      await tx.wait()
      setTemporaryStatus(t('roleDeclined'))
      await loadCommunities()
    } catch (error) {
      console.error('Declining moderator role failed:', error)
      failWith('offerActionFailed', error)
    }
  }

  const resignFromModeration = async (communityId: string, communityName: string, selectedCommunityId: string) => {
    if (!window.confirm(t('resignConfirm', { name: communityName }))) return

    try {
      const contract = await getContract(true)
      const tx = await contract.resignModerator(communityId)
      setTemporaryStatus(t('resigning'))
      await tx.wait()
      setShowModeratorActionsModal(false)
      await loadCommunities()
      if (communityId === selectedCommunityId) await loadModeratorInfo(communityId)
    } catch (error) {
      console.error('Resignation failed:', error)
      failWith('resignFailed', error)
    }
  }

  const proposeRemoveModerator = async (communityId: string) => {
    if (!communityId || !removeTargetInput.trim()) {
      alert(t('enterRemovalAddress'))
      return
    }

    const reason = removeReasonInput.trim()
    if (!reason) {
      alert(t('reasonRequired'))
      return
    }

    const target = await resolveUserInput(removeTargetInput)
    if (!target) {
      alert(t('userNotFound'))
      return
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.proposeRemoveModerator(communityId, target, reason)
      setTemporaryStatus(t('removalSent'))
      await tx.wait()
      setRemoveTargetInput('')
      setRemoveReasonInput('')
      await loadCommunities()
      await loadModeratorInfo(communityId)
    } catch (error) {
      console.error('Removal proposal failed:', error)
      failWith('removalFailed', error)
    }
  }

  const approveRemovalVote = async (proposalId: string, selectedCommunityId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.approveRemoveModeratorProposal(proposalId)
      setTemporaryStatus(t('removalApprovalSent'))
      await tx.wait()
      await loadCommunities()
      if (selectedCommunityId) await loadModeratorInfo(selectedCommunityId)
    } catch (error) {
      console.error('Removal approval failed:', error)
      failWith('removalApprovalFailed', error)
    }
  }

  // Moderator bans a member with a required reason. There's no banned-users
  // list UI yet (that needs a subgraph aggregation query - follow-up item),
  // so unban isn't wired up either for now: nothing to click "unban" from.
  const banMember = async (communityId: string) => {
    if (!communityId || !banTargetInput.trim()) {
      alert(t('enterAddress'))
      return
    }
    const reason = banReasonInput.trim()
    if (!reason) {
      alert(t('reasonRequired'))
      return
    }
    const target = await resolveUserInput(banTargetInput)
    if (!target) {
      alert(t('userNotFound'))
      return
    }
    try {
      const contract = await getContract(true)
      const tx = await contract.banUser(communityId, target, reason)
      setTemporaryStatus(t('txSent'))
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      setBanTargetInput('')
      setBanReasonInput('')
      await loadCommunities()
      await loadModeratorInfo(communityId)
      setTemporaryStatus(t('bannedToast'))
    } catch (error) {
      console.error('Ban failed:', error)
      failWith('banFailed', error)
    }
  }

  return {
    decidePendingPost,
    decidePendingComment,
    hideChainComment,
    showModeratorActionsModal,
    setShowModeratorActionsModal,
    recommendInput,
    setRecommendInput,
    recommendModerator,
    removeTargetInput,
    setRemoveTargetInput,
    removeReasonInput,
    setRemoveReasonInput,
    proposeRemoveModerator,
    approveRemovalVote,
    banTargetInput,
    setBanTargetInput,
    banReasonInput,
    setBanReasonInput,
    banMember,
    resignFromModeration,
    acceptModeratorOffer,
    declineModeratorOffer,
  }
}
