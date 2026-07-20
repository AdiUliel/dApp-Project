import { useForum } from '@/context/useForum'
import { renderRichText } from '@/components/Composer'
import { VoteBox } from '@/components/post/VoteBox'
import { PostImages } from '@/components/post/PostImages'
import { PostKebabMenu } from '@/components/post/PostKebabMenu'
import { CommentThread } from '@/components/comment/CommentThread'
import type { Post } from '@/types/forum'

/**
 * One post in a community feed. Clicking the body toggles the comment thread
 * open/closed - selection is strictly explicit, with no implicit fallback to
 * the first post.
 */
export function PostCard({ post, communityName }: { post: Post; communityName: string }) {
  const {
    t,
    selectedPost,
    setSelectedPostId,
    getPostMetadata,
    commentsForPost,
    onChainCommentsForPost,
    formatUser,
    formatDate,
  } = useForum()

  const metadata = getPostMetadata(post)
  const totalComments = commentsForPost(post.id).length + onChainCommentsForPost(post.id).length
  const isSelected = selectedPost?.id === post.id

  return (
    <article
      className={`post-card panel ${post.hidden && !post.pending ? 'hidden-post' : ''} ${isSelected ? 'selected' : ''} ${post.confirming ? 'confirming-post' : ''}`}
    >
      <VoteBox postId={post.id} />
      <div className="post-card-body">
        <button
          className="post-content-button"
          onClick={() => setSelectedPostId((previous) => (previous === post.id ? '' : post.id))}
        >
          <div className="post-main-content">
            <div className="post-meta-line">
              <span>r/{communityName}</span>
              <span>·</span>
              <span>{formatUser(post.author)}</span>
              <span>·</span>
              <span>{formatDate(post.createdAt)}</span>
            </div>
            <h3>{metadata.title}</h3>
            <p className="rich-text">{renderRichText(metadata.body)}</p>
            <PostImages postId={post.id} images={metadata.images} />
            {metadata.tags && metadata.tags.length > 0 && (
              <div className="tag-row">
                {metadata.tags.map((tag) => (
                  <span key={`${post.id}-${tag}`}>#{tag}</span>
                ))}
              </div>
            )}
            <div className="post-actions-line">
              <span>{t('commentsCount', { count: totalComments })}</span>
              {post.confirming && <span className="badge info">⏳ {t('confirmingBadge')}</span>}
              {post.locked && <span className="badge warning">🔒 {t('lockedBadge')}</span>}
              {post.pending && <span className="badge warning">{t('pendingBadge')}</span>}
              {post.rejected && <span className="badge danger">{t('rejectedBadge')}</span>}
              {post.hidden && !post.pending && !post.rejected && (
                <span className="badge danger">{t('hiddenBadge')}</span>
              )}
            </div>
          </div>
        </button>

        {!post.confirming && <PostKebabMenu post={post} />}

        {isSelected && <CommentThread post={post} />}
      </div>
    </article>
  )
}
