import { useEffect, useState } from 'react'
import { COMMENTS_STORAGE_KEY, HIDDEN_POSTS_KEY, READ_NOTIFICATIONS_KEY } from '@/lib/storageKeys'
import type { Translator } from '@/lib/i18n'
import type { WalletContextValue } from '@/features/wallet/WalletProvider'
import type { SignedComment } from '@/types/forum'

type Options = {
  t: Translator
  walletAddress: string
  getProvider: WalletContextValue['getProvider']
  setTemporaryStatus: (message: string) => void
}

/**
 * Everything persisted in localStorage, scoped by a deployment fingerprint
 * (the genesis block hash) so data from an older chain deployment - where post
 * ids restart from 1 - can never surface against a newer one. The personal
 * hide-for-me list is additionally scoped per account.
 */
export function useScopedStorage({ t, walletAddress, getProvider, setTemporaryStatus }: Options) {
  const [storageScope, setStorageScope] = useState('')
  const [comments, setComments] = useState<SignedComment[]>([])
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([])
  const [hiddenForMe, setHiddenForMe] = useState<string[]>([])
  const [showHiddenForMe, setShowHiddenForMe] = useState(false)

  const scopedStorageKey = (base: string) => (storageScope ? `${base}_${storageScope}` : '')

  const readStoredComments = (): SignedComment[] => {
    const key = scopedStorageKey(COMMENTS_STORAGE_KEY)
    if (!key) return []

    try {
      return JSON.parse(localStorage.getItem(key) || '[]')
    } catch (error) {
      console.error('Failed to load local comments:', error)
      return []
    }
  }

  const loadLocalComments = () => {
    setComments(readStoredComments())
  }

  const loadReadNotificationIds = (): string[] => {
    const key = scopedStorageKey(READ_NOTIFICATIONS_KEY)
    if (!key) return []

    try {
      return JSON.parse(localStorage.getItem(key) || '[]')
    } catch {
      return []
    }
  }

  // Per-account (and per-deployment) key for the personal hide-for-me list.
  const hiddenPostsKey = () => {
    const base = scopedStorageKey(HIDDEN_POSTS_KEY)
    return base && walletAddress ? `${base}_${walletAddress.toLowerCase()}` : ''
  }

  const loadHiddenForMe = () => {
    const key = hiddenPostsKey()
    if (!key) {
      setHiddenForMe([])
      return
    }
    try {
      setHiddenForMe(JSON.parse(localStorage.getItem(key) || '[]'))
    } catch {
      setHiddenForMe([])
    }
  }

  const persistHiddenForMe = (ids: string[]) => {
    const key = hiddenPostsKey()
    if (key) localStorage.setItem(key, JSON.stringify(ids))
    setHiddenForMe(ids)
  }

  // Resolve the deployment fingerprint as soon as a provider is available.
  useEffect(() => {
    if (!window.ethereum) return

    let cancelled = false

    getProvider()
      .getBlock(0)
      .then((genesis) => {
        if (!cancelled) setStorageScope(genesis?.hash ? genesis.hash.slice(2, 12) : 'default')
      })
      .catch(() => {
        if (!cancelled) setStorageScope('default')
      })

    return () => {
      cancelled = true
    }
  }, [walletAddress])

  useEffect(() => {
    if (!storageScope) return

    // Data under the old unscoped keys belongs to previous deployments where
    // post ids restart from 1, so it must not be shown - drop it for good.
    localStorage.removeItem(COMMENTS_STORAGE_KEY)
    localStorage.removeItem(READ_NOTIFICATIONS_KEY)

    loadLocalComments()
    setReadNotificationIds(loadReadNotificationIds())
  }, [storageScope])

  // Personal hide-for-me list is scoped by both deployment and account.
  useEffect(() => {
    loadHiddenForMe()
    setShowHiddenForMe(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageScope, walletAddress])

  const markNotificationsRead = (ids: string[]) => {
    const key = scopedStorageKey(READ_NOTIFICATIONS_KEY)
    if (key) localStorage.setItem(key, JSON.stringify(ids))
    setReadNotificationIds(ids)
  }

  // Clicking a single notification marks just that one as read.
  const markNotificationRead = (id: string) => {
    if (readNotificationIds.includes(id)) return
    markNotificationsRead([...readNotificationIds, id])
  }

  // `onHidden` lets the caller collapse the post if it is the expanded one -
  // selection lives outside this hook.
  const hidePostForMe = (postId: string, onHidden?: (postId: string) => void) => {
    if (hiddenForMe.includes(postId)) return
    persistHiddenForMe([...hiddenForMe, postId])
    onHidden?.(postId)
    setTemporaryStatus(t('postHiddenForYou'))
  }

  const unhidePostForMe = (postId: string) => {
    persistHiddenForMe(hiddenForMe.filter((id) => id !== postId))
  }

  return {
    storageScope,
    comments,
    readStoredComments,
    readNotificationIds,
    markNotificationRead,
    markNotificationsRead,
    hiddenForMe,
    showHiddenForMe,
    setShowHiddenForMe,
    hidePostForMe,
    unhidePostForMe,
  }
}
