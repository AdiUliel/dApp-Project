import { useForum } from '@/context/useForum'
import type { Post } from '@/types/forum'

/**
 * Three-dot menu pinned to a post card. Everyone gets hide-for-me and report;
 * moderators additionally get hide/restore and lock/unlock. A global click
 * listener in useForumState closes whichever menu is open.
 */
export function PostKebabMenu({ post }: { post: Post }) {
  const {
    t,
    selectedCommunity,
    openKebabId,
    setOpenKebabId,
    hiddenForMe,
    hidePostForMe,
    unhidePostForMe,
    setReportTarget,
    setReportReason,
    hidePost,
    restorePost,
    setPostLock,
  } = useForum()

  const menuId = `post-${post.id}`

  return (
    <div className="kebab-wrapper post-kebab">
      <button
        className="kebab-button"
        aria-label={t('postActionsMenu')}
        title={t('postActionsMenu')}
        onClick={(event) => {
          event.stopPropagation()
          setOpenKebabId(openKebabId === menuId ? null : menuId)
        }}
      >
        ⋮
      </button>
      {openKebabId === menuId && (
        <div className="kebab-menu">
          {hiddenForMe.includes(post.id) ? (
            <button onClick={() => { setOpenKebabId(null); unhidePostForMe(post.id) }}>
              {t('unhideForMe')}
            </button>
          ) : (
            <button onClick={() => { setOpenKebabId(null); hidePostForMe(post.id) }}>
              {t('hideForMe')}
            </button>
          )}
          <button onClick={() => { setOpenKebabId(null); setReportReason(''); setReportTarget({ kind: 0, id: post.id }) }}>
            {t('reportAction')}
          </button>
          {selectedCommunity?.isModerator && !post.pending && !post.rejected && (
            <>
              {post.hidden ? (
                <button onClick={() => { setOpenKebabId(null); restorePost(post.id) }}>
                  {t('restorePost')}
                </button>
              ) : (
                <button className="danger" onClick={() => { setOpenKebabId(null); hidePost(post.id) }}>
                  {t('hidePostButton')}
                </button>
              )}
              {post.locked ? (
                <button onClick={() => { setOpenKebabId(null); setPostLock(post.id, false) }}>
                  {t('unlockPostAction')}
                </button>
              ) : (
                <button onClick={() => { setOpenKebabId(null); setPostLock(post.id, true) }}>
                  {t('lockPostAction')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
