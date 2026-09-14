import { useEffect, useState } from 'react'
import type { MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useForum } from '@/context/useForum'
import { ipfsUrl } from '@/services/ipfs'

type ImageGalleryProps = {
  cids: string[]
  /** Namespaces React keys when the same CID appears in several places. */
  idPrefix: string
}

/**
 * Clickable thumbnails for IPFS images. Clicking one opens a full-screen view
 * with next/previous navigation when there is more than one image.
 */
export function ImageGallery({ cids, idPrefix }: ImageGalleryProps) {
  const { t } = useForum()
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  if (cids.length === 0) return null

  return (
    <>
      <div className="post-images">
        {cids.map((cid, index) => (
          // Not a <button>: thumbnails render inside the post card, whose body is
          // itself a <button>, and HTML forbids nesting buttons.
          <span
            role="button"
            tabIndex={0}
            className="post-image-button"
            key={`${idPrefix}-${cid}-${index}`}
            aria-label={t('openImage')}
            title={t('openImage')}
            onClick={(event) => {
              event.stopPropagation()
              setOpenIndex(index)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              setOpenIndex(index)
            }}
          >
            <img className="post-image" src={ipfsUrl(cid)} alt="" loading="lazy" />
          </span>
        ))}
      </div>

      {openIndex !== null && (
        <ImageLightbox cids={cids} index={openIndex} onIndexChange={setOpenIndex} onClose={() => setOpenIndex(null)} />
      )}
    </>
  )
}

type ImageLightboxProps = {
  cids: string[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}

function ImageLightbox({ cids, index, onIndexChange, onClose }: ImageLightboxProps) {
  const { t, lang } = useForum()
  const rtl = lang === 'he'
  const count = cids.length
  const current = ipfsUrl(cids[index])

  const step = (delta: number) => onIndexChange((index + delta + count) % count)

  // Stop the page behind the viewer from scrolling. Separate from the key
  // handler so re-renders can't capture 'hidden' as the value to restore.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      // Arrow direction follows reading direction: in Hebrew "next" is on the left.
      else if (count > 1 && event.key === 'ArrowRight') onIndexChange((index + (rtl ? -1 : 1) + count) % count)
      else if (count > 1 && event.key === 'ArrowLeft') onIndexChange((index + (rtl ? 1 : -1) + count) % count)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, count, rtl, onClose, onIndexChange])

  // The viewer is portaled to <body>, but React still bubbles its clicks up the
  // component tree - they must not reach the post card underneath.
  const swallow = (event: MouseEvent) => event.stopPropagation()

  return createPortal(
    <div
      className="lightbox-overlay"
      dir={rtl ? 'rtl' : 'ltr'}
      role="dialog"
      aria-modal="true"
      aria-label={t('imageViewer')}
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
    >
      <button
        type="button"
        className="lightbox-close"
        aria-label={t('closeImage')}
        autoFocus
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
      >
        ✕
      </button>

      {count > 1 && (
        <button
          type="button"
          className="lightbox-nav prev"
          aria-label={t('previousImage')}
          onClick={(event) => {
            event.stopPropagation()
            step(-1)
          }}
        >
          ‹
        </button>
      )}

      <figure className="lightbox-figure" onClick={swallow}>
        <img className="lightbox-image" src={current} alt="" />
        <figcaption className="lightbox-caption">
          {count > 1 && (
            <span>
              {index + 1} / {count}
            </span>
          )}
          <a href={current} target="_blank" rel="noopener noreferrer" onClick={swallow}>
            {t('openOriginalImage')}
          </a>
        </figcaption>
      </figure>

      {count > 1 && (
        <button
          type="button"
          className="lightbox-nav next"
          aria-label={t('nextImage')}
          onClick={(event) => {
            event.stopPropagation()
            step(1)
          }}
        >
          ›
        </button>
      )}
    </div>,
    document.body,
  )
}
