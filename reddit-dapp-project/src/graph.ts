// Thin client for the Graph node. Callers should treat a null result as
// "graph offline" and fall back to chain reads. The endpoint is set from the
// active network (see setGraphEndpoint) so the same build works local + Sepolia.

import { GRAPH_ENDPOINTS, LOCAL_CHAIN_ID } from './config'

let graphEndpoint = GRAPH_ENDPOINTS[LOCAL_CHAIN_ID]

export function setGraphEndpoint(chainId: number) {
  graphEndpoint = GRAPH_ENDPOINTS[chainId] || ''
}

// Every graph call is capped at 5s: a hung graph-node must not freeze the UI.
// A null result means "graph unavailable" and callers fall back to chain reads.
export const GRAPH_TIMEOUT_MS = 5000

export async function graphQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  if (!graphEndpoint) return null

  try {
    const response = await fetch(graphEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      // Aborts the request (throws a TimeoutError) if the graph doesn't answer.
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    })

    if (!response.ok) return null

    const payload = await response.json()
    if (payload.errors) {
      console.error('Graph query errors:', payload.errors)
      return null
    }

    return payload.data as T
  } catch (error) {
    // Distinguish a timeout (graph too slow / hung) from other failures
    // (offline, DNS, CORS) so slowness is diagnosable, not silently swallowed.
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      console.warn(`Graph query timed out after ${GRAPH_TIMEOUT_MS}ms; falling back to chain reads.`)
    } else {
      console.warn('Graph query failed (graph offline?):', error)
    }
    return null
  }
}

export type GraphPost = {
  id: string
  title: string
  tags: string[]
  contentCID: string
  score: string
  upvotes: string
  downvotes: string
  hidden: boolean
  locked: boolean
  pending: boolean
  rejected: boolean
  createdAt: string
  community: { id: string; name: string }
  author: { id: string; username: string | null }
}

export type GraphCommunity = {
  id: string
  name: string
  description: string
  membersCount: string
  createdAt: string
}

export type GraphUser = {
  id: string
  username: string | null
  postCount: number
  communitiesJoined: number
  totalGasUsed: string
  totalFeesWei: string
  registeredAt: string | null
}

export type GraphActivity = {
  id: string
  type: string
  refId: string | null
  detail: string | null
  gasUsed: string
  feeWei: string
  timestamp: string
}

export type GraphNotification = {
  id: string
  type: string
  refId: string | null
  detail: string | null
  timestamp: string
  actor: { id: string; username: string | null } | null
}

const POST_FIELDS = `
  id
  title
  tags
  contentCID
  score
  upvotes
  downvotes
  hidden
  locked
  pending
  rejected
  createdAt
  community { id name }
  author { id username }
`

// The @fulltext search is backed by Postgres to_tsquery, which needs boolean
// operators between terms - a raw "word1 word2" is a syntax error, not a search.
// Turn the user's plain text into a valid tsquery: keep only word characters
// (Unicode-aware, so Hebrew works), match each as a prefix (:*) so partial words
// still hit, and AND them together so every term must appear. Returns '' when
// there is nothing searchable, letting callers skip the query.
function toFulltextQuery(term: string): string {
  const tokens = term.match(/[\p{L}\p{N}_]+/gu)
  if (!tokens || tokens.length === 0) return ''
  return tokens.map((token) => `${token}:*`).join(' & ')
}

export async function searchPosts(term: string): Promise<GraphPost[] | null> {
  const text = toFulltextQuery(term)
  if (!text) return []
  const data = await graphQuery<{ postSearch: GraphPost[] }>(
    `query ($text: String!) { postSearch(text: $text, first: 25) { ${POST_FIELDS} } }`,
    { text }
  )
  return data ? data.postSearch : null
}

export async function searchCommunities(term: string): Promise<GraphCommunity[] | null> {
  const text = toFulltextQuery(term)
  if (!text) return []
  const data = await graphQuery<{ communitySearch: GraphCommunity[] }>(
    `query ($text: String!) { communitySearch(text: $text, first: 25) { id name description membersCount createdAt } }`,
    { text }
  )
  return data ? data.communitySearch : null
}

export async function searchUsers(term: string): Promise<GraphUser[] | null> {
  const text = toFulltextQuery(term)
  if (!text) return []
  const data = await graphQuery<{ userSearch: GraphUser[] }>(
    `query ($text: String!) { userSearch(text: $text, first: 25) { id username postCount communitiesJoined totalGasUsed totalFeesWei registeredAt } }`,
    { text }
  )
  return data ? data.userSearch : null
}

export async function searchByTag(tag: string): Promise<GraphPost[] | null> {
  const data = await graphQuery<{ posts: GraphPost[] }>(
    `query ($tag: String!) { posts(first: 25, where: { tags_contains: [$tag] }, orderBy: createdAt, orderDirection: desc) { ${POST_FIELDS} } }`,
    { tag }
  )
  return data ? data.posts : null
}

export async function fetchRecentPosts(limit: number): Promise<GraphPost[] | null> {
  const data = await graphQuery<{ posts: GraphPost[] }>(
    `query ($limit: Int!) { posts(first: $limit, where: { hidden: false, pending: false, rejected: false }, orderBy: createdAt, orderDirection: desc) { ${POST_FIELDS} } }`,
    { limit }
  )
  return data ? data.posts : null
}

export type GraphCommunityPage = {
  posts: GraphPost[]
  // Exact number of publicly visible posts in the community (maintained by the
  // subgraph), so the pager can show real page numbers without loading the feed.
  totalVisible: number
}

// One real page of a community's public feed: first/skip pagination done by the
// graph, newest first, plus the total for the page count - a single query
// replacing the old "read every post via eth_call" pattern.
export async function fetchCommunityPage(
  communityId: string,
  first: number,
  skip: number
): Promise<GraphCommunityPage | null> {
  const data = await graphQuery<{
    posts: GraphPost[]
    community: { visiblePostsCount: string } | null
  }>(
    `query ($community: String!, $id: ID!, $first: Int!, $skip: Int!) {
      posts(where: { community: $community, hidden: false, pending: false, rejected: false }, orderBy: createdAt, orderDirection: desc, first: $first, skip: $skip) { ${POST_FIELDS} }
      community(id: $id) { visiblePostsCount }
    }`,
    { community: communityId, id: communityId, first, skip }
  )
  if (!data) return null
  return {
    posts: data.posts,
    totalVisible: data.community ? Number(data.community.visiblePostsCount) : data.posts.length,
  }
}

// Non-public posts the viewer is allowed to see on top of the public page:
// moderators get every hidden/pending/rejected post (bounded), a regular user
// gets only their own. Small and bounded, so it rides along with any page.
export async function fetchNonPublicPosts(
  communityId: string,
  viewer: string,
  isModerator: boolean
): Promise<GraphPost[] | null> {
  if (!isModerator && !viewer) return []
  const where = isModerator
    ? `{ community: $community, hidden: true }`
    : `{ community: $community, hidden: true, author: $viewer }`
  const data = await graphQuery<{ posts: GraphPost[] }>(
    `query ($community: String!, $viewer: String) { posts(where: ${where}, orderBy: createdAt, orderDirection: desc, first: 50) { ${POST_FIELDS} } }`,
    { community: communityId, viewer: viewer.toLowerCase() }
  )
  return data ? data.posts : null
}

// The connected account's own votes on a set of posts, in ONE query - replaces
// a postVotes eth_call per post.
export async function fetchMyVotes(
  account: string,
  postIds: string[]
): Promise<Record<string, number> | null> {
  if (!account || postIds.length === 0) return {}
  const data = await graphQuery<{ votes: { post: { id: string }; value: number }[] }>(
    `query ($voter: String!, $posts: [String!]!) { votes(where: { voter: $voter, post_in: $posts }, first: ${Math.min(postIds.length, 100)}) { post { id } value } }`,
    { voter: account.toLowerCase(), posts: postIds }
  )
  if (!data) return null
  const byPost: Record<string, number> = {}
  for (const vote of data.votes) byPost[vote.post.id] = vote.value
  return byPost
}

export type GraphPendingComment = {
  id: string
  content: string
  imageCid: string
  status: number
  hidden: boolean
  createdAt: string
  post: { id: string }
  author: { id: string; username: string | null }
}

export async function fetchPendingComments(communityId: string): Promise<GraphPendingComment[] | null> {
  const data = await graphQuery<{ pendingComments: GraphPendingComment[] }>(
    `query ($community: String!) { pendingComments(where: { community: $community, status: 0 }, orderBy: createdAt, orderDirection: asc) { id content imageCid status hidden createdAt post { id } author { id username } } }`,
    { community: communityId }
  )
  return data ? data.pendingComments : null
}

// ALL approved formerly-flagged comments of a community in ONE query; the
// frontend groups them by post. Replaces the old per-post query (N+1).
export async function fetchApprovedComments(communityId: string): Promise<GraphPendingComment[] | null> {
  const data = await graphQuery<{ pendingComments: GraphPendingComment[] }>(
    `query ($community: String!) { pendingComments(where: { community: $community, status: 1, hidden: false }, orderBy: createdAt, orderDirection: asc, first: 500) { id content imageCid status hidden createdAt post { id } author { id username } } }`,
    { community: communityId }
  )
  return data ? data.pendingComments : null
}

export type GraphComment = {
  id: string
  content: string
  imageCid: string
  createdAt: string
  post: { id: string }
  author: { id: string; username: string | null }
}

// Blocks until the graph has indexed up to the given block. Call after a tx
// before re-querying graph-backed data, otherwise the refresh races the indexer
// and reads stale results.
// Returns true once the block is indexed; false if the graph is offline or the
// wait times out - so the caller knows whether the data it's about to read is
// actually up to date.
export async function waitForGraphBlock(blockNumber: number, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const data = await graphQuery<{ _meta: { block: { number: number } } }>('{ _meta { block { number } } }')
    if (!data) return false
    if (data._meta.block.number >= blockNumber) return true
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  return false
}

// Clean on-chain comments across a community (all its posts).
export async function fetchComments(communityId: string): Promise<GraphComment[] | null> {
  const data = await graphQuery<{ comments: GraphComment[] }>(
    `query ($community: String!) { comments(where: { community: $community, hidden: false }, orderBy: createdAt, orderDirection: asc, first: 500) { id content imageCid createdAt post { id } author { id username } } }`,
    { community: communityId }
  )
  return data ? data.comments : null
}

// One open thread per reported piece of content. Duplicates collapse into
// reportCount, and once a moderator resolves/dismisses it (status != 0) it drops
// out of this query, so the moderator queue only ever shows outstanding work.
export type GraphReportThread = {
  id: string
  kind: number
  refId: string
  status: number
  reportCount: number
  lastReason: string
  firstReportedAt: string
  lastReportedAt: string
}

export async function fetchReports(communityId: string, skip = 0): Promise<GraphReportThread[] | null> {
  const data = await graphQuery<{ reportThreads: GraphReportThread[] }>(
    `query ($community: String!, $skip: Int!) { reportThreads(where: { community: $community, status: 0 }, orderBy: lastReportedAt, orderDirection: desc, first: 100, skip: $skip) { id kind refId status reportCount lastReason firstReportedAt lastReportedAt } }`,
    { community: communityId, skip }
  )
  return data ? data.reportThreads : null
}

export type GraphBannedUser = {
  id: string
  reason: string
  bannedAt: string
  user: { id: string; username: string | null }
  bannedBy: { id: string; username: string | null }
}

// Banned users of a community (with the reason), for the moderator panel.
export async function fetchBannedUsers(communityId: string): Promise<GraphBannedUser[] | null> {
  const data = await graphQuery<{ bannedUsers: GraphBannedUser[] }>(
    `query ($community: String!) { bannedUsers(where: { community: $community }, orderBy: bannedAt, orderDirection: desc, first: 100) { id reason bannedAt user { id username } bannedBy { id username } } }`,
    { community: communityId }
  )
  return data ? data.bannedUsers : null
}

export async function fetchUserProfile(address: string): Promise<GraphUser | null> {
  const data = await graphQuery<{ user: GraphUser | null }>(
    `query ($id: ID!) { user(id: $id) { id username postCount communitiesJoined totalGasUsed totalFeesWei registeredAt } }`,
    { id: address.toLowerCase() }
  )
  return data ? data.user : null
}

export async function fetchUserActivities(address: string, limit: number): Promise<GraphActivity[] | null> {
  const data = await graphQuery<{ activities: GraphActivity[] }>(
    `query ($user: String!, $limit: Int!) { activities(first: $limit, where: { user: $user }, orderBy: timestamp, orderDirection: desc) { id type refId detail gasUsed feeWei timestamp } }`,
    { user: address.toLowerCase(), limit }
  )
  return data ? data.activities : null
}

export async function fetchUserNotifications(address: string, limit: number): Promise<GraphNotification[] | null> {
  const data = await graphQuery<{ notifications: GraphNotification[] }>(
    `query ($user: String!, $limit: Int!) { notifications(first: $limit, where: { recipient: $user }, orderBy: timestamp, orderDirection: desc) { id type refId detail timestamp actor { id username } } }`,
    { user: address.toLowerCase(), limit }
  )
  return data ? data.notifications : null
}
