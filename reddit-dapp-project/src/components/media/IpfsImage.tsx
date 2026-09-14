import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useForum } from '@/context/useForum'
import { ipfsGatewayUrls } from '@/services/ipfs'

type IpfsImageProps = {
  cid: string
  className?: string
  loading?: 'lazy' | 'eager'
  /** How long one gateway gets to finish loading before the next is tried. */
  timeoutMs?: number
  /** Called with the URL that actually loaded (used for "open original"). */
  onResolved?: (url: string) => void
}

type Status = 'loading' | 'loaded' | 'failed'

/**
 * An IPFS image that falls back across gateways. A freshly pinned file can be
 * unavailable on one gateway for a long time while another already serves it,
 * and a hung gateway never fires `error`, hence the per-gateway timeout. While
 * loading - and if every gateway fails - a visible placeholder replaces the
 * image, instead of a failed <img alt=""> collapsing to an invisible 0x0 box.
 */
export function IpfsImage({ cid, className, loading = 'lazy', timeoutMs = 12000, onResolved }: IpfsImageProps) {
  const { t } = useForum()
  const urls = useMemo(() => ipfsGatewayUrls(cid), [cid])
  const [attempt, setAttempt] = useState(0)
  // Bumped by "retry": a query string makes the browser re-request instead of
  // reusing its memory of the failed load.
  const [round, setRound] = useState(0)
  const [status, setStatus] = useState<Status>('loading')

  // Lazy loading is done here rather than with <img loading="lazy">: the
  // browser defers a lazy image until it scrolls near the viewport, but the
  // gateway timeout below would keep running, so an image further down the
  // feed would burn through every gateway before it was ever requested.
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const [inView, setInView] = useState(loading === 'eager')

  useEffect(() => {
    if (inView) return
    const element = wrapperRef.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [inView])

  useEffect(() => {
    setAttempt(0)
    setRound(0)
    setStatus('loading')
  }, [cid])

  const tryNextGateway = () => {
    if (attempt + 1 < urls.length) setAttempt(attempt + 1)
    else setStatus('failed')
  }

  useEffect(() => {
    // The clock only runs once the image is actually being requested.
    if (status !== 'loading' || !inView) return
    const timer = setTimeout(tryNextGateway, timeoutMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, round, status, timeoutMs, inView])

  const retry = (event: MouseEvent | KeyboardEvent) => {
    // The placeholder sits inside a clickable thumbnail / post card.
    event.stopPropagation()
    setAttempt(0)
    setRound((value) => value + 1)
    setStatus('loading')
  }

  const src = round > 0 ? `${urls[attempt]}?retry=${round}` : urls[attempt]

  return (
    <span ref={wrapperRef} className={`ipfs-image ${status}`}>
      {inView && status !== 'failed' && (
        <img
          // A fresh element per attempt: events from an abandoned load can't
          // leak into the next one, and no stale frame is ever shown.
          key={`${attempt}-${round}`}
          className={className}
          src={src}
          alt=""
          onLoad={() => {
            setStatus('loaded')
            onResolved?.(urls[attempt])
          }}
          onError={tryNextGateway}
        />
      )}

      {status === 'loading' && <span className="ipfs-image-placeholder">{t('imageLoading')}</span>}

      {status === 'failed' && (
        <span className="ipfs-image-placeholder failed">
          <span>{t('imageUnavailable')}</span>
          <span
            role="button"
            tabIndex={0}
            className="ipfs-image-retry"
            onClick={retry}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              retry(event)
            }}
          >
            {t('imageRetry')}
          </span>
        </span>
      )}
    </span>
  )
}
