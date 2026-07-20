import { useState } from 'react'
import { isTempId } from '@/lib/format'
import type { ForumCore } from './core'
import type { VoteInfo } from '@/types/forum'

/** Post scores and the viewer's own vote, with optimistic casting. */
export function useVotes(core: ForumCore) {
  const { walletAddress, getContract, failWith } = core
  const [votesByPost, setVotesByPost] = useState<Record<string, VoteInfo>>({})

  const loadVotesFor = async (postIds: string[], account = walletAddress) => {
    try {
      const contract = await getContract(false)

      // Fetch every post's score/vote concurrently instead of one-at-a-time.
      const results = await Promise.all(
        postIds.map(async (postId) => {
          const [score, myVote] = await Promise.all([
            contract.postScore(postId),
            account ? contract.postVotes(postId, account) : Promise.resolve(0),
          ])
          return [postId, { score: Number(score), myVote: Number(myVote) }] as const
        }),
      )

      const entries: Record<string, VoteInfo> = {}
      for (const [postId, info] of results) entries[postId] = info
      setVotesByPost((prev) => ({ ...prev, ...entries }))
    } catch (error) {
      console.error('Failed to load votes:', error)
    }
  }

  // Optimistic vote: update the UI immediately, then reconcile with the chain.
  const castVote = async (postId: string, direction: 1 | -1) => {
    // Can't vote on a post that hasn't confirmed on-chain yet.
    if (isTempId(postId)) return

    const current = votesByPost[postId] || { score: 0, myVote: 0 }
    const newVote = current.myVote === direction ? 0 : direction

    setVotesByPost((prev) => ({
      ...prev,
      [postId]: {
        score: current.score - current.myVote + newVote,
        myVote: newVote,
      },
    }))

    try {
      const contract = await getContract(true)
      const tx = await contract.votePost(postId, newVote)
      await tx.wait()
    } catch (error) {
      console.error('Vote failed:', error)
      setVotesByPost((prev) => ({ ...prev, [postId]: current }))
      failWith('voteFailed', error)
    }
  }

  return { votesByPost, loadVotesFor, castVote }
}
