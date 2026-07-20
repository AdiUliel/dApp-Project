import { useState } from 'react'
import { searchByTag, searchCommunities, searchPosts, searchUsers } from '@/services/graph'
import type { Community, SearchFilter, SearchResults, View } from '@/types/forum'

type Options = {
  communities: Community[]
  getCommunityDescription: (community: Community) => string
  setView: (view: View) => void
}

/**
 * Search across posts, communities, users and tags. When every subgraph query
 * fails the endpoint is treated as offline and results degrade to filtering
 * the already-loaded communities client-side.
 */
export function useSearch({ communities, getCommunityDescription, setView }: Options) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFilter, setSearchFilter] = useState<SearchFilter>('all')
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [activeSearchTerm, setActiveSearchTerm] = useState('')

  const runSearch = async (term: string, filter: SearchFilter) => {
    const trimmed = term.trim()
    if (!trimmed) return

    setActiveSearchTerm(trimmed)
    setView('search')
    setSearchLoading(true)

    const wantPosts = filter === 'all' || filter === 'posts'
    const wantCommunities = filter === 'all' || filter === 'communities'
    const wantUsers = filter === 'all' || filter === 'users'
    const wantTags = filter === 'all' || filter === 'tags'

    const [postResults, communityResults, userResults, tagResults] = await Promise.all([
      wantPosts ? searchPosts(trimmed) : Promise.resolve([]),
      wantCommunities ? searchCommunities(trimmed) : Promise.resolve([]),
      wantUsers ? searchUsers(trimmed) : Promise.resolve([]),
      wantTags ? searchByTag(trimmed) : Promise.resolve([]),
    ])

    const graphOffline =
      postResults === null && communityResults === null && userResults === null && tagResults === null

    if (graphOffline) {
      // Degraded mode: filter whatever is already loaded client-side.
      const lower = trimmed.toLowerCase()
      const localCommunities = communities
        .filter((community) => community.name.toLowerCase().includes(lower))
        .map((community) => ({
          id: community.id,
          name: community.name,
          description: getCommunityDescription(community),
          membersCount: community.membersCount,
          createdAt: '0',
        }))

      setSearchResults({
        posts: [],
        communities: localCommunities,
        users: [],
        tagPosts: [],
        graphOffline: true,
      })
    } else {
      setSearchResults({
        posts: (postResults || []).filter((post) => !post.hidden),
        communities: communityResults || [],
        users: userResults || [],
        tagPosts: (tagResults || []).filter((post) => !post.hidden),
        graphOffline: false,
      })
    }

    setSearchLoading(false)
  }

  return {
    searchQuery,
    setSearchQuery,
    searchFilter,
    setSearchFilter,
    searchResults,
    searchLoading,
    activeSearchTerm,
    runSearch,
  }
}
