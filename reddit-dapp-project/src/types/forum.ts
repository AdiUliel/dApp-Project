// Domain types shared across the forum UI. These mirror what the three
// contracts (DecentralizedForum / UsernameRegistry / ForumModeration) and the
// subgraph return, normalised into the shapes the components actually render.
import type { GraphPost, GraphUser } from '@/services/graph'

/** Which of the three deployed contracts a call should be routed to. */
export type ContractName = 'forum' | 'usernameRegistry' | 'moderation'

/** Top-level screen. `community` and `home` share the three-column layout. */
export type View = 'home' | 'community' | 'profile' | 'search'

export type ModeratorRole = {
  isModerator: boolean
  isCreatorModerator: boolean
  isActiveBasedModerator: boolean
  isAppointedModerator: boolean
}

export type ModeratorDisplay = {
  address: string
  score: string
  role: ModeratorRole
}

export type Community = {
  id: string
  name: string
  creator: string
  metadataCID: string
  membersCount: string
  isMember: boolean
  isModerator: boolean
  isBanned: boolean
  parentCommunityId: string
  moderatorRole?: ModeratorRole
  hasModeratorOffer: boolean
  // Optimistic placeholder shown while creation confirms on-chain.
  confirming?: boolean
}

export type CommunityMetadata = {
  description: string
  rules?: string[]
}

export type Post = {
  id: string
  communityId: string
  author: string
  contentCID: string
  createdAt: string
  hidden: boolean
  locked: boolean
  pending: boolean
  rejected: boolean
  // Optimistic placeholder shown while the tx is confirming on-chain; replaced
  // by the canonical post once the graph indexes it.
  confirming?: boolean
}

export type PostMetadata = {
  title: string
  body: string
  tags?: string[]
  images?: string[]
}

/** Anything we pin to / read back from IPFS for this app. */
export type IpfsMetadataRecord = PostMetadata | CommunityMetadata

/** Legacy off-chain comment: signed in the browser, kept in localStorage. */
export type SignedComment = {
  postId: string
  author: string
  content: string
  createdAt: number
  message: string
  signature: string
  imageCid?: string
}

export type OnChainComment = {
  id: string
  postId: string
  author: string
  content: string
  imageCid: string
  createdAt: number
  status: number
  // Optimistic placeholder shown while the tx is confirming on-chain.
  confirming?: boolean
}

export type VoteInfo = {
  score: number
  myVote: number
}

export type TrendingPost = {
  id: string
  communityId: string
  communityName: string
  author: string
  contentCID: string
  createdAt: number
  score: number
  title: string
  tags: string[]
}

export type NotificationItem = {
  id: string
  type: string
  detail: string
  actorLabel: string
  timestamp: number
}

export type RemovalVote = {
  proposalId: string
  communityId: string
  communityName: string
  target: string
  approvals: number
  required: number
  approvedByMe: boolean
  reason: string
  deadline: number
}

export type SearchFilter = 'all' | 'posts' | 'communities' | 'users' | 'tags'

export type SearchResults = {
  posts: GraphPost[]
  communities: { id: string; name: string; description: string; membersCount: string; createdAt: string }[]
  users: GraphUser[]
  tagPosts: GraphPost[]
  graphOffline: boolean
}

/** Set when content tripped the safety filter and the user must opt into review. */
export type ReviewPrompt =
  | { kind: 'post'; selfHarm: boolean }
  | { kind: 'comment'; postId: string; selfHarm: boolean }

/** Target of the report dialog: kind 0 = post, 1 = comment. */
export type ReportTarget = { kind: 0 | 1; id: string }

declare global {
  interface Window {
    ethereum?: unknown
  }
}
