import { useForum } from '@/context/useForum'
import { ActionItems } from '@/components/notifications/ActionItems'
import { NotificationList } from '@/components/notifications/NotificationList'
import { formatAddress, formatEth } from '@/lib/format'

/**
 * A user's profile. Stats and activity come from the subgraph, so both
 * sections are replaced by a notice when it is unreachable. The notifications
 * block only renders on the viewer's own profile.
 */
export function ProfileView() {
  const {
    t,
    walletAddress,
    username,
    usernamesCache,
    profileAddress,
    profileData,
    profileActivities,
    profileGraphOffline,
    notifications,
    markAllNotificationsRead,
    bellCount,
    activityLabel,
    formatDate,
    setUsernameInput,
    setChangeCooldownRemaining,
    setShowChangeUsernameModal,
    getContract,
  } = useForum()

  const isOwnProfile = profileAddress.toLowerCase() === walletAddress.toLowerCase()
  const displayName =
    (isOwnProfile && username) ||
    usernamesCache[profileAddress] ||
    profileData?.username ||
    formatAddress(profileAddress)

  return (
    <main className="page-view">
      <section className="panel page-card">
        <div className="row-heading">
          <div>
            <span className="eyebrow">{isOwnProfile ? t('personalArea') : t('userProfile')}</span>
            <h2>@{displayName}</h2>
            <p className="muted-text">{profileAddress}</p>
          </div>
          {isOwnProfile && (
            <button
              className="ghost-button"
              onClick={() => {
                setUsernameInput('')
                setChangeCooldownRemaining(0)
                setShowChangeUsernameModal(true)
                getContract(false, 'usernameRegistry')
                  .then((contract) => contract.getCooldownRemaining(walletAddress))
                  .then((remaining: bigint) => setChangeCooldownRemaining(Number(remaining)))
                  .catch(() => setChangeCooldownRemaining(0))
              }}
            >
              {t('changeUsernameButton')}
            </button>
          )}
        </div>

        {profileGraphOffline ? (
          <p className="warning-text">{t('graphOfflineProfile')}</p>
        ) : (
          <div className="stats-row">
            <div className="stat-box">
              <strong>{profileData?.postCount ?? 0}</strong>
              <small>{t('statPosts')}</small>
            </div>
            <div className="stat-box">
              <strong>{profileData?.communitiesJoined ?? 0}</strong>
              <small>{t('statCommunities')}</small>
            </div>
            <div className="stat-box">
              <strong>{Number(profileData?.totalGasUsed ?? '0').toLocaleString()}</strong>
              <small>{t('statGas')}</small>
            </div>
            <div className="stat-box">
              <strong>{formatEth(profileData?.totalFeesWei ?? '0')}</strong>
              <small>{t('statFees')}</small>
            </div>
          </div>
        )}
      </section>

      {isOwnProfile && (
        <section className="panel page-card">
          <div className="row-heading">
            <h3>
              {t('notificationsTitle')}{' '}
              {bellCount > 0 && <span className="badge warning">{t('newBadge', { count: bellCount })}</span>}
            </h3>
            {notifications.length > 0 && (
              <button className="ghost-button" onClick={markAllNotificationsRead}>
                {t('markAllRead')}
              </button>
            )}
          </div>
          <p className="muted-text">{t('commentReplyNote')}</p>

          <ActionItems />
          <NotificationList />
        </section>
      )}

      {!profileGraphOffline && (
        <section className="panel page-card">
          <h3>{t('recentActivity')}</h3>
          {profileActivities.length === 0 ? (
            <p className="muted-text">{t('noActivity')}</p>
          ) : (
            <div className="activity-list">
              {profileActivities.map((activity) => (
                <div className="activity-item" key={activity.id}>
                  <strong>{activityLabel(activity.type)}</strong>
                  <small>
                    {activity.detail && `${activity.detail} · `}
                    {t('gasLine', { gas: Number(activity.gasUsed).toLocaleString() })} · {formatEth(activity.feeWei)} ·{' '}
                    {formatDate(activity.timestamp)}
                  </small>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  )
}
