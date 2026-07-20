import { useForum } from '@/context/useForum'
import { renderRichText } from '@/components/Composer'
import { VoteBox } from '@/components/post/VoteBox'
import { PostImages } from '@/components/post/PostImages'

/** Home feed: cross-community posts ranked by the "hot" score. */
export function TrendingFeed() {
  const { t, trendingSource, rankedTrending, getPostMetadata, formatUser, formatDate, openCommunity } = useForum()

  return (
    <>
      <section className="panel community-hero">
        <div>
          <span className="eyebrow">{t('home')}</span>
          <h2>{t('trending')}</h2>
          <p>
            {t('trendingBody')}
            {trendingSource === 'chain' && t('trendingOffline')}
          </p>
        </div>
      </section>

      <section className="feed-list">
        {rankedTrending.length === 0 ? (
          <div className="empty-state panel">
            <h3>{t('noPostsYet')}</h3>
            <p>{t('noTrendingBody')}</p>
          </div>
        ) : (
          rankedTrending.map((post) => {
            const metadata = getPostMetadata(post)
            const title = post.title || metadata.title
            const tags = post.tags.length > 0 ? post.tags : metadata.tags || []

            return (
              <article className="post-card panel" key={`trending-${post.id}`}>
                <VoteBox postId={post.id} />
                <button className="post-content-button" onClick={() => openCommunity(post.communityId)}>
                  <div className="post-main-content">
                    <div className="post-meta-line">
                      <span>r/{post.communityName}</span>
                      <span>·</span>
                      <span>{formatUser(post.author)}</span>
                      <span>·</span>
                      <span>{formatDate(post.createdAt)}</span>
                    </div>
                    <h3>{title}</h3>
                    <p className="rich-text">{renderRichText(metadata.body)}</p>
                    <PostImages postId={post.id} images={metadata.images} />
                    {tags.length > 0 && (
                      <div className="tag-row">
                        {tags.map((tag) => (
                          <span key={`trending-${post.id}-${tag}`}>#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              </article>
            )
          })
        )}
      </section>
    </>
  )
}
