import { useForum } from '@/context/useForum'
import type { Community } from '@/types/forum'

/**
 * One row in the sidebar community list. Recurses into sub-communities,
 * indenting each level.
 */
export function CommunityNavItem({ community, depth = 0 }: { community: Community; depth?: number }) {
  const { t, view, selectedCommunityId, communitiesByParent, openCommunity } = useForum()
  const children = communitiesByParent[community.id] || []

  return (
    <div>
      <button
        className={`community-item ${view === 'community' && selectedCommunityId === community.id ? 'active' : ''} ${community.confirming ? 'confirming-community' : ''}`}
        style={{ paddingInlineStart: `${0.75 + depth * 1.1}rem` }}
        onClick={() => openCommunity(community.id)}
      >
        <span className="community-avatar">{depth > 0 ? '↳' : 'r/'}</span>
        <span className="community-main">
          <strong>r/{community.name}</strong>
          <small>
            {community.confirming ? t('confirmingBadge') : t('membersLabel', { count: community.membersCount })}
          </small>
        </span>
        {community.confirming && <span className="mini-badge">⏳</span>}
        {!community.confirming && community.isModerator && <span className="mini-badge mod">MOD</span>}
      </button>

      {children.map((child) => (
        <CommunityNavItem key={child.id} community={child} depth={depth + 1} />
      ))}
    </div>
  )
}
