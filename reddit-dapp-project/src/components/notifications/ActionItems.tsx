import { useForum } from '@/context/useForum'

/**
 * Items waiting for the user's decision: moderator nominations to accept or
 * decline, and open removal votes in communities they moderate. Shown both in
 * the bell dropdown and on the user's own profile.
 */
export function ActionItems() {
  const {
    t,
    moderatorOffers,
    removalVotes,
    acceptModeratorOffer,
    declineModeratorOffer,
    approveRemovalVote,
    formatUser,
  } = useForum()

  if (moderatorOffers.length === 0 && removalVotes.length === 0) return null

  return (
    <div className="action-items">
      {moderatorOffers.map((community) => (
        <div className="notification-item unread action-item" key={`offer-${community.id}`}>
          <strong>{t('offerLine', { name: community.name })}</strong>
          <div className="review-actions">
            <button className="primary-button" onClick={() => acceptModeratorOffer(community.id)}>
              {t('acceptRole')}
            </button>
            <button className="ghost-button" onClick={() => declineModeratorOffer(community.id)}>
              {t('declineRole')}
            </button>
          </div>
        </div>
      ))}

      {removalVotes.map((vote) => (
        <div
          className={`notification-item action-item ${vote.approvedByMe ? '' : 'unread'}`}
          key={`removal-${vote.proposalId}`}
        >
          <strong>
            {t('removalVoteLine', {
              target: formatUser(vote.target),
              name: vote.communityName,
            })}
          </strong>
          <small>
            {t('removalVoteProgress', { approvals: vote.approvals, required: vote.required })}
          </small>
          {vote.approvedByMe ? (
            <small>{t('alreadyApprovedRemoval')}</small>
          ) : (
            <div className="review-actions">
              <button className="danger-button" onClick={() => approveRemovalVote(vote.proposalId)}>
                {t('approveRemoval')}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
