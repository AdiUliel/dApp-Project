import { useState } from 'react'
import { ethers } from 'ethers'
import { addFile } from '@/services/ipfs'
import { fetchApprovedComments, fetchComments, fetchPendingComments, waitForGraphBlock } from '@/services/graph'
import type { ForumCore } from './core'
import type { OnChainComment, Post } from '@/types/forum'

/**
 * On-chain comments. Clean comments (addComment) and approved
 * formerly-flagged ones render together; still-pending flagged ones feed the
 * moderator queue. Prefers the subgraph and falls back to chain reads/logs.
 */
export function useOnChainComments(core: ForumCore) {
  const { t, getProvider, getContract, setTemporaryStatus, failWith } = core

  const [onChainComments, setOnChainComments] = useState<OnChainComment[]>([])
  const [pendingComments, setPendingComments] = useState<OnChainComment[]>([])
  const [newCommentByPost, setNewCommentByPost] = useState<Record<string, string>>({})
  const [commentImageByPost, setCommentImageByPost] = useState<Record<string, File | undefined>>({})

  // Three community-level queries total - approved comments arrive in ONE query
  // and are grouped by post here, instead of a separate query per post (N+1).
  const loadOnChainComments = async (communityId: string, communityPosts: Post[]) => {
    const [graphClean, graphPending, graphApproved] = await Promise.all([
      fetchComments(communityId),
      fetchPendingComments(communityId),
      fetchApprovedComments(communityId),
    ])

    if (graphClean !== null && graphPending !== null) {
      setPendingComments(
        graphPending.map((comment) => ({
          id: comment.id,
          postId: comment.post.id,
          author: comment.author.id,
          content: comment.content,
          imageCid: comment.imageCid,
          createdAt: Number(comment.createdAt),
          status: comment.status,
        }))
      )

      const shown: OnChainComment[] = graphClean.map((comment) => ({
        id: `c-${comment.id}`,
        postId: comment.post.id,
        author: comment.author.id,
        content: comment.content,
        imageCid: comment.imageCid,
        createdAt: Number(comment.createdAt),
        status: 1,
      }))
      // Group-by-post happens on the client: each comment carries its post id,
      // and the per-post rendering filters on it.
      ;(graphApproved || []).forEach((comment) => {
        shown.push({
          id: `p-${comment.id}`,
          postId: comment.post.id,
          author: comment.author.id,
          content: comment.content,
          imageCid: comment.imageCid,
          createdAt: Number(comment.createdAt),
          status: 1,
        })
      })
      shown.sort((a, b) => a.createdAt - b.createdAt)
      setOnChainComments(shown)
      return
    }

    // Chain fallback (no graph): clean comments via event logs, flagged via storage getters.
    try {
      const contract = await getContract(false, 'moderation')
      const provider = getProvider()
      const shown: OnChainComment[] = []
      const pending: OnChainComment[] = []
      const postIds = new Set(communityPosts.map((post) => post.id))

      // Bounded log scan keeps this cheap on public RPCs.
      const latest = await provider.getBlockNumber()
      const fromBlock = Math.max(0, latest - 50000)

      const hiddenCommentIds = new Set<string>()
      try {
        const hiddenEvents = await contract.queryFilter(contract.filters.CommentHidden(), fromBlock, latest)
        for (const event of hiddenEvents) {
          const args = (event as ethers.EventLog).args
          if (args) hiddenCommentIds.add(args[0].toString())
        }
      } catch {
        // Older deployments have no CommentHidden event.
      }

      const events = await contract.queryFilter(contract.filters.CommentCreated(), fromBlock, latest)
      for (const event of events) {
        const args = (event as ethers.EventLog).args
        if (!args) continue
        if (hiddenCommentIds.has(args[0].toString())) continue
        const postId = args[1].toString()
        if (!postIds.has(postId)) continue
        shown.push({
          id: `c-${args[0].toString()}`,
          postId,
          author: args[3],
          content: args[4],
          imageCid: args[5],
          createdAt: Number(args[6]),
          status: 1,
        })
      }

      for (const post of communityPosts) {
        const ids = await contract.getPendingCommentsByPost(post.id)
        for (const id of ids) {
          const c = await contract.getPendingComment(id)
          const item: OnChainComment = {
            id: `p-${c[0].toString()}`,
            postId: c[1].toString(),
            author: c[2],
            content: c[3],
            imageCid: c[4],
            createdAt: Number(c[5]),
            status: Number(c[6]),
          }
          if (item.status === 0) pending.push(item)
          if (item.status === 1 && !hiddenCommentIds.has(c[0].toString())) shown.push(item)
        }
      }

      shown.sort((a, b) => a.createdAt - b.createdAt)
      setPendingComments(pending)
      setOnChainComments(shown)
    } catch (error) {
      console.error('Failed to load on-chain comments:', error)
    }
  }

  /** Uploads the pending comment image (if any) and returns its CID. */
  const uploadCommentImage = async (postId: string): Promise<string | null> => {
    const image = commentImageByPost[postId]
    if (!image) return ''

    setTemporaryStatus(t('uploadingImages'))
    try {
      return await addFile(image)
    } catch (error) {
      console.error('Comment image upload failed:', error)
      alert(t('imageUploadFailed'))
      return null
    }
  }

  /** Drops loaded comments when no community is selected. */
  const clearComments = () => {
    setOnChainComments([])
    setPendingComments([])
  }

  const clearCommentDraft = (postId: string) => {
    setNewCommentByPost((previous) => ({ ...previous, [postId]: '' }))
    setCommentImageByPost((previous) => ({ ...previous, [postId]: undefined }))
  }

  // Sends a flagged comment on-chain into the moderator review queue.
  const submitFlaggedComment = async (postId: string, reloadPosts: () => Promise<void>) => {
    const content = (newCommentByPost[postId] || '').trim()

    const imageCid = await uploadCommentImage(postId)
    if (imageCid === null) return

    try {
      const contract = await getContract(true, 'moderation')
      const tx = await contract.submitFlaggedComment(postId, content, imageCid)
      const receipt = await tx.wait()

      clearCommentDraft(postId)
      await waitForGraphBlock(receipt.blockNumber)
      await reloadPosts()
      setTemporaryStatus(t('commentSubmittedForReview'))
    } catch (error) {
      console.error('Flagged comment submission failed:', error)
      failWith('commentSubmitFailed', error)
    }
  }

  /** Optimistically shows a just-submitted comment while the tx confirms. */
  const addOptimisticComment = (postId: string, account: string, content: string, imageCid: string) => {
    setOnChainComments((previous) => [
      ...previous,
      {
        id: `pending-${Date.now()}`,
        postId,
        author: account,
        content,
        imageCid,
        createdAt: Math.floor(Date.now() / 1000),
        status: 1,
        confirming: true,
      },
    ])
  }

  return {
    onChainComments,
    pendingComments,
    newCommentByPost,
    setNewCommentByPost,
    commentImageByPost,
    setCommentImageByPost,
    loadOnChainComments,
    clearComments,
    uploadCommentImage,
    clearCommentDraft,
    addOptimisticComment,
    submitFlaggedComment,
  }
}
