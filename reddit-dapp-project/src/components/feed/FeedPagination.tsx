import { useForum } from '@/context/useForum'

/**
 * Feed pagination bar: page-size chooser (top only), first/prev, a window of
 * page numbers, next/last, and a "page X of Y" readout. Rendered above and
 * below the post list.
 */
export function FeedPagination({ position }: { position: 'top' | 'bottom' }) {
  const { t, visiblePosts, feedPage, setFeedPage, pageCount, postsPerPage, setPostsPerPage } = useForum()

  if (visiblePosts.length === 0) return null

  const windowSize = 2
  const start = Math.max(1, feedPage - windowSize)
  const end = Math.min(pageCount, feedPage + windowSize)
  const pages: number[] = []
  for (let p = start; p <= end; p++) pages.push(p)

  return (
    <div className={`pagination ${position}`}>
      {position === 'top' && (
        <div className="page-size">
          <span>{t('postsPerPage')}</span>
          {[5, 10, 15, 20].map((size) => (
            <button
              key={size}
              className={`chip ${postsPerPage === size ? 'active' : ''}`}
              onClick={() => setPostsPerPage(size)}
            >
              {size}
            </button>
          ))}
        </div>
      )}
      <div className="page-nav">
        <button className="page-btn" disabled={feedPage === 1} onClick={() => setFeedPage(1)} aria-label={t('firstPage')}>«</button>
        <button className="page-btn" disabled={feedPage === 1} onClick={() => setFeedPage(feedPage - 1)} aria-label={t('prevPage')}>‹</button>
        {start > 1 && <button className="page-btn" onClick={() => setFeedPage(1)}>1</button>}
        {start > 2 && <span className="page-ellipsis">…</span>}
        {pages.map((p) => (
          <button key={p} className={`page-btn ${p === feedPage ? 'active' : ''}`} onClick={() => setFeedPage(p)}>
            {p}
          </button>
        ))}
        {end < pageCount - 1 && <span className="page-ellipsis">…</span>}
        {end < pageCount && <button className="page-btn" onClick={() => setFeedPage(pageCount)}>{pageCount}</button>}
        <button className="page-btn" disabled={feedPage === pageCount} onClick={() => setFeedPage(feedPage + 1)} aria-label={t('nextPage')}>›</button>
        <button className="page-btn" disabled={feedPage === pageCount} onClick={() => setFeedPage(pageCount)} aria-label={t('lastPage')}>»</button>
      </div>
      <div className="page-info">{t('pageOf', { page: feedPage, total: pageCount })}</div>
    </div>
  )
}
