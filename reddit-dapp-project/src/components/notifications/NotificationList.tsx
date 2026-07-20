import { useForum } from '@/context/useForum'

/** Notification feed. Clicking a single item marks just that one as read. */
export function NotificationList() {
  const { t, notifications, readNotificationIds, markNotificationRead, notifLabel, formatUser, formatDate } = useForum()

  if (notifications.length === 0) {
    return <p className="muted-text">{t('noNotifications')}</p>
  }

  return (
    <div className="notification-list">
      {notifications.map((notification) => {
        const isRead = readNotificationIds.includes(notification.id)
        return (
          <div
            className={`notification-item ${isRead ? '' : 'unread clickable'}`}
            key={notification.id}
            role="button"
            tabIndex={0}
            title={isRead ? undefined : t('clickToMarkRead')}
            onClick={() => markNotificationRead(notification.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') markNotificationRead(notification.id)
            }}
          >
            <strong>{notifLabel(notification.type)}</strong>
            <small>
              {notification.detail && `"${notification.detail}" · `}
              {notification.actorLabel &&
                `${notification.actorLabel.startsWith('0x') ? formatUser(notification.actorLabel) : notification.actorLabel} · `}
              {formatDate(notification.timestamp)}
            </small>
          </div>
        )
      })}
    </div>
  )
}
