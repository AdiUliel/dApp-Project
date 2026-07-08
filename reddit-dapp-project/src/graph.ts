// Thin client for the Graph node. Callers should treat a null result as
// "graph offline" and fall back to chain reads. The endpoint is set from the
// active network (see setGraphEndpoint) so the same build works local + Sepolia.

import { GRAPH_ENDPOINTS, LOCAL_CHAIN_ID } from './config'

let graphEndpoint = GRAPH_ENDPOINTS[LOCAL_CHAIN_ID]

export function setGraphEndpoint(chainId: number) {
  graphEndpoint = GRAPH_ENDPOINTS[chainId] || ''
}

export async function graphQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  if (!graphEndpoint) return null

  try {
    const response = await fetch(graphEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) return null

    const payload = await response.json()
    if (payload.errors) {
      console.error('Graph query errors:', payload.errors)
      return null
    }

    return payload.data as T
  } catch {
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

export async function fetchApprovedComments(postId: string): Promise<GraphPendingComment[] | null> {
  const data = await graphQuery<{ pendingComments: GraphPendingComment[] }>(
    `query ($post: String!) { pendingComments(where: { post: $post, status: 1, hidden: false }, orderBy: createdAt, orderDirection: asc) { id content imageCid status hidden createdAt post { id } author { id username } } }`,
    { post: postId }
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

// Blocks until the graph has indexed up to the given block (or times out /
// graph is offline). Call after a tx before re-querying graph-backed data,
// otherwise the refresh races the indexer and reads stale results.
export async function waitForGraphBlock(blockNumber: number, timeoutMs = 8000): Promise<void> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const data = await graphQuery<{ _meta: { block: { number: number } } }>('{ _meta { block { number } } }')
    if (!data) return
    if (data._meta.block.number >= blockNumber) return
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
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
