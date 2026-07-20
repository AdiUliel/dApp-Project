import { useForum } from '@/context/useForum'
import { Composer, renderRichText } from '@/components/Composer'
import { ipfsUrl, validateImageFile } from '@/services/ipfs'
import { isCommentSignatureValid } from '@/lib/format'
import type { TranslationKey } from '@/lib/i18n'
import type { Post } from '@/types/forum'

/**
 * Comments for an expanded post: on-chain comments (with moderator kebab
 * actions) first, then legacy signed off-chain ones, then the composer -
 * unless the post is locked, which blocks new comments but keeps them visible.
 */
export function CommentThread({ post }: { post: Post }) {
  const {
    t,
    selectedCommunity,
    commentsForPost,
    onChainCommentsForPost,
    openKebabId,
    setOpenKebabId,
    setReportTarget,
    setReportReason,
    hideChainComment,
    newCommentByPost,
    setNewCommentByPost,
    commentImageByPost,
    setCommentImageByPost,
    submitComment,
    formatUser,
    formatDate,
  } = useForum()

  const postComments = commentsForPost(post.id)
  const chainComments = onChainCommentsForPost(post.id)
  const totalComments = postComments.length + chainComments.length

  return (
    <div className="comments-box">
      <h4>{t('offChainComments')}</h4>
      {totalComments === 0 ? (
        <p className="muted-text">{t('noComments')}</p>
      ) : (
        <div className="comments-list">
          {chainComments.map((comment) => (
            <div className={`comment-item ${comment.confirming ? 'confirming-comment' : ''}`} key={`chain-${comment.id}`}>
              {comment.id.startsWith('c-') && (
                <div className="kebab-wrapper comment-kebab">
                  <button
                    className="kebab-button"
                    aria-label={t('postActionsMenu')}
                    title={t('postActionsMenu')}
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpenKebabId(
                        openKebabId === `comment-${comment.id}` ? null : `comment-${comment.id}`
                      )
                    }}
                  >
                    ⋮
                  </button>
                  {openKebabId === `comment-${comment.id}` && (
                    <div className="kebab-menu">
                      <button onClick={() => { setOpenKebabId(null); setReportReason(''); setReportTarget({ kind: 1, id: comment.id }) }}>
                        {t('reportAction')}
                      </button>
                      {selectedCommunity?.isModerator && (
                        <button
                          className="danger"
                          onClick={() => { setOpenKebabId(null); hideChainComment(comment.id) }}
                        >
                          {t('hideCommentAction')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <p className="rich-text">{renderRichText(comment.content)}</p>
              {comment.imageCid && <img className="post-image" src={ipfsUrl(comment.imageCid)} alt="" />}
              <small>
                {formatUser(comment.author)} · {formatDate(comment.createdAt)} ·{' '}
                {comment.confirming ? t('commentConfirmingLabel') : t('onChainComment')}
              </small>
            </div>
          ))}
          {postComments.map((comment, index) => (
            <div className="comment-item" key={`${comment.signature}-${index}`}>
              <p className="rich-text">{renderRichText(comment.content)}</p>
              {comment.imageCid && <img className="post-image" src={ipfsUrl(comment.imageCid)} alt="" />}
              <small>
                {formatUser(comment.author)} · {formatDate(comment.createdAt)} · {t('signatureLabel')}{' '}
                {isCommentSignatureValid(comment) ? t('signatureValid') : t('signatureInvalid')}
              </small>
            </div>
          ))}
        </div>
      )}

      {post.locked ? (
        <p className="muted-text locked-notice">🔒 {t('lockedNotice')}</p>
      ) : (
        <>
          <Composer
            rich
            placeholder={t('commentPh')}
            value={newCommentByPost[post.id] || ''}
            onChange={(value) =>
              setNewCommentByPost((previous) => ({ ...previous, [post.id]: value }))
            }
          />
          <label className="file-input-label">
            {t('attachCommentImage')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                const err = validateImageFile(file)
                if (err) {
                  alert(t(err as TranslationKey, { name: file.name }))
                  return
                }
                setCommentImageByPost((previous) => ({ ...previous, [post.id]: file }))
              }}
            />
          </label>
          {commentImageByPost[post.id] && (
            <div className="image-previews">
              <div className="image-preview">
                <img
                  src={URL.createObjectURL(commentImageByPost[post.id] as File)}
                  alt={commentImageByPost[post.id]?.name}
                />
                <button
                  className="ghost-button"
                  onClick={() =>
                    setCommentImageByPost((previous) => ({ ...previous, [post.id]: undefined }))
                  }
                >
                  {t('removeImage')}
                </button>
              </div>
            </div>
          )}
          <button className="secondary-button full" onClick={() => submitComment(post.id)}>
            {t('sendComment')}
          </button>
        </>
      )}
    </div>
  )
}
