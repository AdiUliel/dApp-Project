import { useForum } from '@/context/useForum'
import { ActionItems } from '@/components/notifications/ActionItems'
import { NotificationList } from '@/components/notifications/NotificationList'

/** Panel opened by the topbar bell. */
export function NotificationsDropdown() {
  const { t, notifications, markAllNotificationsRead } = useForum()

  return (
    <div className="notifications-dropdown panel">
      <div className="row-heading">
        <h3>{t('notificationsTitle')}</h3>
        {notifications.length > 0 && (
          <button className="ghost-button" onClick={markAllNotificationsRead}>
            {t('markAllRead')}
          </button>
        )}
      </div>
      <ActionItems />
      <NotificationList />
    </div>
  )
}
