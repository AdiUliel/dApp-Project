import { useForum } from '@/context/useForum'
import { ipfsUrl } from '@/services/ipfs'
import { renderRichText } from '@/components/Composer'
import { PostImages } from '@/components/post/PostImages'

/**
 * Moderator-only queue for the current community: posts and comments awaiting
 * review, plus open content reports. Hidden entirely when there is nothing to
 * act on.
 */
export function PendingReviewPanel() {
  const {
    t,
    selectedCommunity,
    pendingPosts,
    pendingComments,
    reports,
    getPostMetadata,
    formatUser,
    formatDate,
    decidePendingPost,
    decidePendingComment,
    resolveReport,
  } = useForum()

  if (!selectedCommunity?.isModerator) return null
  if (pendingPosts.length === 0 && pendingComments.length === 0 && reports.length === 0) return null

  return (
    <section className="panel secondary-create-card review-panel">
      <div className="section-heading">
        <span className="eyebrow">{t('pendingReviewTitle')}</span>
        <p className="muted-text">{t('pendingReviewBody')}</p>
      </div>

      {pendingPosts.length > 0 && (
        <div className="review-group">
          <h3>{t('pendingPostsTitle')}</h3>
          {pendingPosts.map((post) => {
            const metadata = getPostMetadata(post)
            return (
              <div className="review-item" key={`pending-post-${post.id}`}>
                <div className="review-item-body">
                  <strong>{metadata.title}</strong>
                  <p className="rich-text">{renderRichText(metadata.body)}</p>
                  <PostImages postId={post.id} images={metadata.images} />
                  <small>
                    {formatUser(post.author)} · {formatDate(post.createdAt)}
                  </small>
                </div>
                <div className="review-actions">
                  <button className="primary-button" onClick={() => decidePendingPost(post.id, true)}>
                    {t('approve')}
                  </button>
                  <button className="danger-button" onClick={() => decidePendingPost(post.id, false)}>
                    {t('reject')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {pendingComments.length > 0 && (
        <div className="review-group">
          <h3>{t('pendingCommentsTitle')}</h3>
          {pendingComments.map((comment) => (
            <div className="review-item" key={`pending-comment-${comment.id}`}>
              <div className="review-item-body">
                <p className="rich-text">{renderRichText(comment.content)}</p>
                {comment.imageCid && <img className="post-image" src={ipfsUrl(comment.imageCid)} alt="" />}
                <small>
                  {formatUser(comment.author)} · {formatDate(comment.createdAt)} · Post #{comment.postId}
                </small>
              </div>
              <div className="review-actions">
                <button className="primary-button" onClick={() => decidePendingComment(comment.id, true)}>
                  {t('approve')}
                </button>
                <button className="danger-button" onClick={() => decidePendingComment(comment.id, false)}>
                  {t('reject')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {reports.length > 0 && (
        <div className="review-group">
          <h3>{t('reportsTitle')}</h3>
          {reports.map((report) => (
            <div className="review-item" key={`report-${report.id}`}>
              <div className="review-item-body">
                <strong>{report.kind === 0 ? t('reportOnPost', { id: report.refId }) : t('reportOnComment', { id: report.refId })}</strong>
                <p className="rich-text">"{report.lastReason}"</p>
                <small>
                  {report.reportCount > 1 && <>{t('reportCount', { count: report.reportCount })} · </>}
                  {formatDate(report.lastReportedAt)}
                </small>
              </div>
              <div className="review-actions">
                <button
                  className="primary-button"
                  onClick={() => resolveReport(report.kind as 0 | 1, report.refId, 1)}
                >
                  {t('reportActionTaken')}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => resolveReport(report.kind as 0 | 1, report.refId, 0)}
                >
                  {t('reportDismiss')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
