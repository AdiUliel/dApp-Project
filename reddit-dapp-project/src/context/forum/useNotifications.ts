import { useMemo, useState } from 'react'
import { fetchUserNotifications, graphQuery } from '@/services/graph'
import type { TranslationKey, Translator } from '@/lib/i18n'
import type { NotificationItem, SignedComment } from '@/types/forum'

type Options = {
  t: Translator
  readStoredComments: () => SignedComment[]
  readNotificationIds: string[]
  markNotificationsRead: (ids: string[]) => void
}

/**
 * Merges on-chain notifications from the subgraph with comment replies found
 * in this browser's localStorage - off-chain comments made on another machine
 * are simply not visible here.
 */
export function useNotifications({ t, readStoredComments, readNotificationIds, markNotificationsRead }: Options) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false)

  const unreadNotificationsCount = useMemo(() => {
    const read = new Set(readNotificationIds)
    return notifications.filter((notification) => !read.has(notification.id)).length
  }, [notifications, readNotificationIds])

  const loadNotifications = async (account: string) => {
    const items: NotificationItem[] = []

    const graphNotifications = await fetchUserNotifications(account, 50)
    if (graphNotifications) {
      for (const notification of graphNotifications) {
        items.push({
          id: notification.id,
          type: notification.type,
          detail: notification.detail || '',
          actorLabel: notification.actor ? notification.actor.username || notification.actor.id : '',
          timestamp: Number(notification.timestamp) * 1000,
        })
      }
    }

    const myPosts = await graphQuery<{ posts: { id: string; title: string }[] }>(
      `query ($author: String!) { posts(where: { author: $author }) { id title } }`,
      { author: account.toLowerCase() }
    )

    if (myPosts) {
      const myPostsById = new Map(myPosts.posts.map((post) => [post.id, post.title]))
      const localComments = readStoredComments()

      for (const comment of localComments) {
        if (myPostsById.has(comment.postId) && comment.author.toLowerCase() !== account.toLowerCase()) {
          items.push({
            id: `comment-${comment.signature.slice(0, 18)}`,
            type: 'COMMENT_REPLY',
            detail: myPostsById.get(comment.postId) || '',
            actorLabel: comment.author,
            timestamp: comment.createdAt,
          })
        }
      }
    }

    items.sort((a, b) => b.timestamp - a.timestamp)
    setNotifications(items)
  }

  const markAllNotificationsRead = () => {
    markNotificationsRead(notifications.map((notification) => notification.id))
  }

  const notifLabel = (type: string) => {
    const key = `notif_${type}` as TranslationKey
    const label = t(key)
    return label === key ? type : label
  }

  const activityLabel = (type: string) => {
    const key = `act_${type}` as TranslationKey
    const label = t(key)
    return label === key ? type : label
  }

  return {
    notifications,
    unreadNotificationsCount,
    showNotificationsPanel,
    setShowNotificationsPanel,
    loadNotifications,
    markAllNotificationsRead,
    notifLabel,
    activityLabel,
  }
}
