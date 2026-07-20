import { useForum } from '@/context/useForum'
import { CommunityHero } from '@/components/community/CommunityHero'
import { PendingReviewPanel } from '@/components/moderation/PendingReviewPanel'
import { CreatePostCard } from '@/components/post/CreatePostCard'
import { PostCard } from '@/components/post/PostCard'
import { FeedPagination } from '@/components/feed/FeedPagination'

/** The selected community: header, moderator queue, composer and paged feed. */
export function CommunityFeed() {
  const {
    t,
    selectedCommunity,
    showCreatePost,
    visiblePosts,
    pagedPosts,
    hiddenForMeCount,
    showHiddenForMe,
    setShowHiddenForMe,
  } = useForum()

  if (!selectedCommunity) {
    return (
      <section className="empty-state panel">
        <h2>{t('pickCommunity')}</h2>
        <p>{t('pickCommunityBody')}</p>
      </section>
    )
  }

  return (
    <>
      <CommunityHero community={selectedCommunity} />

      <PendingReviewPanel />

      {showCreatePost && <CreatePostCard />}

      <section className="feed-list">
        <div className="feed-title-row">
          <h2>{t('feed')}</h2>
          <span>{t('postsCount', { count: visiblePosts.length })}</span>
        </div>

        {hiddenForMeCount > 0 && (
          <button className="ghost-button hidden-toggle" onClick={() => setShowHiddenForMe((previous) => !previous)}>
            {showHiddenForMe ? t('hideHiddenPosts') : t('showHiddenPosts', { count: hiddenForMeCount })}
          </button>
        )}

        {visiblePosts.length === 0 ? (
          <div className="empty-state panel">
            <h3>{t('noPostsYet')}</h3>
            <p>{t('noPostsBody')}</p>
          </div>
        ) : (
          <>
            <FeedPagination position="top" />
            {pagedPosts.map((post) => (
              <PostCard key={post.id} post={post} communityName={selectedCommunity.name} />
            ))}
            <FeedPagination position="bottom" />
          </>
        )}
      </section>
    </>
  )
}
