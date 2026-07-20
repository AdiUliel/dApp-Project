import { useForum } from '@/context/useForum'
import { renderRichText } from '@/components/Composer'
import { roleLabel } from '@/lib/format'

/**
 * Right rail. In a community it shows governance (moderator roster, top active
 * users, moderator tools) and the selected post's details; on home it shows
 * static copy about the trending feed.
 */
export function DetailsSidebar() {
  const {
    t,
    view,
    selectedCommunity,
    selectedPost,
    moderators,
    topActiveUsers,
    setShowModeratorActionsModal,
    getPostMetadata,
    votesByPost,
    commentsForPost,
    onChainCommentsForPost,
    formatUser,
  } = useForum()

  if (view !== 'community') {
    return (
      <aside className="details-sidebar">
        <section className="panel details-card">
          <span className="eyebrow">{t('aboutEyebrow')}</span>
          <h2>{t('aboutTrendingTitle')}</h2>
          <p>{t('aboutTrendingBody')}</p>
          <p className="muted-text">{t('aboutTrendingGraph')}</p>
        </section>
      </aside>
    )
  }

  return (
    <aside className="details-sidebar">
      <section className="panel details-card governance-card">
        <span className="eyebrow">{t('governance')}</span>
        {selectedCommunity ? (
          <>
            <h2>{t('moderatorsTitle')}</h2>
            <p>{t('governanceBody')}</p>

            <div className="mod-list">
              {moderators.length === 0 ? (
                <p className="muted-text">{t('noModData')}</p>
              ) : (
                moderators.map((moderator) => (
                  <div className="mod-row" key={moderator.address}>
                    <div>
                      <strong>{formatUser(moderator.address)}</strong>
                      <small>
                        {roleLabel(moderator.role)} · {t('scoreLabel', { score: moderator.score })}
                      </small>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="active-box">
              <strong>{t('topActive')}</strong>
              {topActiveUsers.length === 0 ? (
                <small>{t('noActiveMods')}</small>
              ) : (
                topActiveUsers.map((address) => <small key={address}>{formatUser(address)}</small>)
              )}
            </div>

            {selectedCommunity.isModerator && (
              <button className="ghost-button full action-trigger" onClick={() => setShowModeratorActionsModal(true)}>
                {t('moderatorActions')}
              </button>
            )}
          </>
        ) : (
          <p className="muted-text">{t('pickCommunityGov')}</p>
        )}
      </section>

      <section className="panel details-card">
        <span className="eyebrow">{t('postDetails')}</span>
        {selectedPost ? (
          <>
            <h2>{getPostMetadata(selectedPost).title}</h2>
            <p className="rich-text">{renderRichText(getPostMetadata(selectedPost).body)}</p>
            <div className="details-grid">
              <span>{t('postIdLabel')}</span>
              <strong>#{selectedPost.id}</strong>
              <span>{t('authorLabel')}</span>
              <strong>{formatUser(selectedPost.author)}</strong>
              <span>{t('scoreDetailLabel')}</span>
              <strong>{votesByPost[selectedPost.id]?.score ?? 0}</strong>
              <span>{t('commentsLabel')}</span>
              <strong>{commentsForPost(selectedPost.id).length + onChainCommentsForPost(selectedPost.id).length}</strong>
            </div>
          </>
        ) : (
          <p className="muted-text">{t('pickPost')}</p>
        )}
      </section>
    </aside>
  )
}
