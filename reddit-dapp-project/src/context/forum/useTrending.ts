import { useMemo, useState } from 'react'
import { fetchRecentPosts } from '@/services/graph'
import { hotScore } from '@/lib/format'
import type { ForumCore } from './core'
import type { Community, TrendingPost } from '@/types/forum'

type Options = {
  communities: Community[]
  loadVotesFor: (postIds: string[]) => Promise<void>
}

/**
 * The home feed. Prefers the subgraph (rich data in one query) and falls back
 * to direct chain reads when the graph stack is offline, which is why the
 * source is surfaced to the UI.
 */
export function useTrending(core: ForumCore, { communities, loadVotesFor }: Options) {
  const { getContract } = core

  const [trendingPosts, setTrendingPosts] = useState<TrendingPost[]>([])
  const [trendingSource, setTrendingSource] = useState<'graph' | 'chain'>('chain')

  const rankedTrending = useMemo(() => {
    const memberCommunityIds = new Set(communities.filter((c) => c.isMember).map((c) => c.id))
    return [...trendingPosts].sort(
      (a, b) =>
        hotScore(b.score, b.createdAt, memberCommunityIds.has(b.communityId)) -
        hotScore(a.score, a.createdAt, memberCommunityIds.has(a.communityId))
    )
  }, [trendingPosts, communities])

  const loadTrending = async () => {
    const graphPosts = await fetchRecentPosts(50)

    if (graphPosts) {
      setTrendingSource('graph')
      setTrendingPosts(
        graphPosts.map((post) => ({
          id: post.id,
          communityId: post.community.id,
          communityName: post.community.name,
          author: post.author.id,
          contentCID: post.contentCID,
          createdAt: Number(post.createdAt),
          score: Number(post.score),
          title: post.title,
          tags: post.tags,
        }))
      )
      loadVotesFor(graphPosts.map((post) => post.id))
      return
    }

    setTrendingSource('chain')

    try {
      const contract = await getContract(false)
      // See loadPosts: on networks with no moderation contract deployed yet,
      // this resolves to null and every post is treated as visible.
      const moderation = await getContract(false, 'moderation').catch(() => null)
      const communityIds = await contract.getAllCommunityIds()
      const collected: TrendingPost[] = []

      for (const communityId of communityIds) {
        const community = communities.find((c) => c.id === communityId.toString())
        const name = community ? community.name : (await contract.getCommunity(communityId))[1]
        const postIds = await contract.getPostsByCommunity(communityId)

        for (const postId of postIds) {
          const post = await contract.getPost(postId)

          if (moderation) {
            try {
              const [hidden, pending, rejected] = await Promise.all([
                moderation.postHidden(postId),
                moderation.postPendingReview(postId),
                moderation.postRejected(postId),
              ])
              if (hidden || pending || rejected) continue
            } catch {
              // No moderation contract on this network - treat as visible.
            }
          }

          const score = await contract.postScore(postId)

          collected.push({
            id: post[0].toString(),
            communityId: communityId.toString(),
            communityName: name,
            author: post[2],
            contentCID: post[3],
            createdAt: Number(post[4]),
            score: Number(score),
            title: '',
            tags: [],
          })
        }
      }

      setTrendingPosts(collected)
      loadVotesFor(collected.map((post) => post.id))
    } catch (error) {
      console.error('Failed to load trending posts:', error)
      setTrendingPosts([])
    }
  }

  return { trendingPosts, trendingSource, rankedTrending, loadTrending }
}
