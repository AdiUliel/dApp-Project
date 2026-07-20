import { useForum } from '@/context/useForum'
import { formatAddress } from '@/lib/format'
import type { SearchFilter } from '@/types/forum'

/**
 * Search results across posts, communities, users and tags. Backed by the
 * subgraph; when it is unreachable the provider degrades to filtering the
 * already-loaded communities client-side and flags that here.
 */
export function SearchView() {
  const {
    t,
    searchFilter,
    setSearchFilter,
    searchResults,
    searchLoading,
    activeSearchTerm,
    runSearch,
    openCommunity,
    openProfile,
  } = useForum()

  const filters: { key: SearchFilter; label: string }[] = [
    { key: 'all', label: t('filterAll') },
    { key: 'posts', label: t('filterPosts') },
    { key: 'communities', label: t('filterCommunities') },
    { key: 'users', label: t('filterUsers') },
    { key: 'tags', label: t('filterTags') },
  ]

  return (
    <main className="page-view">
      <section className="panel page-card">
        <span className="eyebrow">{t('searchTitle')}</span>
        <h2>{t('resultsFor', { term: activeSearchTerm })}</h2>

        <div className="filter-chips">
          {filters.map((filter) => (
            <button
              key={filter.key}
              className={`chip ${searchFilter === filter.key ? 'active' : ''}`}
              onClick={() => {
                setSearchFilter(filter.key)
                runSearch(activeSearchTerm, filter.key)
              }}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {searchResults?.graphOffline && <p className="warning-text">{t('graphOfflineSearch')}</p>}

        {searchLoading ? (
          <p className="muted-text">{t('searching')}</p>
        ) : !searchResults ? (
          <p className="muted-text">{t('typeToSearch')}</p>
        ) : (
          <>
            {(searchFilter === 'all' || searchFilter === 'communities') && searchResults.communities.length > 0 && (
              <div className="result-group">
                <h3>{t('filterCommunities')}</h3>
                {searchResults.communities.map((community) => (
                  <button
                    className="result-row"
                    key={`sc-${community.id}`}
                    onClick={() => openCommunity(community.id)}
                  >
                    <strong>r/{community.name}</strong>
                    <small>
                      {community.description} · {t('membersLabel', { count: community.membersCount })}
                    </small>
                  </button>
                ))}
              </div>
            )}

            {(searchFilter === 'all' || searchFilter === 'posts') && searchResults.posts.length > 0 && (
              <div className="result-group">
                <h3>{t('filterPosts')}</h3>
                {searchResults.posts.map((post) => (
                  <button className="result-row" key={`sp-${post.id}`} onClick={() => openCommunity(post.community.id)}>
                    <strong>{post.title}</strong>
                    <small>
                      r/{post.community.name} · {t('byAuthor', { name: post.author.username || formatAddress(post.author.id) })} ·{' '}
                      {post.score}
                      {post.tags.length > 0 ? ` · ${post.tags.map((tag) => `#${tag}`).join(' ')}` : ''}
                    </small>
                  </button>
                ))}
              </div>
            )}

            {(searchFilter === 'all' || searchFilter === 'tags') && searchResults.tagPosts.length > 0 && (
              <div className="result-group">
                <h3>{t('taggedPosts', { term: activeSearchTerm })}</h3>
                {searchResults.tagPosts.map((post) => (
                  <button className="result-row" key={`st-${post.id}`} onClick={() => openCommunity(post.community.id)}>
                    <strong>{post.title}</strong>
                    <small>
                      r/{post.community.name} · {t('byAuthor', { name: post.author.username || formatAddress(post.author.id) })} ·{' '}
                      {post.score}
                    </small>
                  </button>
                ))}
              </div>
            )}

            {(searchFilter === 'all' || searchFilter === 'users') && searchResults.users.length > 0 && (
              <div className="result-group">
                <h3>{t('filterUsers')}</h3>
                {searchResults.users.map((user) => (
                  <button className="result-row" key={`su-${user.id}`} onClick={() => openProfile(user.id)}>
                    <strong>@{user.username || formatAddress(user.id)}</strong>
                    <small>
                      {t('statPosts')}: {user.postCount} · {t('statCommunities')}: {user.communitiesJoined}
                    </small>
                  </button>
                ))}
              </div>
            )}

            {searchResults.posts.length === 0 &&
              searchResults.communities.length === 0 &&
              searchResults.users.length === 0 &&
              searchResults.tagPosts.length === 0 && <p className="muted-text">{t('noResults')}</p>}
          </>
        )}
      </section>
    </main>
  )
}
