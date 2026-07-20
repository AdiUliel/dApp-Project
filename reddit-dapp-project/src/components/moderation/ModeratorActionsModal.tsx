import Modal from '@/components/Modal'
import { useForum } from '@/context/useForum'

/**
 * Moderator toolbox for the selected community: nominate a moderator, open a
 * removal vote (and see the open ones), ban a member, and - for non-creator
 * moderators - resign.
 */
export function ModeratorActionsModal() {
  const {
    t,
    selectedCommunity,
    setShowModeratorActionsModal,
    recommendInput,
    setRecommendInput,
    recommendModerator,
    removeTargetInput,
    setRemoveTargetInput,
    removeReasonInput,
    setRemoveReasonInput,
    proposeRemoveModerator,
    removalVotes,
    approveRemovalVote,
    banTargetInput,
    setBanTargetInput,
    banReasonInput,
    setBanReasonInput,
    banMember,
    resignFromModeration,
    formatUser,
    formatDate,
  } = useForum()

  if (!selectedCommunity) return null

  const communityRemovalVotes = removalVotes.filter((vote) => vote.communityId === selectedCommunity.id)

  return (
    <Modal title={t('moderatorActions')} onClose={() => setShowModeratorActionsModal(false)}>
      <div className="governance-tools">
        <div className="recommend-box">
          <strong>{t('recommendTitle')}</strong>
          <p className="muted-text">{t('recommendBody')}</p>
          <input
            type="text"
            placeholder={t('recommendPh')}
            value={recommendInput}
            onChange={(event) => setRecommendInput(event.target.value)}
          />
          <button className="secondary-button full" onClick={recommendModerator}>
            {t('recommendButton')}
          </button>
        </div>

        <hr className="tools-divider" />
        <p className="muted-text">{t('removalIntro')}</p>
        <input
          type="text"
          placeholder={t('removeAddrPh')}
          value={removeTargetInput}
          onChange={(event) => setRemoveTargetInput(event.target.value)}
        />
        <input
          type="text"
          placeholder={t('reasonPh')}
          value={removeReasonInput}
          onChange={(event) => setRemoveReasonInput(event.target.value)}
        />
        <button className="danger-button full" onClick={proposeRemoveModerator}>
          {t('openRemoval')}
        </button>

        {communityRemovalVotes.length > 0 && (
          <div className="removal-votes-box">
            <strong>{t('removalVotesSection')}</strong>
            {communityRemovalVotes.map((vote) => (
              <div className="notification-item" key={`modal-removal-${vote.proposalId}`}>
                <strong>{t('removalVoteLine', { target: formatUser(vote.target), name: vote.communityName })}</strong>
                {vote.reason && <small>"{vote.reason}"</small>}
                <small>{t('removalVoteProgress', { approvals: vote.approvals, required: vote.required })}</small>
                <small>{t('expiresOn', { date: formatDate(vote.deadline) })}</small>
                {vote.approvedByMe ? (
                  <small>{t('alreadyApprovedRemoval')}</small>
                ) : (
                  <button className="danger-button" onClick={() => approveRemovalVote(vote.proposalId)}>
                    {t('approveRemoval')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <hr className="tools-divider" />
        <div className="ban-box">
          <strong>{t('banTitle')}</strong>
          <p className="muted-text">{t('banBody')}</p>
          <input
            type="text"
            placeholder={t('banAddrPh')}
            value={banTargetInput}
            onChange={(event) => setBanTargetInput(event.target.value)}
          />
          <input
            type="text"
            placeholder={t('reasonPh')}
            value={banReasonInput}
            onChange={(event) => setBanReasonInput(event.target.value)}
          />
          <button className="danger-button full" onClick={banMember}>
            {t('banButton')}
          </button>
        </div>

        {!selectedCommunity.moderatorRole?.isCreatorModerator && (
          <>
            <hr className="tools-divider" />
            <p className="muted-text">{t('resignBody')}</p>
            <button
              className="ghost-button full"
              onClick={() => resignFromModeration(selectedCommunity.id, selectedCommunity.name)}
            >
              {t('resignButton')}
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
