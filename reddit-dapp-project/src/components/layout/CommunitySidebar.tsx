import { useForum } from '@/context/useForum'
import { CommunityNavItem } from '@/components/community/CommunityNavItem'

/** Left rail: the community tree plus the create-community entry point. */
export function CommunitySidebar() {
  const { t, communities, rootCommunities, setShowCreateCommunityModal } = useForum()

  return (
    <aside className="sidebar">
      <section className="panel communities-panel">
        <div className="section-heading row-heading">
          <div>
            <span className="eyebrow">{t('subForums')}</span>
            <h2>{t('communities')}</h2>
          </div>
          <span className="counter-pill">{communities.length}</span>
        </div>

        <button className="primary-button full action-trigger" onClick={() => setShowCreateCommunityModal(true)}>
          {t('newCommunity')}
        </button>

        {communities.length === 0 ? (
          <p className="muted-text">{t('noCommunities')}</p>
        ) : (
          <div className="community-list">
            {rootCommunities.map((community) => (
              <CommunityNavItem key={community.id} community={community} />
            ))}
          </div>
        )}
      </section>
    </aside>
  )
}
