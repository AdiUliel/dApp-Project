import Modal from '@/components/Modal'
import { useForum } from '@/context/useForum'

/**
 * Shown when the client-side safety filter flags a post or comment: the user
 * can route it into the moderator queue instead of publishing directly.
 */
export function ReviewPromptModal() {
  const { t, reviewPrompt, setReviewPrompt, confirmReviewSubmission } = useForum()

  if (!reviewPrompt) return null

  return (
    <Modal title={t('unsafeTitle')} onClose={() => setReviewPrompt(null)}>
      <p>{reviewPrompt.kind === 'post' ? t('unsafePostBody') : t('unsafeCommentBody')}</p>
      {reviewPrompt.selfHarm && <p className="warning-text">{t('selfHarmNote')}</p>}
      <div className="review-actions">
        <button className="primary-button" onClick={confirmReviewSubmission}>
          {t('submitForReview')}
        </button>
        <button className="ghost-button" onClick={() => setReviewPrompt(null)}>
          {t('cancel')}
        </button>
      </div>
    </Modal>
  )
}
