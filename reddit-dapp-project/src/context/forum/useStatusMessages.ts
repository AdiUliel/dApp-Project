import { useRef, useState } from 'react'
import { describeTxError } from '@/lib/txErrors'
import type { TranslationKey, Translator } from '@/lib/i18n'

/**
 * The two toast channels: a general status line and the louder moderator
 * alert, which auto-clears after 8s.
 */
export function useStatusMessages(t: Translator) {
  const [statusMessage, setStatusMessage] = useState('')
  const [modNotification, setModNotification] = useState('')
  const modTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setTemporaryStatus = (message: string) => {
    setStatusMessage(message)
  }

  const flashModNotification = (message: string) => {
    setModNotification(message)
    if (modTimeout.current) clearTimeout(modTimeout.current)
    modTimeout.current = setTimeout(() => setModNotification(''), 8000)
  }

  const failWith = (key: TranslationKey, error: unknown) => {
    alert(`${t(key)}\n${describeTxError(error, t)}`)
  }

  return { statusMessage, modNotification, setTemporaryStatus, flashModNotification, failWith }
}
