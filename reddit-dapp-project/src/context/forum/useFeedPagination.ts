import { useMemo, useState } from 'react'
import type { Community, Post } from '@/types/forum'

type Options = {
  posts: Post[]
  hiddenForMe: string[]
  showHiddenForMe: boolean
  selectedCommunity: Community | undefined
  selectedCommunityId: string
  myAddress: string
}

/**
 * Turns the raw post list into what the feed actually renders: moderation
 * visibility, then the personal hide-for-me filter, then paging.
 */
export function useFeedPagination({
  posts,
  hiddenForMe,
  showHiddenForMe,
  selectedCommunity,
  selectedCommunityId,
  myAddress,
}: Options) {
  const [postsPerPage, setPostsPerPage] = useState(10)
  const [feedPage, setFeedPage] = useState(1)

  // Posts visible in this community by moderation/authorship rules, before the
  // personal "hide for me" filter.
  const moderationVisiblePosts = useMemo(() => {
    return posts.filter((post) => {
      if (selectedCommunity?.isModerator) return true
      if (post.author.toLowerCase() === myAddress) return true
      return !post.hidden && !post.pending && !post.rejected
    })
  }, [posts, selectedCommunity?.isModerator, myAddress])

  const hiddenForMeCount = useMemo(
    () => moderationVisiblePosts.filter((post) => hiddenForMe.includes(post.id)).length,
    [moderationVisiblePosts, hiddenForMe],
  )

  // Personal hide-for-me applied on top (unless the user is peeking at hidden ones).
  const visiblePosts = useMemo(() => {
    if (showHiddenForMe) return moderationVisiblePosts
    return moderationVisiblePosts.filter((post) => !hiddenForMe.includes(post.id))
  }, [moderationVisiblePosts, hiddenForMe, showHiddenForMe])

  const pageCount = Math.max(1, Math.ceil(visiblePosts.length / postsPerPage))

  // Page corrections are applied during render rather than in an effect. Doing
  // this in an effect renders the stale page first and then immediately renders
  // again; adjusting here lets React discard the bad render before it commits.
  // (https://react.dev/learn/you-might-not-need-an-effect)
  const resetKey = `${selectedCommunityId}|${postsPerPage}`
  const [lastResetKey, setLastResetKey] = useState(resetKey)

  if (resetKey !== lastResetKey) {
    // Switching community or page size starts over at page one.
    setLastResetKey(resetKey)
    setFeedPage(1)
  } else if (feedPage > pageCount) {
    // The list shrank under us - don't strand the user past the end.
    setFeedPage(pageCount)
  }

  const currentPage = Math.min(feedPage, pageCount)

  const pagedPosts = useMemo(() => {
    const start = (currentPage - 1) * postsPerPage
    return visiblePosts.slice(start, start + postsPerPage)
  }, [visiblePosts, currentPage, postsPerPage])

  const pendingPosts = useMemo(() => posts.filter((post) => post.pending), [posts])

  return {
    visiblePosts,
    pagedPosts,
    pendingPosts,
    hiddenForMeCount,
    pageCount,
    feedPage: currentPage,
    setFeedPage,
    postsPerPage,
    setPostsPerPage,
  }
}
