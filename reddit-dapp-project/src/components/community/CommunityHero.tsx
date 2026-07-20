import { useForum } from '@/context/useForum'
import { roleLabel } from '@/lib/format'
import type { Community } from '@/types/forum'

/** Community header: identity, membership/role badges, and the primary actions. */
export function CommunityHero({ community }: { community: Community }) {
  const {
    t,
    getCommunityDescription,
    formatUser,
    joinCommunity,
    leaveCommunity,
    showCreatePost,
    setShowCreatePost,
    setShowCreateSubCommunityModal,
  } = useForum()

  return (
    <section className="community-hero panel">
      <div>
        <span className="eyebrow">{t('community')}</span>
        <h2>r/{community.name}</h2>
        <p>{getCommunityDescription(community)}</p>
        <div className="meta-row">
          <span>{t('membersLabel', { count: community.membersCount })}</span>
          <span>{t('creatorLabel', { name: formatUser(community.creator) })}</span>
          {community.parentCommunityId !== '0' && <span className="badge info">{t('subCommunityBadge')}</span>}
          {community.isMember && <span className="badge success">{t('memberBadge')}</span>}
          {community.isModerator && <span className="badge warning">{roleLabel(community.moderatorRole)}</span>}
          {community.isBanned && <span className="badge danger">{t('bannedBadge')}</span>}
        </div>
      </div>

      <div className="hero-actions">
        {!community.isMember && !community.isBanned && (
          <button className="primary-button" onClick={() => joinCommunity(community.id)}>
            {t('join')}
          </button>
        )}
        <button className="secondary-button" onClick={() => setShowCreatePost((previous) => !previous)}>
          {showCreatePost ? t('closeEditor') : t('writePost')}
        </button>
        <button className="ghost-button" onClick={() => setShowCreateSubCommunityModal(true)}>
          {t('subCommunityButton')}
        </button>
        {community.isMember && !community.moderatorRole?.isCreatorModerator && (
          <button className="ghost-button" onClick={() => leaveCommunity(community.id)}>
            {t('leaveCommunity')}
          </button>
        )}
      </div>
    </section>
  )
}
