import { useEffect, useMemo, useRef, useState } from 'react'
import { ethers } from 'ethers'
import contractArtifact from './DecentralizedForum.json'
import { addJson, addFile, getJson, ipfsUrl } from './ipfs'
import Modal from './Modal'
import { Composer, renderRichText } from './Composer'
import { validateUsername, isValidCommunityName } from './usernamePolicy'
import { checkContentSafety } from './contentSafety'
import { loadLanguage, makeTranslator, LANGUAGE_STORAGE_KEY, type Language, type TranslationKey } from './i18n'
import { contractAddressForChain, NETWORK_NAMES } from './config'
import {
  fetchApprovedComments,
  fetchBannedUsers,
  fetchComments,
  fetchPendingComments,
  fetchReports,
  fetchRecentPosts,
  setGraphEndpoint,
  waitForGraphBlock,
  fetchUserActivities,
  fetchUserNotifications,
  fetchUserProfile,
  graphQuery,
  searchByTag,
  searchCommunities,
  searchPosts,
  searchUsers,
  type GraphActivity,
  type GraphBannedUser,
  type GraphPost,
  type GraphReportThread,
  type GraphUser,
} from './graph'
import './App.css'

const COMMENTS_STORAGE_KEY = 'reppit_signed_comments_v1'
const READ_NOTIFICATIONS_KEY = 'reppit_read_notifications_v1'
const HIDDEN_POSTS_KEY = 'reppit_hidden_posts_v1'
const USERNAME_CHANGE_FEE_ETH = '0.05'

type View = 'home' | 'community' | 'profile' | 'search'

type Community = {
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

type ModeratorRole = {
  isModerator: boolean
  isCreatorModerator: boolean
  isActiveBasedModerator: boolean
  isAppointedModerator: boolean
}

type ModeratorDisplay = {
  address: string
  score: string
  role: ModeratorRole
}

type CommunityMetadata = {
  description: string
  rules?: string[]
}

type Post = {
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

type PostMetadata = {
  title: string
  body: string
  tags?: string[]
  images?: string[]
}

type IpfsMetadataRecord = PostMetadata | CommunityMetadata

type SignedComment = {
  postId: string
  author: string
  content: string
  createdAt: number
  message: string
  signature: string
  imageCid?: string
}

type OnChainComment = {
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

type VoteInfo = {
  score: number
  myVote: number
}

type TrendingPost = {
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

type NotificationItem = {
  id: string
  type: string
  detail: string
  actorLabel: string
  timestamp: number
}

type RemovalVote = {
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

type SearchFilter = 'all' | 'posts' | 'communities' | 'users' | 'tags'

type SearchResults = {
  posts: GraphPost[]
  communities: { id: string; name: string; description: string; membersCount: string; createdAt: string }[]
  users: GraphUser[]
  tagPosts: GraphPost[]
  graphOffline: boolean
}

type ReviewPrompt =
  | { kind: 'post'; selfHarm: boolean }
  | { kind: 'comment'; postId: string; selfHarm: boolean }

declare global {
  interface Window {
    ethereum?: unknown
  }
}

const emptyAddress = '0x0000000000000000000000000000000000000000'

const isPostMetadata = (value: IpfsMetadataRecord | null): value is PostMetadata => {
  return Boolean(value && 'title' in value && 'body' in value)
}

const isCommunityMetadata = (value: IpfsMetadataRecord | null): value is CommunityMetadata => {
  return Boolean(value && 'description' in value)
}

// Reddit-style "hot" ranking: vote magnitude on a log scale plus time decay,
// so newer posts and higher-scored posts float up together.
const hotScore = (score: number, createdAtSeconds: number, isMemberCommunity: boolean) => {
  const magnitude = Math.log10(Math.max(Math.abs(score), 1))
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0
  const membershipBoost = isMemberCommunity ? 0.4 : 0
  return sign * magnitude + createdAtSeconds / 45000 + membershipBoost
}

function App() {
  const [lang, setLang] = useState<Language>(loadLanguage)
  const t = useMemo(() => makeTranslator(lang), [lang])

  // Turns an ethers error into a human-readable reason: user rejection,
  // a decoded custom error from the contract (mapped through i18n), or the
  // provider's short message as a last resort.
  const describeTxError = (error: unknown): string => {
    const err = error as {
      code?: string
      data?: unknown
      reason?: string
      shortMessage?: string
      revert?: { name?: string }
      info?: { error?: { data?: unknown } }
    }

    if (err?.code === 'ACTION_REJECTED') return t('err_userRejected')

    let name = err?.revert?.name || ''
    const data = typeof err?.data === 'string' ? err.data : (err?.info?.error?.data as string | undefined)
    if (!name && data && data !== '0x') {
      try {
        name = new ethers.Interface(contractArtifact.abi).parseError(data)?.name || ''
      } catch {
        // Unknown selector - fall through to the generic message.
      }
    }
    if (!name && err?.reason && err.reason !== 'require(false)') name = err.reason

    if (name) {
      const key = `err_${name}` as TranslationKey
      const label = t(key)
      return label === key ? name : label
    }

    // No decodable revert reason at all. This contract always reverts with
    // custom errors (which carry data), so a data-less CALL_EXCEPTION means
    // the deployed contract doesn't have the function we called. Providers
    // surface this differently: data undefined/"0x", hardhat's
    // "require(false)" reason, or MetaMask's "missing revert data" message.
    if (err?.code === 'CALL_EXCEPTION') return t('err_missingFunction')

    return err?.shortMessage || err?.reason || String(error)
  }

  // Standard failure alert: what failed + why.
  const failWith = (key: TranslationKey, error: unknown) => {
    alert(`${t(key)}\n${describeTxError(error)}`)
  }

  const [walletAddress, setWalletAddress] = useState('')
  const [contractAddress, setContractAddress] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [modNotification, setModNotification] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [view, setView] = useState<View>('home')
  const knownModeratorCommunities = useRef(new Set<string>())

  const [username, setUsername] = useState('')
  const [showUsernameModal, setShowUsernameModal] = useState(false)
  const [showChangeUsernameModal, setShowChangeUsernameModal] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [usernamesCache, setUsernamesCache] = useState<Record<string, string>>({})
  const requestedUsernameAddresses = useRef(new Set<string>())

  const [ipfsCache, setIpfsCache] = useState<Record<string, IpfsMetadataRecord>>({})
  const requestedCids = useRef(new Set<string>())

  const [communities, setCommunities] = useState<Community[]>([])
  const [selectedCommunityId, setSelectedCommunityId] = useState('')
  const [newCommunityName, setNewCommunityName] = useState('')
  const [newCommunityDesc, setNewCommunityDesc] = useState('')
  const [showCreateCommunityModal, setShowCreateCommunityModal] = useState(false)

  const [newSubCommunityName, setNewSubCommunityName] = useState('')
  const [newSubCommunityDesc, setNewSubCommunityDesc] = useState('')
  const [showCreateSubCommunityModal, setShowCreateSubCommunityModal] = useState(false)

  const [posts, setPosts] = useState<Post[]>([])
  const [showCreatePost, setShowCreatePost] = useState(false)
  const [postTitle, setPostTitle] = useState('')
  const [postBody, setPostBody] = useState('')
  const [postTags, setPostTags] = useState('')
  const [postImages, setPostImages] = useState<File[]>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [selectedPostId, setSelectedPostId] = useState('')

  const [votesByPost, setVotesByPost] = useState<Record<string, VoteInfo>>({})
  const [trendingPosts, setTrendingPosts] = useState<TrendingPost[]>([])
  const [trendingSource, setTrendingSource] = useState<'graph' | 'chain'>('chain')

  const [comments, setComments] = useState<SignedComment[]>([])
  const [newCommentByPost, setNewCommentByPost] = useState<Record<string, string>>({})
  const [commentImageByPost, setCommentImageByPost] = useState<Record<string, File | undefined>>({})
  const [onChainComments, setOnChainComments] = useState<OnChainComment[]>([])
  const [pendingComments, setPendingComments] = useState<OnChainComment[]>([])

  const [reviewPrompt, setReviewPrompt] = useState<ReviewPrompt | null>(null)

  const [moderators, setModerators] = useState<ModeratorDisplay[]>([])
  const [topActiveUsers, setTopActiveUsers] = useState<string[]>([])
  const [recommendInput, setRecommendInput] = useState('')
  const [removeTargetInput, setRemoveTargetInput] = useState('')
  const [removeReasonInput, setRemoveReasonInput] = useState('')
  const [banTargetInput, setBanTargetInput] = useState('')
  const [banReasonInput, setBanReasonInput] = useState('')
  const [bannedUsers, setBannedUsers] = useState<GraphBannedUser[]>([])
  const [showModeratorActionsModal, setShowModeratorActionsModal] = useState(false)
  const [removalVotes, setRemovalVotes] = useState<RemovalVote[]>([])

  const [profileAddress, setProfileAddress] = useState('')
  const [profileData, setProfileData] = useState<GraphUser | null>(null)
  const [profileActivities, setProfileActivities] = useState<GraphActivity[]>([])
  const [profileGraphOffline, setProfileGraphOffline] = useState(false)

  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([])
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false)
  // Which kebab (three-dot moderator menu) is open: `post-<id>` or `comment-<id>`.
  const [openKebabId, setOpenKebabId] = useState<string | null>(null)
  // Content reports for the current community (shown to its moderators).
  const [reports, setReports] = useState<GraphReportThread[]>([])
  // Open report dialog target: { kind: 0 post | 1 comment, id }.
  const [reportTarget, setReportTarget] = useState<{ kind: 0 | 1; id: string } | null>(null)
  const [reportReason, setReportReason] = useState('')
  // Posts this user chose to hide from their own feed (personal, client-side).
  const [hiddenForMe, setHiddenForMe] = useState<string[]>([])
  const [showHiddenForMe, setShowHiddenForMe] = useState(false)
  // Feed pagination.
  const [postsPerPage, setPostsPerPage] = useState(10)
  const [feedPage, setFeedPage] = useState(1)

  // Deployment fingerprint (genesis block hash) that scopes localStorage keys,
  // so off-chain comments and read-notification marks from an older chain
  // deployment never leak into a fresh one.
  const [storageScope, setStorageScope] = useState('')

  const [searchFilter, setSearchFilter] = useState<SearchFilter>('all')
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [activeSearchTerm, setActiveSearchTerm] = useState('')

  const selectedCommunity = communities.find((community) => community.id === selectedCommunityId)

  const communitiesByParent = useMemo(() => {
    const grouped = communities.reduce<Record<string, Community[]>>((acc, community) => {
      const parentId = community.parentCommunityId || '0'
      acc[parentId] = acc[parentId] || []
      acc[parentId].push(community)
      return acc
    }, {})
    // Alphabetical by name so the home community list has a stable, scannable order.
    for (const parentId of Object.keys(grouped)) {
      grouped[parentId].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    }
    return grouped
  }, [communities])

  const rootCommunities = communitiesByParent['0'] || []

  const myAddress = walletAddress.toLowerCase()

  // Posts visible in this community by moderation/authorship rules, before the
  // personal "hide for me" filter.
  const moderationVisiblePosts = useMemo(() => {
    return posts.filter((post) => {
      if (selectedCommunity?.isModerator) return true
      if (post.author.toLowerCase() === myAddress) return true
      return !post.hidden && !post.pending && !post.rejected
    })
  }, [posts, selectedCommunity?.isModerator, myAddress])

  const hiddenForMeCount = useMemo(
    () => moderationVisiblePosts.filter((post) => hiddenForMe.includes(post.id)).length,
    [moderationVisiblePosts, hiddenForMe],
  )

  // Personal hide-for-me applied on top (unless the user is peeking at hidden ones).
  const visiblePosts = useMemo(() => {
    if (showHiddenForMe) return moderationVisiblePosts
    return moderationVisiblePosts.filter((post) => !hiddenForMe.includes(post.id))
  }, [moderationVisiblePosts, hiddenForMe, showHiddenForMe])

  const pageCount = Math.max(1, Math.ceil(visiblePosts.length / postsPerPage))
  const pagedPosts = useMemo(() => {
    const start = (feedPage - 1) * postsPerPage
    return visiblePosts.slice(start, start + postsPerPage)
  }, [visiblePosts, feedPage, postsPerPage])

  // Keep the current page in range when the list shrinks or the page size changes.
  useEffect(() => {
    if (feedPage > pageCount) setFeedPage(pageCount)
  }, [feedPage, pageCount])

  // Reset to the first page when switching communities or resizing the page.
  useEffect(() => {
    setFeedPage(1)
  }, [selectedCommunityId, postsPerPage])

  const pendingPosts = useMemo(() => posts.filter((post) => post.pending), [posts])

  // Strictly explicit selection: clicking a post expands it, clicking again
  // collapses it (no implicit fallback to the first post).
  const selectedPost = visiblePosts.find((post) => post.id === selectedPostId)

  const rankedTrending = useMemo(() => {
    const memberCommunityIds = new Set(communities.filter((c) => c.isMember).map((c) => c.id))
    return [...trendingPosts].sort(
      (a, b) =>
        hotScore(b.score, b.createdAt, memberCommunityIds.has(b.communityId)) -
        hotScore(a.score, a.createdAt, memberCommunityIds.has(a.communityId))
    )
  }, [trendingPosts, communities])

  const unreadNotificationsCount = useMemo(() => {
    const read = new Set(readNotificationIds)
    return notifications.filter((notification) => !read.has(notification.id)).length
  }, [notifications, readNotificationIds])

  const moderatorOffers = useMemo(() => communities.filter((community) => community.hasModeratorOffer), [communities])

  const pendingRemovalVotes = useMemo(() => removalVotes.filter((vote) => !vote.approvedByMe), [removalVotes])

  // The bell badge counts unread notifications plus items waiting for my action.
  const bellCount = unreadNotificationsCount + moderatorOffers.length + pendingRemovalVotes.length

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

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
  }, [lang])

  // Switching networks in MetaMask changes the contract/graph target; a full
  // reload is the simplest way to re-resolve cleanly.
  useEffect(() => {
    const ethereum = window.ethereum as { on?: (e: string, cb: () => void) => void; removeListener?: (e: string, cb: () => void) => void } | undefined
    if (!ethereum?.on) return

    const onChainChanged = () => window.location.reload()
    ethereum.on('chainChanged', onChainChanged)
    return () => ethereum.removeListener?.('chainChanged', onChainChanged)
  }, [])

  useEffect(() => {
    if (walletAddress) {
      loadCommunities(walletAddress, true)
      loadUsername(walletAddress)
    }
  }, [walletAddress])

  useEffect(() => {
    if (walletAddress && storageScope) {
      loadNotifications(walletAddress)
    }
  }, [walletAddress, storageScope])

  // Clicking anywhere outside a kebab menu closes it.
  useEffect(() => {
    if (!openKebabId) return
    const close = () => setOpenKebabId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openKebabId])

  // Without polling, votes/comments made by others while the tab is open never
  // reach the bell — the author had to reload to see them.
  useEffect(() => {
    if (!walletAddress || !storageScope) return
    const interval = setInterval(() => loadNotifications(walletAddress), 30_000)
    return () => clearInterval(interval)
  }, [walletAddress, storageScope])

  useEffect(() => {
    const addresses = new Set<string>()
    communities.forEach((community) => addresses.add(community.creator))
    posts.forEach((post) => addresses.add(post.author))
    moderators.forEach((moderator) => addresses.add(moderator.address))
    topActiveUsers.forEach((address) => addresses.add(address))
    comments.forEach((comment) => addresses.add(comment.author))
    trendingPosts.forEach((post) => addresses.add(post.author))
    onChainComments.forEach((comment) => addresses.add(comment.author))
    pendingComments.forEach((comment) => addresses.add(comment.author))
    addresses.forEach(fetchUsername)
  }, [communities, posts, moderators, topActiveUsers, comments, trendingPosts, onChainComments, pendingComments])

  useEffect(() => {
    if (!walletAddress || !contractAddress || !window.ethereum) return

    let cancelled = false
    const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider)
    const contract = new ethers.Contract(contractAddress, contractArtifact.abi, provider)

    const flashModNotification = (message: string) => {
      setModNotification(message)
      setTimeout(() => {
        if (!cancelled) setModNotification('')
      }, 8000)
    }

    const announceNewModerator = async (communityId: string) => {
      if (knownModeratorCommunities.current.has(communityId)) return
      knownModeratorCommunities.current.add(communityId)

      const name = await getCommunityName(communityId)
      if (cancelled) return

      flashModNotification(t('becameModerator', { name }))
      loadCommunities(walletAddress)
      loadNotifications(walletAddress)
    }

    const announceModeratorRemoved = async (communityId: string) => {
      if (!knownModeratorCommunities.current.has(communityId)) return
      knownModeratorCommunities.current.delete(communityId)

      const name = await getCommunityName(communityId)
      if (cancelled) return

      flashModNotification(t('noLongerModerator', { name }))
      loadCommunities(walletAddress)
      loadNotifications(walletAddress)
    }

    const onModeratorAdded = (communityId: bigint, moderator: string) => {
      if (moderator.toLowerCase() === walletAddress.toLowerCase()) {
        announceNewModerator(communityId.toString())
      }
    }

    const onModeratorRemoved = (communityId: bigint, moderator: string) => {
      if (moderator.toLowerCase() === walletAddress.toLowerCase()) {
        announceModeratorRemoved(communityId.toString())
      }
    }

    const onActiveModeratorsUpdated = async (communityId: bigint, first: string, second: string) => {
      const address = walletAddress.toLowerCase()

      if (first.toLowerCase() === address || second.toLowerCase() === address) {
        announceNewModerator(communityId.toString())
        return
      }

      // I may have just been displaced from the automatic active pair; only
      // announce if I hold no other moderator role in that community.
      if (knownModeratorCommunities.current.has(communityId.toString())) {
        try {
          const stillModerator = await contract.isUserModeratorOfCommunity(communityId, walletAddress)
          if (!stillModerator) announceModeratorRemoved(communityId.toString())
        } catch (error) {
          console.error('Failed to re-check moderator status:', error)
        }
      }
    }

    const onModeratorOfferCreated = async (communityId: bigint, candidate: string) => {
      if (candidate.toLowerCase() !== walletAddress.toLowerCase()) return

      const name = await getCommunityName(communityId.toString())
      if (cancelled) return

      flashModNotification(t('moderatorOfferToast', { name }))
      loadCommunities(walletAddress)
      loadNotifications(walletAddress)
    }

    const onRemovalProposalCreated = async (
      _proposalId: bigint,
      communityId: bigint,
      _target: string,
      proposer: string
    ) => {
      if (proposer.toLowerCase() === walletAddress.toLowerCase()) return
      if (!knownModeratorCommunities.current.has(communityId.toString())) return

      const name = await getCommunityName(communityId.toString())
      if (cancelled) return

      flashModNotification(t('removalVoteToast', { name }))
      loadCommunities(walletAddress)
      loadNotifications(walletAddress)
    }

    contract.on('ModeratorAdded', onModeratorAdded)
    contract.on('ModeratorRemoved', onModeratorRemoved)
    contract.on('ActiveModeratorsUpdated', onActiveModeratorsUpdated)
    contract.on('ModeratorOfferCreated', onModeratorOfferCreated)
    contract.on('RemoveModeratorProposalCreated', onRemovalProposalCreated)

    return () => {
      cancelled = true
      contract.off('ModeratorAdded', onModeratorAdded)
      contract.off('ModeratorRemoved', onModeratorRemoved)
      contract.off('ActiveModeratorsUpdated', onActiveModeratorsUpdated)
      contract.off('ModeratorOfferCreated', onModeratorOfferCreated)
      contract.off('RemoveModeratorProposalCreated', onRemovalProposalCreated)
    }
  }, [walletAddress, contractAddress, lang])

  useEffect(() => {
    const name = usernameInput.trim()

    if (!name) {
      setUsernameAvailable(null)
      return
    }

    let cancelled = false
    const timeoutId = setTimeout(() => {
      getContract(false)
        .then((contract) => contract.isUsernameAvailable(name))
        .then((available: boolean) => {
          if (!cancelled) setUsernameAvailable(available)
        })
        .catch(() => {
          if (!cancelled) setUsernameAvailable(null)
        })
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [usernameInput])

  useEffect(() => {
    if (selectedCommunityId) {
      loadPosts(selectedCommunityId)
      loadModeratorInfo(selectedCommunityId)
      setSelectedPostId('')
    } else {
      setPosts([])
      setModerators([])
      setTopActiveUsers([])
      setOnChainComments([])
      setPendingComments([])
    }
  }, [selectedCommunityId])

  useEffect(() => {
    if (view === 'home' && walletAddress) {
      loadTrending()
    }
  }, [view, walletAddress])

  useEffect(() => {
    if (view === 'profile' && profileAddress) {
      loadProfileData(profileAddress)
    }
  }, [view, profileAddress])

  useEffect(() => {
    communities.forEach((community) => fetchIpfsMetadata(community.metadataCID))
  }, [communities])

  useEffect(() => {
    posts.forEach((post) => fetchIpfsMetadata(post.contentCID))
  }, [posts])

  useEffect(() => {
    trendingPosts.forEach((post) => fetchIpfsMetadata(post.contentCID))
  }, [trendingPosts])

  const getProvider = () => {
    if (!window.ethereum) {
      throw new Error('MetaMask is not installed')
    }

    return new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider)
  }

  const getCurrentWalletAddress = async () => {
    const provider = getProvider()
    const accounts = await provider.send('eth_accounts', [])

    if (!accounts || accounts.length === 0) {
      return ''
    }

    return accounts[0]
  }

  const getLiveMembershipStatus = async (communityId: string) => {
    const account = await getCurrentWalletAddress()

    if (!account) {
      return { account: '', isMember: false, isBanned: false }
    }

    const contract = await getContract(false)
    const [isMember, isBanned] = await Promise.all([
      contract.isUserMemberOfCommunity(communityId, account),
      contract.isUserBannedFromCommunity(communityId, account),
    ])

    return { account, isMember, isBanned }
  }

  const getContract = async (withSigner = false) => {
    const provider = getProvider()
    const address = contractAddress || (await resolveContractAddress())

    if (withSigner) {
      const signer = await provider.getSigner()
      return new ethers.Contract(address, contractArtifact.abi, signer)
    }

    return new ethers.Contract(address, contractArtifact.abi, provider)
  }

  // Resolves the contract address for the network MetaMask is currently on, and
  // points the Graph client at the matching endpoint.
  const resolveContractAddress = async () => {
    const provider = getProvider()
    const network = await provider.getNetwork()
    const chainId = Number(network.chainId)
    setGraphEndpoint(chainId)

    const address = contractAddressForChain(chainId)
    if (!address) {
      const name = NETWORK_NAMES[chainId] || `chain ${chainId}`
      setTemporaryStatus(t('unsupportedNetwork', { network: name }))
      throw new Error(`Unsupported network: ${chainId}`)
    }

    setContractAddress(address)
    return address
  }

  const setTemporaryStatus = (message: string) => {
    setStatusMessage(message)
  }

  // Publishes metadata to IPFS and seeds the cache immediately so the UI doesn't wait on a gateway round-trip for content we already have locally.
  const publishToIpfs = async (metadata: IpfsMetadataRecord) => {
    const cid = await addJson(metadata)
    requestedCids.current.add(cid)
    setIpfsCache((prev) => ({ ...prev, [cid]: metadata }))
    return cid
  }

  // Fetches metadata for a CID via the IPFS gateway and stores it in the cache. Safe to call repeatedly; in-flight/cached CIDs are skipped.
  const fetchIpfsMetadata = (cid: string) => {
    if (!cid || requestedCids.current.has(cid)) return

    requestedCids.current.add(cid)

    getJson<IpfsMetadataRecord>(cid)
      .then((metadata) => setIpfsCache((prev) => ({ ...prev, [cid]: metadata })))
      .catch((error) => {
        console.error('Failed to load content from IPFS:', error)
        requestedCids.current.delete(cid)
      })
  }

  // Fetches the registered username (if any) for an address and stores it in the cache. Safe to call repeatedly.
  const fetchUsername = (address: string) => {
    if (!address || requestedUsernameAddresses.current.has(address)) return

    requestedUsernameAddresses.current.add(address)

    getContract(false)
      .then((contract) => contract.getUsername(address))
      .then((name: string) => {
        if (name) setUsernamesCache((prev) => ({ ...prev, [address]: name }))
      })
      .catch((error) => {
        console.error('Failed to load username:', error)
        requestedUsernameAddresses.current.delete(address)
      })
  }

  const loadUsername = async (account: string) => {
    try {
      const contract = await getContract(false)
      const name = await contract.getUsername(account)
      setUsername(name)
      setShowUsernameModal(!name)
    } catch (error) {
      console.error('Failed to load my username:', error)
    }
  }

  const getCommunityDescription = (community: Community) => {
    const metadata = ipfsCache[community.metadataCID]
    if (isCommunityMetadata(metadata)) return metadata.description
    return '...'
  }

  const getCommunityName = async (communityId: string) => {
    const cached = communities.find((community) => community.id === communityId)
    if (cached) return cached.name

    const contract = await getContract(false)

    try {
      const community = await contract.getCommunityV2(communityId)
      return community[1] as string
    } catch {
      const community = await contract.getCommunity(communityId)
      return community[1] as string
    }
  }

  const getPostMetadata = (post: { id: string; contentCID: string }): PostMetadata => {
    const metadata = ipfsCache[post.contentCID]

    if (isPostMetadata(metadata)) {
      return metadata
    }

    return {
      title: `Post #${post.id}`,
      body: '...',
      tags: [],
    }
  }

  const connectWallet = async () => {
    try {
      const provider = getProvider()
      const accounts = await provider.send('eth_requestAccounts', [])
      await resolveContractAddress()
      setWalletAddress(accounts[0])
      await loadCommunities(accounts[0], true)
      setTemporaryStatus(t('walletConnected'))
    } catch (error) {
      console.error('Wallet connection failed:', error)
      if (String(error).includes('Unsupported network')) return
      alert(t('connectFailed'))
    }
  }

  // Revokes the site's MetaMask permission so it no longer auto-connects,
  // then reloads to clear all in-memory state.
  const disconnectWallet = async () => {
    try {
      const ethereum = window.ethereum as
        | { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
        | undefined
      await ethereum?.request?.({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      })
    } catch {
      // Older wallets don't support revoke; the reload still drops the session.
    }
    window.location.reload()
  }

  const submitUsername = async () => {
    const name = usernameInput.trim()
    const policyError = validateUsername(name)

    if (policyError) {
      alert(t(`username_${policyError}` as TranslationKey))
      return
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.registerUsername(name)
      setTemporaryStatus(t('registering'))
      await tx.wait()

      setUsername(name)
      setUsernamesCache((prev) => ({ ...prev, [walletAddress]: name }))
      setShowUsernameModal(false)
      setUsernameInput('')
      setTemporaryStatus(t('registered', { name }))
    } catch (error) {
      console.error('Username registration failed:', error)
      failWith('registerFailed', error)
    }
  }

  const submitUsernameChange = async () => {
    const name = usernameInput.trim()
    const policyError = validateUsername(name)

    if (policyError) {
      alert(t(`username_${policyError}` as TranslationKey))
      return
    }

    try {
      const contract = await getContract(true)
      const fee = await contract.USERNAME_CHANGE_FEE()
      const tx = await contract.changeUsername(name, { value: fee })
      setTemporaryStatus(t('changing'))
      await tx.wait()

      const oldName = username
      setUsername(name)
      setUsernamesCache((prev) => ({ ...prev, [walletAddress]: name }))
      setShowChangeUsernameModal(false)
      setUsernameInput('')
      setTemporaryStatus(t('changed', { old: oldName, new: name }))
      if (view === 'profile') loadProfileData(profileAddress)
    } catch (error) {
      console.error('Username change failed:', error)
      failWith('changeFailed', error)
    }
  }

  const loadCommunities = async (account = walletAddress, seedKnownModerators = false) => {
    try {
      const contract = await getContract(false)
      const ids = await contract.getAllCommunityIds()
      // Load every community in parallel, and within each fire the per-account
      // reads together, so a forum with many communities isn't gated on a long
      // chain of sequential round-trips (the dominant read latency on Sepolia).
      const loadedCommunities: Community[] = await Promise.all(
        ids.map(async (id: bigint): Promise<Community> => {
          let community
          let parentCommunityId = '0'

          try {
            community = await contract.getCommunityV2(id)
            parentCommunityId = community[7].toString()
          } catch {
            community = await contract.getCommunity(id)
          }

          const communityId = community[0].toString()

          let isMember = false
          let isModerator = false
          let isBanned = false
          let hasModeratorOffer = false
          let moderatorRole: ModeratorRole | undefined

          if (account) {
            const [memberRes, modRes, banRes, offerRes, roleRes] = await Promise.all([
              contract.isUserMemberOfCommunity(communityId, account),
              contract.isUserModeratorOfCommunity(communityId, account),
              contract.isUserBannedFromCommunity(communityId, account),
              contract.hasPendingModeratorOffer(communityId, account).catch(() => false),
              contract.getModeratorRole(communityId, account).catch(() => null),
            ])
            isMember = memberRes
            isModerator = modRes
            isBanned = banRes
            hasModeratorOffer = offerRes
            moderatorRole = roleRes
              ? {
                  isModerator: roleRes[0],
                  isCreatorModerator: roleRes[1],
                  isActiveBasedModerator: roleRes[2],
                  isAppointedModerator: roleRes[3],
                }
              : { isModerator, isCreatorModerator: false, isActiveBasedModerator: false, isAppointedModerator: false }
          }

          return {
            id: communityId,
            name: community[1],
            creator: community[2],
            metadataCID: community[3],
            membersCount: community[5].toString(),
            isMember,
            isModerator,
            isBanned,
            parentCommunityId,
            moderatorRole,
            hasModeratorOffer,
          }
        }),
      )

      setCommunities(loadedCommunities)

      if (account && seedKnownModerators) {
        loadedCommunities.forEach((community) => {
          if (community.isModerator) {
            knownModeratorCommunities.current.add(community.id)
          }
        })
      }

      loadRemovalVotes(loadedCommunities, account)
    } catch (error) {
      console.error('Failed to load communities:', error)
      setTemporaryStatus(t('loadCommunitiesFailed'))
    }
  }

  // Open (not yet executed) moderator-removal votes in communities I moderate,
  // shown in the notifications panel so every moderator can weigh in.
  const loadRemovalVotes = async (communityList: Community[], account: string) => {
    if (!account) {
      setRemovalVotes([])
      return
    }

    try {
      const contract = await getContract(false)
      const votes: RemovalVote[] = []

      for (const community of communityList) {
        if (!community.isModerator) continue

        const proposalIds = await contract.getRemovalProposalsByCommunity(community.id)
        if (proposalIds.length === 0) continue

        for (const proposalId of proposalIds) {
          const proposal = await contract.getRemoveModeratorProposal(proposalId)
          if (proposal[5]) continue // already executed

          const deadline = Number(proposal[9])
          // Hide proposals that have expired (still valid on-chain but dead).
          if (deadline * 1000 < Date.now()) continue

          const approvedByMe = await contract.hasApprovedRemoveModeratorProposal(proposalId, account)

          votes.push({
            proposalId: proposal[0].toString(),
            communityId: proposal[1].toString(),
            communityName: community.name,
            target: proposal[2],
            approvals: Number(proposal[4]),
            // Snapshotted threshold from the proposal itself, not recomputed.
            required: Number(proposal[8]),
            approvedByMe,
            reason: proposal[7],
            deadline,
          })
        }
      }

      setRemovalVotes(votes)
    } catch (error) {
      console.error('Failed to load removal votes:', error)
      setRemovalVotes([])
    }
  }

  const loadVotesFor = async (postIds: string[], account = walletAddress) => {
    try {
      const contract = await getContract(false)

      // Fetch every post's score/vote concurrently instead of one-at-a-time.
      const results = await Promise.all(
        postIds.map(async (postId) => {
          const [score, myVote] = await Promise.all([
            contract.postScore(postId),
            account ? contract.postVotes(postId, account) : Promise.resolve(0),
          ])
          return [postId, { score: Number(score), myVote: Number(myVote) }] as const
        }),
      )

      const entries: Record<string, VoteInfo> = {}
      for (const [postId, info] of results) entries[postId] = info
      setVotesByPost((prev) => ({ ...prev, ...entries }))
    } catch (error) {
      console.error('Failed to load votes:', error)
    }
  }

  const loadPosts = async (communityId: string) => {
    try {
      const contract = await getContract(false)
      const postIds = await contract.getPostsByCommunity(communityId)

      // Load every post and its status flags in parallel. Previously each post
      // waited for the one before it, so N posts meant N serial round-trips;
      // now it's a single concurrent batch.
      const loadedPosts: Post[] = await Promise.all(
        postIds.map(async (id: bigint): Promise<Post> => {
          const [post, pending, rejected, locked] = await Promise.all([
            contract.getPost(id),
            contract.postPendingReview(id),
            contract.postRejected(id),
            // Older deployments predate postLocked; treat a failed call as unlocked.
            contract.postLocked(id).catch(() => false),
          ])

          return {
            id: post[0].toString(),
            communityId: post[1].toString(),
            author: post[2],
            contentCID: post[3],
            createdAt: post[4].toString(),
            hidden: post[6],
            locked: Boolean(locked),
            pending,
            rejected,
          }
        }),
      )

      setPosts(loadedPosts.reverse())
      loadVotesFor(loadedPosts.map((post) => post.id))
      loadOnChainComments(communityId, loadedPosts)
      loadReports(communityId)
    } catch (error) {
      console.error('Failed to load posts:', error)
      setPosts([])
    }
  }

  const loadReports = async (communityId: string) => {
    const graphReports = await fetchReports(communityId)
    setReports(graphReports || [])
  }

  // Anyone can report a post/comment; it goes on-chain so every moderator sees it.
  const submitReport = async () => {
    if (!reportTarget) return
    const target = reportTarget
    const reason = reportReason.trim() || 'No reason given'
    setReportTarget(null)
    setReportReason('')

    try {
      const contract = await getContract(true)
      const tx =
        target.kind === 0
          ? await contract.reportPost(target.id.replace(/^[cp]-/, ''), reason)
          : await contract.reportComment(target.id.replace(/^[cp]-/, ''), reason)

      setTemporaryStatus(t('txSent'))
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadReports(selectedCommunityId)
      setTemporaryStatus(t('reportSent'))
    } catch (error) {
      console.error('Report failed:', error)
      failWith('reportFailed', error)
    }
  }

  // Moderator closes out a content's reports: it leaves the open queue. action
  // 1 = action taken (content handled), 0 = dismissed (report unfounded).
  const resolveReport = async (kind: 0 | 1, refId: string, action: 0 | 1) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.resolveReport(kind, refId, action)
      setTemporaryStatus(t('txSent'))
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadReports(selectedCommunityId)
      setTemporaryStatus(action === 1 ? t('reportResolvedToast') : t('reportDismissedToast'))
    } catch (error) {
      console.error('Resolve report failed:', error)
      failWith('reportFailed', error)
    }
  }

  // All on-chain comments for the community: clean ones (addComment) plus
  // approved flagged ones are shown together; pending flagged ones feed the
  // moderator queue. Prefers the graph, falls back to chain reads/logs.
  const loadOnChainComments = async (communityId: string, communityPosts: Post[]) => {
    const [graphClean, graphPending, approvedPerPost] = await Promise.all([
      fetchComments(communityId),
      fetchPendingComments(communityId),
      Promise.all(communityPosts.map((post) => fetchApprovedComments(post.id))),
    ])

    if (graphClean !== null && graphPending !== null) {
      setPendingComments(
        graphPending.map((comment) => ({
          id: comment.id,
          postId: comment.post.id,
          author: comment.author.id,
          content: comment.content,
          imageCid: comment.imageCid,
          createdAt: Number(comment.createdAt),
          status: comment.status,
        }))
      )

      const shown: OnChainComment[] = graphClean.map((comment) => ({
        id: `c-${comment.id}`,
        postId: comment.post.id,
        author: comment.author.id,
        content: comment.content,
        imageCid: comment.imageCid,
        createdAt: Number(comment.createdAt),
        status: 1,
      }))
      approvedPerPost.forEach((batch) => {
        if (batch) {
          batch.forEach((comment) => {
            shown.push({
              id: `p-${comment.id}`,
              postId: comment.post.id,
              author: comment.author.id,
              content: comment.content,
              imageCid: comment.imageCid,
              createdAt: Number(comment.createdAt),
              status: 1,
            })
          })
        }
      })
      shown.sort((a, b) => a.createdAt - b.createdAt)
      setOnChainComments(shown)
      return
    }

    // Chain fallback (no graph): clean comments via event logs, flagged via storage getters.
    try {
      const contract = await getContract(false)
      const provider = getProvider()
      const shown: OnChainComment[] = []
      const pending: OnChainComment[] = []
      const postIds = new Set(communityPosts.map((post) => post.id))

      // Bounded log scan keeps this cheap on public RPCs.
      const latest = await provider.getBlockNumber()
      const fromBlock = Math.max(0, latest - 50000)

      const hiddenCommentIds = new Set<string>()
      try {
        const hiddenEvents = await contract.queryFilter(contract.filters.CommentHidden(), fromBlock, latest)
        for (const event of hiddenEvents) {
          const args = (event as ethers.EventLog).args
          if (args) hiddenCommentIds.add(args[0].toString())
        }
      } catch {
        // Older deployments have no CommentHidden event.
      }

      const events = await contract.queryFilter(contract.filters.CommentCreated(), fromBlock, latest)
      for (const event of events) {
        const args = (event as ethers.EventLog).args
        if (!args) continue
        if (hiddenCommentIds.has(args[0].toString())) continue
        const postId = args[1].toString()
        if (!postIds.has(postId)) continue
        shown.push({
          id: `c-${args[0].toString()}`,
          postId,
          author: args[3],
          content: args[4],
          imageCid: args[5],
          createdAt: Number(args[6]),
          status: 1,
        })
      }

      for (const post of communityPosts) {
        const ids = await contract.getPendingCommentsByPost(post.id)
        for (const id of ids) {
          const c = await contract.getPendingComment(id)
          const item: OnChainComment = {
            id: `p-${c[0].toString()}`,
            postId: c[1].toString(),
            author: c[2],
            content: c[3],
            imageCid: c[4],
            createdAt: Number(c[5]),
            status: Number(c[6]),
          }
          if (item.status === 0) pending.push(item)
          if (item.status === 1 && !hiddenCommentIds.has(c[0].toString())) shown.push(item)
        }
      }

      shown.sort((a, b) => a.createdAt - b.createdAt)
      setPendingComments(pending)
      setOnChainComments(shown)
    } catch (error) {
      console.error('Failed to load on-chain comments:', error)
    }
  }

  // Home feed. Prefers the subgraph (rich data in one query); falls back to
  // direct chain reads when the graph stack is offline.
  const loadTrending = async () => {
    const graphPosts = await fetchRecentPosts(50)

    if (graphPosts) {
      setTrendingSource('graph')
      setTrendingPosts(
        graphPosts.map((post) => ({
          id: post.id,
          communityId: post.community.id,
          communityName: post.community.name,
          author: post.author.id,
          contentCID: post.contentCID,
          createdAt: Number(post.createdAt),
          score: Number(post.score),
          title: post.title,
          tags: post.tags,
        }))
      )
      loadVotesFor(graphPosts.map((post) => post.id))
      return
    }

    setTrendingSource('chain')

    try {
      const contract = await getContract(false)
      const communityIds = await contract.getAllCommunityIds()
      const collected: TrendingPost[] = []

      for (const communityId of communityIds) {
        const community = communities.find((c) => c.id === communityId.toString())
        const name = community ? community.name : (await contract.getCommunity(communityId))[1]
        const postIds = await contract.getPostsByCommunity(communityId)

        for (const postId of postIds) {
          const post = await contract.getPost(postId)
          if (post[6]) continue

          const rejected = await contract.postRejected(postId)
          if (rejected) continue

          const score = await contract.postScore(postId)

          collected.push({
            id: post[0].toString(),
            communityId: communityId.toString(),
            communityName: name,
            author: post[2],
            contentCID: post[3],
            createdAt: Number(post[4]),
            score: Number(score),
            title: '',
            tags: [],
          })
        }
      }

      setTrendingPosts(collected)
      loadVotesFor(collected.map((post) => post.id))
    } catch (error) {
      console.error('Failed to load trending posts:', error)
      setTrendingPosts([])
    }
  }

  const loadModeratorInfo = async (communityId: string) => {
    loadBannedUsers(communityId)
    try {
      const contract = await getContract(false)
      const addresses: string[] = await contract.getModeratorAddresses(communityId)
      const topUsers = await contract.getTopActiveUsers(communityId)

      const loadedModerators: ModeratorDisplay[] = []

      for (const address of addresses) {
        const role = await contract.getModeratorRole(communityId, address)
        const score = await contract.activityScore(communityId, address)

        loadedModerators.push({
          address,
          score: score.toString(),
          role: {
            isModerator: role[0],
            isCreatorModerator: role[1],
            isActiveBasedModerator: role[2],
            isAppointedModerator: role[3],
          },
        })
      }

      setModerators(loadedModerators)
      setTopActiveUsers([topUsers[0], topUsers[1]].filter((address) => address && address !== emptyAddress))
    } catch (error) {
      console.error('Failed to load moderators:', error)
      setModerators([])
      setTopActiveUsers([])
    }
  }

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

  const markAllNotificationsRead = () => {
    const ids = notifications.map((notification) => notification.id)
    const key = scopedStorageKey(READ_NOTIFICATIONS_KEY)
    if (key) localStorage.setItem(key, JSON.stringify(ids))
    setReadNotificationIds(ids)
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

  const hidePostForMe = (postId: string) => {
    if (hiddenForMe.includes(postId)) return
    persistHiddenForMe([...hiddenForMe, postId])
    if (selectedPostId === postId) setSelectedPostId('')
    setTemporaryStatus(t('postHiddenForYou'))
  }

  const unhidePostForMe = (postId: string) => {
    persistHiddenForMe(hiddenForMe.filter((id) => id !== postId))
  }

  // Clicking a single notification marks just that one as read.
  const markNotificationRead = (id: string) => {
    if (readNotificationIds.includes(id)) return
    const ids = [...readNotificationIds, id]
    const key = scopedStorageKey(READ_NOTIFICATIONS_KEY)
    if (key) localStorage.setItem(key, JSON.stringify(ids))
    setReadNotificationIds(ids)
  }

  // Merges on-chain notifications from the subgraph with comment replies found
  // in this browser's localStorage (comments are off-chain, so replies from
  // other machines are not visible here).
  const loadNotifications = async (account: string) => {
    const items: NotificationItem[] = []

    const graphNotifications = await fetchUserNotifications(account, 50)
    if (graphNotifications) {
      for (const notification of graphNotifications) {
        items.push({
          id: notification.id,
          type: notification.type,
          detail: notification.detail || '',
          actorLabel: notification.actor ? notification.actor.username || notification.actor.id : '',
          timestamp: Number(notification.timestamp) * 1000,
        })
      }
    }

    const myPosts = await graphQuery<{ posts: { id: string; title: string }[] }>(
      `query ($author: String!) { posts(where: { author: $author }) { id title } }`,
      { author: account.toLowerCase() }
    )

    if (myPosts) {
      const myPostsById = new Map(myPosts.posts.map((post) => [post.id, post.title]))
      const localComments = readStoredComments()

      for (const comment of localComments) {
        if (myPostsById.has(comment.postId) && comment.author.toLowerCase() !== account.toLowerCase()) {
          items.push({
            id: `comment-${comment.signature.slice(0, 18)}`,
            type: 'COMMENT_REPLY',
            detail: myPostsById.get(comment.postId) || '',
            actorLabel: comment.author,
            timestamp: comment.createdAt,
          })
        }
      }
    }

    items.sort((a, b) => b.timestamp - a.timestamp)
    setNotifications(items)
  }

  const loadProfileData = async (address: string) => {
    const [profile, activities] = await Promise.all([fetchUserProfile(address), fetchUserActivities(address, 30)])

    // activities === null means graphQuery failed (endpoint down); a missing
    // user entity (profile null) with activities [] just means a fresh account.
    setProfileGraphOffline(activities === null)
    setProfileData(profile)
    setProfileActivities(activities || [])

    if (address.toLowerCase() === walletAddress.toLowerCase()) {
      loadNotifications(address)
    }
  }

  const createCommunity = async () => {
    if (!newCommunityName.trim() || !newCommunityDesc.trim()) {
      alert(t('fillNameDesc'))
      return
    }

    if (!isValidCommunityName(newCommunityName.trim())) {
      alert(t('communityNameInvalid'))
      return
    }

    try {
      const description = newCommunityDesc.trim()
      const metadataCID = await publishToIpfs({
        description,
        rules: ['Be respectful', 'Keep posts relevant', 'No spam'],
      })

      const contract = await getContract(true)
      const communityName = newCommunityName.trim()
      const tx = await contract.createCommunity(communityName, metadataCID, description)

      const account = walletAddress
      addOptimisticCommunity(communityName, metadataCID, '0', account)
      setNewCommunityName('')
      setNewCommunityDesc('')
      setShowCreateCommunityModal(false)
      setTemporaryStatus(t('communityConfirming'))

      void reconcileCommunityCreate(tx, account, t('communityCreated', { name: communityName }))
    } catch (error) {
      console.error('Community creation failed:', error)
      failWith('createCommunityFailed', error)
    }
  }

  // Inserts a temporary community into the list so it shows the instant the tx
  // is submitted; its description is already in ipfsCache from publishToIpfs.
  const addOptimisticCommunity = (name: string, metadataCID: string, parentCommunityId: string, account: string) => {
    setCommunities((prev) => [
      ...prev,
      {
        id: `pending-${Date.now()}`,
        name,
        creator: account,
        metadataCID,
        membersCount: '1',
        isMember: true,
        isModerator: true,
        isBanned: false,
        parentCommunityId,
        moderatorRole: { isModerator: true, isCreatorModerator: true, isActiveBasedModerator: false, isAppointedModerator: false },
        hasModeratorOffer: false,
        confirming: true,
      },
    ])
  }

  const reconcileCommunityCreate = async (
    tx: ethers.ContractTransactionResponse,
    account: string,
    successMessage: string,
  ) => {
    try {
      const receipt = await tx.wait()
      if (receipt) await waitForGraphBlock(receipt.blockNumber)
      await loadCommunities(account)
      setTemporaryStatus(successMessage)
    } catch (error) {
      console.error('Community creation reconciliation failed:', error)
      await loadCommunities(account).catch(() => {})
      failWith('createCommunityFailed', error)
    }
  }

  const createSubCommunity = async () => {
    if (!selectedCommunityId || !newSubCommunityName.trim() || !newSubCommunityDesc.trim()) {
      alert(t('fillSubFields'))
      return
    }

    if (!isValidCommunityName(newSubCommunityName.trim())) {
      alert(t('communityNameInvalid'))
      return
    }

    try {
      const description = newSubCommunityDesc.trim()
      const metadataCID = await publishToIpfs({
        description,
        rules: ['Follow parent community rules', 'Keep discussions focused'],
      })

      const contract = await getContract(true)
      const subName = newSubCommunityName.trim()
      const parentId = selectedCommunityId
      const tx = await contract.createSubCommunity(parentId, subName, metadataCID, description)

      const account = walletAddress
      addOptimisticCommunity(subName, metadataCID, parentId, account)
      setNewSubCommunityName('')
      setNewSubCommunityDesc('')
      setShowCreateSubCommunityModal(false)
      setTemporaryStatus(t('communityConfirming'))

      void reconcileCommunityCreate(tx, account, t('subCreated', { name: subName }))
    } catch (error) {
      console.error('Sub-community creation failed:', error)
      failWith('subFailed', error)
    }
  }

  const joinCommunity = async (communityId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.joinCommunity(communityId)

      setTemporaryStatus(t('joinSent'))
      await tx.wait()

      const account = await getCurrentWalletAddress()
      await loadCommunities(account)
      await loadModeratorInfo(communityId)
      setTemporaryStatus(t('joined'))
    } catch (error) {
      console.error('Failed to join community:', error)
      failWith('joinFailed', error)
    }
  }

  // Optimistic placeholders use this id prefix until the chain confirms them.
  const isTempId = (id: string) => id.startsWith('pending-')

  // Runs AFTER a write tx is already in the mempool: waits for confirmation and
  // for the graph to index it, then reloads canonical state - which replaces any
  // optimistic placeholder with the real entity. Kept off the UI thread so the
  // user never stares at a spinner during block time. On failure it reloads too,
  // dropping the placeholder, and surfaces the decoded revert reason.
  const reconcileAfterTx = async (
    tx: ethers.ContractTransactionResponse,
    communityId: string,
    account: string,
    successMessage: string,
    failKey: TranslationKey,
  ) => {
    try {
      const receipt = await tx.wait()
      if (receipt) await waitForGraphBlock(receipt.blockNumber)
      await loadPosts(communityId)
      await loadCommunities(account)
      await loadModeratorInfo(communityId)
      setTemporaryStatus(successMessage)
    } catch (error) {
      console.error('Transaction reconciliation failed:', error)
      await loadPosts(communityId).catch(() => {})
      failWith(failKey, error)
    }
  }

  // Publishes the composed post: uploads any attached media, pins metadata,
  // and sends either the normal or the flagged (review-queue) transaction.
  const submitPost = async (flagged: boolean) => {
    const liveStatus = await getLiveMembershipStatus(selectedCommunityId)

    if (!liveStatus.account) {
      alert(t('connectFirst'))
      return
    }

    if (!liveStatus.isMember) {
      alert(t('joinFirst'))
      return
    }

    if (liveStatus.isBanned) {
      alert(t('bannedHere'))
      return
    }

    try {
      const tags = postTags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)

      let imageCids: string[] = []
      if (postImages.length > 0) {
        setUploadingMedia(true)
        setTemporaryStatus(t('uploadingImages'))
        try {
          imageCids = await Promise.all(postImages.map((file) => addFile(file)))
        } catch (error) {
          console.error('Image upload failed:', error)
          alert(t('imageUploadFailed'))
          return
        } finally {
          setUploadingMedia(false)
        }
      }

      const title = postTitle.trim()
      const contentCID = await publishToIpfs({
        title,
        body: postBody.trim(),
        tags,
        images: imageCids,
      })

      const contract = await getContract(true)
      const tx = flagged
        ? await contract.createFlaggedPost(selectedCommunityId, contentCID, title, tags.join(','))
        : await contract.createPost(selectedCommunityId, contentCID, title, tags.join(','))

      const account = liveStatus.account
      const communityId = selectedCommunityId

      setPostTitle('')
      setPostBody('')
      setPostTags('')
      setPostImages([])
      setShowCreatePost(false)

      if (flagged) {
        // Flagged posts go to the moderator queue, not the feed - just confirm.
        setTemporaryStatus(t('postSubmittedForReview'))
      } else {
        // The tx is in the mempool. Show the post immediately - its content is
        // already in ipfsCache from publishToIpfs, so it renders in full with no
        // gateway round-trip - while it confirms on-chain in the background.
        const tempId = `pending-${Date.now()}`
        setPosts((prev) => [
          {
            id: tempId,
            communityId,
            author: account,
            contentCID,
            createdAt: String(Math.floor(Date.now() / 1000)),
            hidden: false,
            locked: false,
            pending: false,
            rejected: false,
            confirming: true,
          },
          ...prev,
        ])
        setTemporaryStatus(t('postConfirming'))
      }

      void reconcileAfterTx(
        tx,
        communityId,
        account,
        flagged ? t('postSubmittedForReview') : t('postPublished'),
        'postFailed',
      )
    } catch (error) {
      console.error('Post creation failed:', error)
      failWith('postFailed', error)
    }
  }

  const createPost = async () => {
    if (!selectedCommunityId || !postTitle.trim() || !postBody.trim()) {
      alert(t('fillPostFields'))
      return
    }

    const safety = checkContentSafety(`${postTitle} ${postBody} ${postTags}`)

    if (!safety.safe) {
      setReviewPrompt({ kind: 'post', selfHarm: safety.selfHarm })
      return
    }

    await submitPost(false)
  }

  // Optimistic vote: update the UI immediately, then reconcile with the chain.
  const castVote = async (postId: string, direction: 1 | -1) => {
    // Can't vote on a post that hasn't confirmed on-chain yet.
    if (postId.startsWith('pending-')) return

    const current = votesByPost[postId] || { score: 0, myVote: 0 }
    const newVote = current.myVote === direction ? 0 : direction

    setVotesByPost((prev) => ({
      ...prev,
      [postId]: {
        score: current.score - current.myVote + newVote,
        myVote: newVote,
      },
    }))

    try {
      const contract = await getContract(true)
      const tx = await contract.votePost(postId, newVote)
      await tx.wait()
    } catch (error) {
      console.error('Vote failed:', error)
      setVotesByPost((prev) => ({ ...prev, [postId]: current }))
      failWith('voteFailed', error)
    }
  }

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

  // Accepts a username (with or without @) or a full 0x address and resolves
  // it to an address via the contract's username registry.
  const resolveUserInput = async (input: string): Promise<string | null> => {
    const trimmed = input.trim().replace(/^@/, '')

    if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      return trimmed
    }

    try {
      const contract = await getContract(false)
      const address = await contract.getAddressByUsername(trimmed)
      if (address && address !== emptyAddress) return address
    } catch (error) {
      console.error('Username lookup failed:', error)
    }

    return null
  }

  const recommendModerator = async () => {
    if (!selectedCommunityId || !recommendInput.trim()) {
      alert(t('enterAddress'))
      return
    }

    const candidate = await resolveUserInput(recommendInput)
    if (!candidate) {
      alert(t('userNotFound'))
      return
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.recommendModerator(selectedCommunityId, candidate)
      setTemporaryStatus(t('recommendationSending'))
      await tx.wait()
      setRecommendInput('')

      const reader = await getContract(false)
      const status = await reader.getModeratorRecommendationStatus(selectedCommunityId, candidate)
      setTemporaryStatus(
        t('recommendationSent', { count: status[0].toString(), required: status[1].toString() })
      )

      await loadModeratorInfo(selectedCommunityId)
    } catch (error) {
      console.error('Moderator recommendation failed:', error)
      failWith('recommendationFailed', error)
    }
  }

  const acceptModeratorOffer = async (communityId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.acceptModeratorRole(communityId)
      setTemporaryStatus(t('acceptingRole'))
      await tx.wait()
      await loadCommunities()
      if (communityId === selectedCommunityId) await loadModeratorInfo(communityId)
    } catch (error) {
      console.error('Accepting moderator role failed:', error)
      failWith('offerActionFailed', error)
    }
  }

  const declineModeratorOffer = async (communityId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.declineModeratorRole(communityId)
      setTemporaryStatus(t('decliningRole'))
      await tx.wait()
      setTemporaryStatus(t('roleDeclined'))
      await loadCommunities()
    } catch (error) {
      console.error('Declining moderator role failed:', error)
      failWith('offerActionFailed', error)
    }
  }

  const resignFromModeration = async (communityId: string, communityName: string) => {
    if (!window.confirm(t('resignConfirm', { name: communityName }))) return

    try {
      const contract = await getContract(true)
      const tx = await contract.resignModerator(communityId)
      setTemporaryStatus(t('resigning'))
      await tx.wait()
      setShowModeratorActionsModal(false)
      await loadCommunities()
      if (communityId === selectedCommunityId) await loadModeratorInfo(communityId)
    } catch (error) {
      console.error('Resignation failed:', error)
      failWith('resignFailed', error)
    }
  }

  const proposeRemoveModerator = async () => {
    if (!selectedCommunityId || !removeTargetInput.trim()) {
      alert(t('enterRemovalAddress'))
      return
    }

    const reason = removeReasonInput.trim()
    if (!reason) {
      alert(t('reasonRequired'))
      return
    }

    const target = await resolveUserInput(removeTargetInput)
    if (!target) {
      alert(t('userNotFound'))
      return
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.proposeRemoveModerator(selectedCommunityId, target, reason)
      setTemporaryStatus(t('removalSent'))
      await tx.wait()
      setRemoveTargetInput('')
      setRemoveReasonInput('')
      await loadCommunities()
      await loadModeratorInfo(selectedCommunityId)
    } catch (error) {
      console.error('Removal proposal failed:', error)
      failWith('removalFailed', error)
    }
  }

  const approveRemovalVote = async (proposalId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.approveRemoveModeratorProposal(proposalId)
      setTemporaryStatus(t('removalApprovalSent'))
      await tx.wait()
      await loadCommunities()
      if (selectedCommunityId) await loadModeratorInfo(selectedCommunityId)
    } catch (error) {
      console.error('Removal approval failed:', error)
      failWith('removalApprovalFailed', error)
    }
  }

  const loadBannedUsers = async (communityId: string) => {
    const banned = await fetchBannedUsers(communityId)
    setBannedUsers(banned || [])
  }

  // Moderator bans a member with a required reason.
  const banMember = async () => {
    if (!selectedCommunityId || !banTargetInput.trim()) {
      alert(t('enterAddress'))
      return
    }
    const reason = banReasonInput.trim()
    if (!reason) {
      alert(t('reasonRequired'))
      return
    }
    const target = await resolveUserInput(banTargetInput)
    if (!target) {
      alert(t('userNotFound'))
      return
    }
    try {
      const contract = await getContract(true)
      const tx = await contract.banUser(selectedCommunityId, target, reason)
      setTemporaryStatus(t('txSent'))
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      setBanTargetInput('')
      setBanReasonInput('')
      await loadCommunities()
      await loadModeratorInfo(selectedCommunityId)
      await loadBannedUsers(selectedCommunityId)
      setTemporaryStatus(t('bannedToast'))
    } catch (error) {
      console.error('Ban failed:', error)
      failWith('banFailed', error)
    }
  }

  const unbanMember = async (target: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.unbanUser(selectedCommunityId, target)
      setTemporaryStatus(t('txSent'))
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadBannedUsers(selectedCommunityId)
      setTemporaryStatus(t('unbannedToast'))
    } catch (error) {
      console.error('Unban failed:', error)
      failWith('banFailed', error)
    }
  }

  // Members can leave for free, but it forfeits their activity points here.
  const leaveCommunity = async (communityId: string) => {
    if (!window.confirm(t('leaveConfirm'))) return
    try {
      const contract = await getContract(true)
      const tx = await contract.leaveCommunity(communityId)
      setTemporaryStatus(t('txSent'))
      await tx.wait()
      const account = await getCurrentWalletAddress()
      await loadCommunities(account)
      await loadModeratorInfo(communityId)
      setTemporaryStatus(t('leftCommunityToast'))
    } catch (error) {
      console.error('Leave community failed:', error)
      failWith('leaveFailed', error)
    }
  }

  const hidePost = async (postId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.hidePost(postId)

      setTemporaryStatus(t('hideSent'))
      await tx.wait()
      await loadPosts(selectedCommunityId)
      setTemporaryStatus(t('postHiddenToast'))
    } catch (error) {
      console.error('Failed to hide post:', error)
      failWith('hideFailed', error)
    }
  }

  const restorePost = async (postId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.restorePost(postId)

      setTemporaryStatus(t('restoreSent'))
      await tx.wait()
      await loadPosts(selectedCommunityId)
      setTemporaryStatus(t('postRestoredToast'))
    } catch (error) {
      console.error('Failed to restore post:', error)
      failWith('restoreFailed', error)
    }
  }

  // Lock keeps the post visible but blocks new comments; unlock reopens it.
  const setPostLock = async (postId: string, lock: boolean) => {
    try {
      const contract = await getContract(true)
      const tx = lock ? await contract.lockPost(postId) : await contract.unlockPost(postId)

      setTemporaryStatus(t('txSent'))
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadPosts(selectedCommunityId)
      setTemporaryStatus(t(lock ? 'postLockedToast' : 'postUnlockedToast'))
    } catch (error) {
      console.error('Failed to change post lock:', error)
      failWith('lockFailed', error)
    }
  }

  // Hides an on-chain comment. Ids are global now, so both clean (c-) and
  // approved-formerly-flagged (p-) comments share one hide path.
  const hideChainComment = async (commentId: string) => {
    const numericId = commentId.replace(/^[cp]-/, '')
    try {
      const contract = await getContract(true)
      const tx = await contract.hideComment(numericId)

      setTemporaryStatus(t('txSent'))
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadPosts(selectedCommunityId)
      setTemporaryStatus(t('commentHiddenToast'))
    } catch (error) {
      console.error('Failed to hide comment:', error)
      failWith('hideFailed', error)
    }
  }

  const decidePendingPost = async (postId: string, approved: boolean) => {
    try {
      const contract = await getContract(true)
      setTemporaryStatus(t('approvingItem'))
      const tx = approved ? await contract.approvePendingPost(postId) : await contract.rejectPendingPost(postId)
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadPosts(selectedCommunityId)
      setTemporaryStatus(approved ? t('postApprovedToast') : t('postRejectedToast'))
    } catch (error) {
      console.error('Moderation decision failed:', error)
      failWith('decisionFailed', error)
    }
  }

  const decidePendingComment = async (commentId: string, approved: boolean) => {
    try {
      const contract = await getContract(true)
      setTemporaryStatus(t('approvingItem'))
      const tx = approved
        ? await contract.approvePendingComment(commentId)
        : await contract.rejectPendingComment(commentId)
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadPosts(selectedCommunityId)
      setTemporaryStatus(approved ? t('commentApprovedToast') : t('commentRejectedToast'))
    } catch (error) {
      console.error('Moderation decision failed:', error)
      failWith('decisionFailed', error)
    }
  }

  // Sends a flagged comment on-chain into the moderator review queue.
  const submitFlaggedComment = async (postId: string) => {
    const content = (newCommentByPost[postId] || '').trim()

    let imageCid = ''
    const image = commentImageByPost[postId]
    if (image) {
      setTemporaryStatus(t('uploadingImages'))
      try {
        imageCid = await addFile(image)
      } catch (error) {
        console.error('Comment image upload failed:', error)
        alert(t('imageUploadFailed'))
        return
      }
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.submitFlaggedComment(postId, content, imageCid)
      const receipt = await tx.wait()

      setNewCommentByPost((previous) => ({ ...previous, [postId]: '' }))
      setCommentImageByPost((previous) => ({ ...previous, [postId]: undefined }))
      await waitForGraphBlock(receipt.blockNumber)
      await loadPosts(selectedCommunityId)
      setTemporaryStatus(t('commentSubmittedForReview'))
    } catch (error) {
      console.error('Flagged comment submission failed:', error)
      failWith('commentSubmitFailed', error)
    }
  }

  // Clean comments go straight on-chain (addComment) so every site instance
  // sees them; unsafe ones are routed into the moderator queue instead.
  const submitComment = async (postId: string) => {
    const content = (newCommentByPost[postId] || '').trim()

    if (!content) {
      alert(t('writeCommentFirst'))
      return
    }

    const liveStatus = await getLiveMembershipStatus(selectedCommunityId)

    if (!liveStatus.account) {
      alert(t('connectToComment'))
      return
    }

    if (!liveStatus.isMember) {
      alert(t('joinToComment'))
      return
    }

    if (liveStatus.isBanned) {
      alert(t('bannedComment'))
      return
    }

    const safety = checkContentSafety(content)
    if (!safety.safe) {
      setReviewPrompt({ kind: 'comment', postId, selfHarm: safety.selfHarm })
      return
    }

    let imageCid = ''
    const image = commentImageByPost[postId]
    if (image) {
      setTemporaryStatus(t('uploadingImages'))
      try {
        imageCid = await addFile(image)
      } catch (error) {
        console.error('Comment image upload failed:', error)
        alert(t('imageUploadFailed'))
        return
      }
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.addComment(postId, content, imageCid)

      const account = liveStatus.account
      const communityId = selectedCommunityId

      // Show the comment the instant the tx is submitted - the content is what
      // the user just typed, so nothing needs to be fetched.
      const tempId = `pending-${Date.now()}`
      setOnChainComments((previous) => [
        ...previous,
        {
          id: tempId,
          postId,
          author: account,
          content,
          imageCid,
          createdAt: Math.floor(Date.now() / 1000),
          status: 1,
          confirming: true,
        },
      ])
      setNewCommentByPost((previous) => ({ ...previous, [postId]: '' }))
      setCommentImageByPost((previous) => ({ ...previous, [postId]: undefined }))
      setTemporaryStatus(t('commentConfirming'))

      void reconcileAfterTx(tx, communityId, account, t('commentPostedOnChain'), 'commentSubmitFailed')
    } catch (error) {
      console.error('On-chain comment failed:', error)
      failWith('commentSubmitFailed', error)
    }
  }

  const confirmReviewSubmission = async () => {
    if (!reviewPrompt) return
    const prompt = reviewPrompt
    setReviewPrompt(null)

    if (prompt.kind === 'post') {
      await submitPost(true)
    } else {
      await submitFlaggedComment(prompt.postId)
    }
  }

  const isCommentSignatureValid = (comment: SignedComment) => {
    try {
      return ethers.verifyMessage(comment.message, comment.signature).toLowerCase() === comment.author.toLowerCase()
    } catch {
      return false
    }
  }

  const formatAddress = (address: string) => {
    if (!address) return ''
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const formatUser = (address: string) => {
    return usernamesCache[address] || formatAddress(address)
  }

  const formatDate = (timestamp: string | number) => {
    const value = Number(timestamp)
    if (!value) return '-'

    const date = value > 10_000_000_000 ? new Date(value) : new Date(value * 1000)
    return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-US', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date)
  }

  const formatEth = (wei: string) => {
    try {
      return `${Number(ethers.formatEther(wei)).toFixed(6)} ETH`
    } catch {
      return '0 ETH'
    }
  }

  const commentsForPost = (postId: string) => {
    return comments.filter((comment) => comment.postId === postId)
  }

  const onChainCommentsForPost = (postId: string) => {
    return onChainComments.filter((comment) => comment.postId === postId)
  }

  const roleLabel = (role?: ModeratorRole) => {
    if (!role?.isModerator) return 'Member'
    if (role.isCreatorModerator) return 'Creator MOD'
    if (role.isAppointedModerator) return 'Appointed MOD'
    if (role.isActiveBasedModerator) return 'Active MOD'
    return 'MOD'
  }

  const notifLabel = (type: string) => {
    const key = `notif_${type}` as TranslationKey
    const label = t(key)
    return label === key ? type : label
  }

  const activityLabel = (type: string) => {
    const key = `act_${type}` as TranslationKey
    const label = t(key)
    return label === key ? type : label
  }

  const openCommunity = (communityId: string) => {
    // A community that is still confirming on-chain has no real id to query yet.
    if (isTempId(communityId)) return
    // Re-clicking the current community won't re-fire the load effect (state
    // unchanged), so refresh explicitly - it doubles as a manual refresh.
    if (communityId === selectedCommunityId) {
      loadPosts(communityId)
      loadModeratorInfo(communityId)
    }
    setSelectedCommunityId(communityId)
    setView('community')
  }

  const openProfile = (address: string) => {
    setProfileAddress(address)
    setView('profile')
  }

  // Feed pagination bar: page-size chooser (top only), first/prev, a window of
  // page numbers, next/last, and a "page X of Y" readout - above and below the list.
  const renderPagination = (position: 'top' | 'bottom') => {
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

  const usernamePolicyError = usernameInput.trim() ? validateUsername(usernameInput.trim()) : null

  const renderVoteBox = (postId: string) => {
    const voteInfo = votesByPost[postId] || { score: 0, myVote: 0 }
    // A confirming (optimistic) post has no on-chain id yet - show the score
    // static so a stray click doesn't fire a doomed transaction.
    if (isTempId(postId)) {
      return (
        <div className="post-vote-box vote-box-static">
          <span className="vote-button-disabled">▲</span>
          <strong>{voteInfo.score}</strong>
          <span className="vote-button-disabled">▼</span>
        </div>
      )
    }

    return (
      <div className="post-vote-box">
        <button
          className={`vote-button ${voteInfo.myVote === 1 ? 'voted-up' : ''}`}
          onClick={(event) => {
            event.stopPropagation()
            castVote(postId, 1)
          }}
          aria-label="Upvote"
        >
          ▲
        </button>
        <strong className={voteInfo.score > 0 ? 'score-positive' : voteInfo.score < 0 ? 'score-negative' : ''}>
          {voteInfo.score}
        </strong>
        <button
          className={`vote-button ${voteInfo.myVote === -1 ? 'voted-down' : ''}`}
          onClick={(event) => {
            event.stopPropagation()
            castVote(postId, -1)
          }}
          aria-label="Downvote"
        >
          ▼
        </button>
      </div>
    )
  }

  const renderPostImages = (postId: string, images?: string[]) => {
    if (!images || images.length === 0) return null

    return (
      <div className="post-images">
        {images.map((cid) => (
          <img className="post-image" key={`${postId}-${cid}`} src={ipfsUrl(cid)} alt="" loading="lazy" />
        ))}
      </div>
    )
  }

  const renderCommunityButton = (community: Community, depth = 0) => {
    const children = communitiesByParent[community.id] || []

    return (
      <div key={community.id}>
        <button
          className={`community-item ${view === 'community' && selectedCommunityId === community.id ? 'active' : ''} ${community.confirming ? 'confirming-community' : ''}`}
          style={{ paddingInlineStart: `${0.75 + depth * 1.1}rem` }}
          onClick={() => openCommunity(community.id)}
        >
          <span className="community-avatar">{depth > 0 ? '↳' : 'r/'}</span>
          <span className="community-main">
            <strong>r/{community.name}</strong>
            <small>
              {community.confirming ? t('confirmingBadge') : t('membersLabel', { count: community.membersCount })}
            </small>
          </span>
          {community.confirming && <span className="mini-badge">⏳</span>}
          {!community.confirming && community.isModerator && <span className="mini-badge mod">MOD</span>}
        </button>

        {children.map((child) => renderCommunityButton(child, depth + 1))}
      </div>
    )
  }

  const renderTrendingFeed = () => (
    <>
      <section className="panel community-hero">
        <div>
          <span className="eyebrow">{t('home')}</span>
          <h2>{t('trending')}</h2>
          <p>
            {t('trendingBody')}
            {trendingSource === 'chain' && t('trendingOffline')}
          </p>
        </div>
      </section>

      <section className="feed-list">
        {rankedTrending.length === 0 ? (
          <div className="empty-state panel">
            <h3>{t('noPostsYet')}</h3>
            <p>{t('noTrendingBody')}</p>
          </div>
        ) : (
          rankedTrending.map((post) => {
            const metadata = getPostMetadata(post)
            const title = post.title || metadata.title
            const tags = post.tags.length > 0 ? post.tags : metadata.tags || []

            return (
              <article className="post-card panel" key={`trending-${post.id}`}>
                {renderVoteBox(post.id)}
                <button className="post-content-button" onClick={() => openCommunity(post.communityId)}>
                  <div className="post-main-content">
                    <div className="post-meta-line">
                      <span>r/{post.communityName}</span>
                      <span>·</span>
                      <span>{formatUser(post.author)}</span>
                      <span>·</span>
                      <span>{formatDate(post.createdAt)}</span>
                    </div>
                    <h3>{title}</h3>
                    <p className="rich-text">{renderRichText(metadata.body)}</p>
                    {renderPostImages(post.id, metadata.images)}
                    {tags.length > 0 && (
                      <div className="tag-row">
                        {tags.map((tag) => (
                          <span key={`trending-${post.id}-${tag}`}>#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              </article>
            )
          })
        )}
      </section>
    </>
  )

  const renderPendingReviewPanel = () => {
    if (!selectedCommunity?.isModerator) return null
    if (pendingPosts.length === 0 && pendingComments.length === 0 && reports.length === 0) return null

    return (
      <section className="panel secondary-create-card review-panel">
        <div className="section-heading">
          <span className="eyebrow">{t('pendingReviewTitle')}</span>
          <p className="muted-text">{t('pendingReviewBody')}</p>
        </div>

        {pendingPosts.length > 0 && (
          <div className="review-group">
            <h3>{t('pendingPostsTitle')}</h3>
            {pendingPosts.map((post) => {
              const metadata = getPostMetadata(post)
              return (
                <div className="review-item" key={`pending-post-${post.id}`}>
                  <div className="review-item-body">
                    <strong>{metadata.title}</strong>
                    <p className="rich-text">{renderRichText(metadata.body)}</p>
                    {renderPostImages(post.id, metadata.images)}
                    <small>
                      {formatUser(post.author)} · {formatDate(post.createdAt)}
                    </small>
                  </div>
                  <div className="review-actions">
                    <button className="primary-button" onClick={() => decidePendingPost(post.id, true)}>
                      {t('approve')}
                    </button>
                    <button className="danger-button" onClick={() => decidePendingPost(post.id, false)}>
                      {t('reject')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {pendingComments.length > 0 && (
          <div className="review-group">
            <h3>{t('pendingCommentsTitle')}</h3>
            {pendingComments.map((comment) => (
              <div className="review-item" key={`pending-comment-${comment.id}`}>
                <div className="review-item-body">
                  <p className="rich-text">{renderRichText(comment.content)}</p>
                  {comment.imageCid && <img className="post-image" src={ipfsUrl(comment.imageCid)} alt="" />}
                  <small>
                    {formatUser(comment.author)} · {formatDate(comment.createdAt)} · Post #{comment.postId}
                  </small>
                </div>
                <div className="review-actions">
                  <button className="primary-button" onClick={() => decidePendingComment(comment.id, true)}>
                    {t('approve')}
                  </button>
                  <button className="danger-button" onClick={() => decidePendingComment(comment.id, false)}>
                    {t('reject')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {reports.length > 0 && (
          <div className="review-group">
            <h3>{t('reportsTitle')}</h3>
            {reports.map((report) => (
              <div className="review-item" key={`report-${report.id}`}>
                <div className="review-item-body">
                  <strong>{report.kind === 0 ? t('reportOnPost', { id: report.refId }) : t('reportOnComment', { id: report.refId })}</strong>
                  <p className="rich-text">"{report.lastReason}"</p>
                  <small>
                    {report.reportCount > 1 && <>{t('reportCount', { count: report.reportCount })} · </>}
                    {formatDate(report.lastReportedAt)}
                  </small>
                </div>
                <div className="review-actions">
                  <button
                    className="primary-button"
                    onClick={() => resolveReport(report.kind as 0 | 1, report.refId, 1)}
                  >
                    {t('reportActionTaken')}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => resolveReport(report.kind as 0 | 1, report.refId, 0)}
                  >
                    {t('reportDismiss')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    )
  }

  const renderCommunityFeed = () => {
    if (!selectedCommunity) {
      return (
        <section className="empty-state panel">
          <h2>{t('pickCommunity')}</h2>
          <p>{t('pickCommunityBody')}</p>
        </section>
      )
    }

    return (
      <>
        <section className="community-hero panel">
          <div>
            <span className="eyebrow">{t('community')}</span>
            <h2>r/{selectedCommunity.name}</h2>
            <p>{getCommunityDescription(selectedCommunity)}</p>
            <div className="meta-row">
              <span>{t('membersLabel', { count: selectedCommunity.membersCount })}</span>
              <span>{t('creatorLabel', { name: formatUser(selectedCommunity.creator) })}</span>
              {selectedCommunity.parentCommunityId !== '0' && <span className="badge info">{t('subCommunityBadge')}</span>}
              {selectedCommunity.isMember && <span className="badge success">{t('memberBadge')}</span>}
              {selectedCommunity.isModerator && (
                <span className="badge warning">{roleLabel(selectedCommunity.moderatorRole)}</span>
              )}
              {selectedCommunity.isBanned && <span className="badge danger">{t('bannedBadge')}</span>}
            </div>
          </div>

          <div className="hero-actions">
            {!selectedCommunity.isMember && !selectedCommunity.isBanned && (
              <button className="primary-button" onClick={() => joinCommunity(selectedCommunity.id)}>
                {t('join')}
              </button>
            )}
            <button className="secondary-button" onClick={() => setShowCreatePost((previous) => !previous)}>
              {showCreatePost ? t('closeEditor') : t('writePost')}
            </button>
            <button className="ghost-button" onClick={() => setShowCreateSubCommunityModal(true)}>
              {t('subCommunityButton')}
            </button>
            {selectedCommunity.isMember && !selectedCommunity.moderatorRole?.isCreatorModerator && (
              <button className="ghost-button" onClick={() => leaveCommunity(selectedCommunity.id)}>
                {t('leaveCommunity')}
              </button>
            )}
          </div>
        </section>

        {renderPendingReviewPanel()}

        {showCreatePost && (
          <section className="panel create-post-card secondary-create-card">
            <div className="section-heading row-heading">
              <div>
                <span className="eyebrow">{t('newPostEyebrow')}</span>
                <h2>{t('publishPost')}</h2>
              </div>
              <span className="counter-pill">{t('activityPill')}</span>
            </div>

            {!selectedCommunity.isMember && <p className="warning-text">{t('joinBeforePosting')}</p>}

            <input
              type="text"
              placeholder={t('postTitlePh')}
              value={postTitle}
              onChange={(event) => setPostTitle(event.target.value)}
            />
            <Composer
              rich
              className="post-body-input"
              placeholder={t('postBodyPh')}
              value={postBody}
              onChange={setPostBody}
            />
            <input
              type="text"
              placeholder={t('postTagsPh')}
              value={postTags}
              onChange={(event) => setPostTags(event.target.value)}
            />

            <label className="file-input-label">
              {t('attachImages')}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files || [])
                  setPostImages((previous) => [...previous, ...files])
                  event.target.value = ''
                }}
              />
            </label>

            {postImages.length > 0 && (
              <div className="image-previews">
                {postImages.map((file, index) => (
                  <div className="image-preview" key={`${file.name}-${index}`}>
                    <img src={URL.createObjectURL(file)} alt={file.name} />
                    <button
                      className="ghost-button"
                      onClick={() => setPostImages((previous) => previous.filter((_, i) => i !== index))}
                    >
                      {t('removeImage')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="form-footer">
              <small>{t('storedOnIpfs')}</small>
              <button className="primary-button" disabled={uploadingMedia} onClick={createPost}>
                {uploadingMedia ? t('uploadingImages') : t('publish')}
              </button>
            </div>
          </section>
        )}

        <section className="feed-list">
          <div className="feed-title-row">
            <h2>{t('feed')}</h2>
            <span>{t('postsCount', { count: visiblePosts.length })}</span>
          </div>

          {hiddenForMeCount > 0 && (
            <button className="ghost-button hidden-toggle" onClick={() => setShowHiddenForMe((previous) => !previous)}>
              {showHiddenForMe ? t('hideHiddenPosts') : t('showHiddenPosts', { count: hiddenForMeCount })}
            </button>
          )}

          {visiblePosts.length === 0 ? (
            <div className="empty-state panel">
              <h3>{t('noPostsYet')}</h3>
              <p>{t('noPostsBody')}</p>
            </div>
          ) : (
            <>
              {renderPagination('top')}
              {pagedPosts.map((post) => {
              const metadata = getPostMetadata(post)
              const postComments = commentsForPost(post.id)
              const chainComments = onChainCommentsForPost(post.id)
              const totalComments = postComments.length + chainComments.length
              const isSelected = selectedPost?.id === post.id

              return (
                <article
                  className={`post-card panel ${post.hidden && !post.pending ? 'hidden-post' : ''} ${isSelected ? 'selected' : ''} ${post.confirming ? 'confirming-post' : ''}`}
                  key={post.id}
                >
                  {renderVoteBox(post.id)}
                  <div className="post-card-body">
                    <button
                      className="post-content-button"
                      onClick={() => setSelectedPostId((previous) => (previous === post.id ? '' : post.id))}
                    >
                      <div className="post-main-content">
                        <div className="post-meta-line">
                          <span>r/{selectedCommunity.name}</span>
                          <span>·</span>
                          <span>{formatUser(post.author)}</span>
                          <span>·</span>
                          <span>{formatDate(post.createdAt)}</span>
                        </div>
                        <h3>{metadata.title}</h3>
                        <p className="rich-text">{renderRichText(metadata.body)}</p>
                        {renderPostImages(post.id, metadata.images)}
                        {metadata.tags && metadata.tags.length > 0 && (
                          <div className="tag-row">
                            {metadata.tags.map((tag) => (
                              <span key={`${post.id}-${tag}`}>#{tag}</span>
                            ))}
                          </div>
                        )}
                        <div className="post-actions-line">
                          <span>{t('commentsCount', { count: totalComments })}</span>
                          {post.confirming && <span className="badge info">⏳ {t('confirmingBadge')}</span>}
                          {post.locked && <span className="badge warning">🔒 {t('lockedBadge')}</span>}
                          {post.pending && <span className="badge warning">{t('pendingBadge')}</span>}
                          {post.rejected && <span className="badge danger">{t('rejectedBadge')}</span>}
                          {post.hidden && !post.pending && !post.rejected && (
                            <span className="badge danger">{t('hiddenBadge')}</span>
                          )}
                        </div>
                      </div>
                    </button>

                    {!post.confirming && (
                      <div className="kebab-wrapper post-kebab">
                        <button
                          className="kebab-button"
                          aria-label={t('postActionsMenu')}
                          title={t('postActionsMenu')}
                          onClick={(event) => {
                            event.stopPropagation()
                            setOpenKebabId(openKebabId === `post-${post.id}` ? null : `post-${post.id}`)
                          }}
                        >
                          ⋮
                        </button>
                        {openKebabId === `post-${post.id}` && (
                          <div className="kebab-menu">
                            {hiddenForMe.includes(post.id) ? (
                              <button onClick={() => { setOpenKebabId(null); unhidePostForMe(post.id) }}>
                                {t('unhideForMe')}
                              </button>
                            ) : (
                              <button onClick={() => { setOpenKebabId(null); hidePostForMe(post.id) }}>
                                {t('hideForMe')}
                              </button>
                            )}
                            <button onClick={() => { setOpenKebabId(null); setReportReason(''); setReportTarget({ kind: 0, id: post.id }) }}>
                              {t('reportAction')}
                            </button>
                            {selectedCommunity.isModerator && !post.pending && !post.rejected && (
                              <>
                                {post.hidden ? (
                                  <button onClick={() => { setOpenKebabId(null); restorePost(post.id) }}>
                                    {t('restorePost')}
                                  </button>
                                ) : (
                                  <button className="danger" onClick={() => { setOpenKebabId(null); hidePost(post.id) }}>
                                    {t('hidePostButton')}
                                  </button>
                                )}
                                {post.locked ? (
                                  <button onClick={() => { setOpenKebabId(null); setPostLock(post.id, false) }}>
                                    {t('unlockPostAction')}
                                  </button>
                                ) : (
                                  <button onClick={() => { setOpenKebabId(null); setPostLock(post.id, true) }}>
                                    {t('lockPostAction')}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {isSelected && (
                      <div className="comments-box">
                        <h4>{t('offChainComments')}</h4>
                        {totalComments === 0 ? (
                          <p className="muted-text">{t('noComments')}</p>
                        ) : (
                          <div className="comments-list">
                            {chainComments.map((comment) => (
                              <div className={`comment-item ${comment.confirming ? 'confirming-comment' : ''}`} key={`chain-${comment.id}`}>
                                {comment.id.startsWith('c-') && (
                                  <div className="kebab-wrapper comment-kebab">
                                    <button
                                      className="kebab-button"
                                      aria-label={t('postActionsMenu')}
                                      title={t('postActionsMenu')}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        setOpenKebabId(
                                          openKebabId === `comment-${comment.id}` ? null : `comment-${comment.id}`
                                        )
                                      }}
                                    >
                                      ⋮
                                    </button>
                                    {openKebabId === `comment-${comment.id}` && (
                                      <div className="kebab-menu">
                                        <button onClick={() => { setOpenKebabId(null); setReportReason(''); setReportTarget({ kind: 1, id: comment.id }) }}>
                                          {t('reportAction')}
                                        </button>
                                        {selectedCommunity.isModerator && (
                                          <button
                                            className="danger"
                                            onClick={() => { setOpenKebabId(null); hideChainComment(comment.id) }}
                                          >
                                            {t('hideCommentAction')}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <p className="rich-text">{renderRichText(comment.content)}</p>
                                {comment.imageCid && <img className="post-image" src={ipfsUrl(comment.imageCid)} alt="" />}
                                <small>
                                  {formatUser(comment.author)} · {formatDate(comment.createdAt)} ·{' '}
                                  {comment.confirming ? t('commentConfirmingLabel') : t('onChainComment')}
                                </small>
                              </div>
                            ))}
                            {postComments.map((comment, index) => (
                              <div className="comment-item" key={`${comment.signature}-${index}`}>
                                <p className="rich-text">{renderRichText(comment.content)}</p>
                                {comment.imageCid && <img className="post-image" src={ipfsUrl(comment.imageCid)} alt="" />}
                                <small>
                                  {formatUser(comment.author)} · {formatDate(comment.createdAt)} · {t('signatureLabel')}{' '}
                                  {isCommentSignatureValid(comment) ? t('signatureValid') : t('signatureInvalid')}
                                </small>
                              </div>
                            ))}
                          </div>
                        )}

                        {post.locked ? (
                          <p className="muted-text locked-notice">🔒 {t('lockedNotice')}</p>
                        ) : (
                          <>
                            <Composer
                              rich
                              placeholder={t('commentPh')}
                              value={newCommentByPost[post.id] || ''}
                              onChange={(value) =>
                                setNewCommentByPost((previous) => ({ ...previous, [post.id]: value }))
                              }
                            />
                            <label className="file-input-label">
                              {t('attachCommentImage')}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
                                onChange={(event) => {
                                  const file = event.target.files?.[0]
                                  setCommentImageByPost((previous) => ({ ...previous, [post.id]: file }))
                                  event.target.value = ''
                                }}
                              />
                            </label>
                            {commentImageByPost[post.id] && (
                              <div className="image-previews">
                                <div className="image-preview">
                                  <img
                                    src={URL.createObjectURL(commentImageByPost[post.id] as File)}
                                    alt={commentImageByPost[post.id]?.name}
                                  />
                                  <button
                                    className="ghost-button"
                                    onClick={() =>
                                      setCommentImageByPost((previous) => ({ ...previous, [post.id]: undefined }))
                                    }
                                  >
                                    {t('removeImage')}
                                  </button>
                                </div>
                              </div>
                            )}
                            <button className="secondary-button full" onClick={() => submitComment(post.id)}>
                              {t('sendComment')}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              )
              })}
              {renderPagination('bottom')}
            </>
          )}
        </section>
      </>
    )
  }

  const renderSearchView = () => {
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

  // Items waiting for the user's decision: moderator nominations to accept or
  // decline, and open removal votes in communities they moderate.
  const renderActionItems = () => {
    if (moderatorOffers.length === 0 && removalVotes.length === 0) return null

    return (
      <div className="action-items">
        {moderatorOffers.map((community) => (
          <div className="notification-item unread action-item" key={`offer-${community.id}`}>
            <strong>{t('offerLine', { name: community.name })}</strong>
            <div className="review-actions">
              <button className="primary-button" onClick={() => acceptModeratorOffer(community.id)}>
                {t('acceptRole')}
              </button>
              <button className="ghost-button" onClick={() => declineModeratorOffer(community.id)}>
                {t('declineRole')}
              </button>
            </div>
          </div>
        ))}

        {removalVotes.map((vote) => (
          <div
            className={`notification-item action-item ${vote.approvedByMe ? '' : 'unread'}`}
            key={`removal-${vote.proposalId}`}
          >
            <strong>
              {t('removalVoteLine', {
                target: formatUser(vote.target),
                name: vote.communityName,
              })}
            </strong>
            <small>
              {t('removalVoteProgress', { approvals: vote.approvals, required: vote.required })}
            </small>
            {vote.approvedByMe ? (
              <small>{t('alreadyApprovedRemoval')}</small>
            ) : (
              <div className="review-actions">
                <button className="danger-button" onClick={() => approveRemovalVote(vote.proposalId)}>
                  {t('approveRemoval')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  const renderNotificationsList = () => {
    if (notifications.length === 0) {
      return <p className="muted-text">{t('noNotifications')}</p>
    }

    return (
      <div className="notification-list">
        {notifications.map((notification) => {
          const isRead = readNotificationIds.includes(notification.id)
          return (
            <div
              className={`notification-item ${isRead ? '' : 'unread clickable'}`}
              key={notification.id}
              role="button"
              tabIndex={0}
              title={isRead ? undefined : t('clickToMarkRead')}
              onClick={() => markNotificationRead(notification.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') markNotificationRead(notification.id)
              }}
            >
              <strong>{notifLabel(notification.type)}</strong>
              <small>
                {notification.detail && `"${notification.detail}" · `}
                {notification.actorLabel &&
                  `${notification.actorLabel.startsWith('0x') ? formatUser(notification.actorLabel) : notification.actorLabel} · `}
                {formatDate(notification.timestamp)}
              </small>
            </div>
          )
        })}
      </div>
    )
  }

  const renderNotificationsDropdown = () => (
    <div className="notifications-dropdown panel">
      <div className="row-heading">
        <h3>{t('notificationsTitle')}</h3>
        {notifications.length > 0 && (
          <button className="ghost-button" onClick={markAllNotificationsRead}>
            {t('markAllRead')}
          </button>
        )}
      </div>
      {renderActionItems()}
      {renderNotificationsList()}
    </div>
  )

  const renderProfileView = () => {
    const isOwnProfile = profileAddress.toLowerCase() === walletAddress.toLowerCase()
    const displayName =
      (isOwnProfile && username) || usernamesCache[profileAddress] || profileData?.username || formatAddress(profileAddress)

    return (
      <main className="page-view">
        <section className="panel page-card">
          <div className="row-heading">
            <div>
              <span className="eyebrow">{isOwnProfile ? t('personalArea') : t('userProfile')}</span>
              <h2>@{displayName}</h2>
              <p className="muted-text">{profileAddress}</p>
            </div>
            {isOwnProfile && (
              <button
                className="ghost-button"
                onClick={() => {
                  setUsernameInput('')
                  setShowChangeUsernameModal(true)
                }}
              >
                {t('changeUsernameButton', { fee: USERNAME_CHANGE_FEE_ETH })}
              </button>
            )}
          </div>

          {profileGraphOffline ? (
            <p className="warning-text">{t('graphOfflineProfile')}</p>
          ) : (
            <div className="stats-row">
              <div className="stat-box">
                <strong>{profileData?.postCount ?? 0}</strong>
                <small>{t('statPosts')}</small>
              </div>
              <div className="stat-box">
                <strong>{profileData?.communitiesJoined ?? 0}</strong>
                <small>{t('statCommunities')}</small>
              </div>
              <div className="stat-box">
                <strong>{Number(profileData?.totalGasUsed ?? '0').toLocaleString()}</strong>
                <small>{t('statGas')}</small>
              </div>
              <div className="stat-box">
                <strong>{formatEth(profileData?.totalFeesWei ?? '0')}</strong>
                <small>{t('statFees')}</small>
              </div>
            </div>
          )}
        </section>

        {isOwnProfile && (
          <section className="panel page-card">
            <div className="row-heading">
              <h3>
                {t('notificationsTitle')}{' '}
                {bellCount > 0 && <span className="badge warning">{t('newBadge', { count: bellCount })}</span>}
              </h3>
              {notifications.length > 0 && (
                <button className="ghost-button" onClick={markAllNotificationsRead}>
                  {t('markAllRead')}
                </button>
              )}
            </div>
            <p className="muted-text">{t('commentReplyNote')}</p>

            {renderActionItems()}
            {renderNotificationsList()}
          </section>
        )}

        {!profileGraphOffline && (
          <section className="panel page-card">
            <h3>{t('recentActivity')}</h3>
            {profileActivities.length === 0 ? (
              <p className="muted-text">{t('noActivity')}</p>
            ) : (
              <div className="activity-list">
                {profileActivities.map((activity) => (
                  <div className="activity-item" key={activity.id}>
                    <strong>{activityLabel(activity.type)}</strong>
                    <small>
                      {activity.detail && `${activity.detail} · `}
                      {t('gasLine', { gas: Number(activity.gasUsed).toLocaleString() })} · {formatEth(activity.feeWei)} ·{' '}
                      {formatDate(activity.timestamp)}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    )
  }

  return (
    <div className="app-shell" dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <header className="topbar">
        <button className="brand-block brand-button" onClick={() => setView('home')}>
          <div className="brand-mark">R</div>
          <div>
            <h1>Reppit</h1>
            <p>{t('brandTagline')}</p>
          </div>
        </button>

        <div className="search-shell">
          <span>⌕</span>
          <input
            type="search"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                runSearch(searchQuery, searchFilter)
              }
            }}
          />
        </div>

        <div className="topbar-actions">
          <div className="lang-toggle">
            <button className={`chip ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>
              EN
            </button>
            <button className={`chip ${lang === 'he' ? 'active' : ''}`} onClick={() => setLang('he')}>
              עב
            </button>
          </div>

          {walletAddress && (
            <div className="notifications-wrapper">
              <button
                className={`ghost-button topbar-nav-button bell-button ${showNotificationsPanel ? 'active-nav' : ''}`}
                onClick={() => setShowNotificationsPanel((previous) => !previous)}
                aria-label={t('notificationsTitle')}
                title={t('notificationsTitle')}
              >
                🔔
                {bellCount > 0 && <span className="notification-badge">{bellCount}</span>}
              </button>
              {showNotificationsPanel && renderNotificationsDropdown()}
            </div>
          )}

          {walletAddress && (
            <button
              className={`ghost-button topbar-nav-button ${view === 'profile' ? 'active-nav' : ''}`}
              onClick={() => openProfile(walletAddress)}
            >
              @{username || formatAddress(walletAddress)}
            </button>
          )}

          <div className="wallet-panel">
            {walletAddress ? (
              <>
                <span className="status-dot" />
                <span className="wallet-label">{t('connected')}</span>
                <code>{formatAddress(walletAddress)}</code>
                <button className="ghost-button disconnect-button" onClick={disconnectWallet}>
                  {t('disconnect')}
                </button>
              </>
            ) : (
              <button className="primary-button" onClick={connectWallet}>
                {t('connectWallet')}
              </button>
            )}
          </div>
        </div>
      </header>

      {modNotification && <div className="toast-message mod-alert">{modNotification}</div>}
      {statusMessage && <div className="toast-message">{statusMessage}</div>}

      {!walletAddress ? (
        <main className="landing-card">
          <span className="eyebrow">{t('landingEyebrow')}</span>
          <h2>{t('landingTitle')}</h2>
          <p>{t('landingBody')}</p>
          <button className="primary-button large" onClick={connectWallet}>
            {t('connectWithMetaMask')}
          </button>
        </main>
      ) : (
        <>
          {view === 'search' && renderSearchView()}
          {view === 'profile' && renderProfileView()}
          {(view === 'home' || view === 'community') && (
            <main className="forum-layout">
              <aside className="sidebar">
                <section className="panel communities-panel">
                  <div className="section-heading row-heading">
                    <div>
                      <span className="eyebrow">{t('subForums')}</span>
                      <h2>{t('communities')}</h2>
                    </div>
                    <span className="counter-pill">{communities.length}</span>
                  </div>

                  <button
                    className="primary-button full action-trigger"
                    onClick={() => setShowCreateCommunityModal(true)}
                  >
                    {t('newCommunity')}
                  </button>

                  {communities.length === 0 ? (
                    <p className="muted-text">{t('noCommunities')}</p>
                  ) : (
                    <div className="community-list">{rootCommunities.map((community) => renderCommunityButton(community))}</div>
                  )}
                </section>
              </aside>

              <section className="main-feed">{view === 'home' ? renderTrendingFeed() : renderCommunityFeed()}</section>

              <aside className="details-sidebar">
                {view === 'community' ? (
                  <>
                    <section className="panel details-card governance-card">
                      <span className="eyebrow">{t('governance')}</span>
                      {selectedCommunity ? (
                        <>
                          <h2>{t('moderatorsTitle')}</h2>
                          <p>{t('governanceBody')}</p>

                          <div className="mod-list">
                            {moderators.length === 0 ? (
                              <p className="muted-text">{t('noModData')}</p>
                            ) : (
                              moderators.map((moderator) => (
                                <div className="mod-row" key={moderator.address}>
                                  <div>
                                    <strong>{formatUser(moderator.address)}</strong>
                                    <small>
                                      {roleLabel(moderator.role)} · {t('scoreLabel', { score: moderator.score })}
                                    </small>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>

                          <div className="active-box">
                            <strong>{t('topActive')}</strong>
                            {topActiveUsers.length === 0 ? (
                              <small>{t('noActiveMods')}</small>
                            ) : (
                              topActiveUsers.map((address) => <small key={address}>{formatUser(address)}</small>)
                            )}
                          </div>

                          {selectedCommunity.isModerator && (
                            <button
                              className="ghost-button full action-trigger"
                              onClick={() => setShowModeratorActionsModal(true)}
                            >
                              {t('moderatorActions')}
                            </button>
                          )}
                        </>
                      ) : (
                        <p className="muted-text">{t('pickCommunityGov')}</p>
                      )}
                    </section>

                    <section className="panel details-card">
                      <span className="eyebrow">{t('postDetails')}</span>
                      {selectedPost ? (
                        <>
                          <h2>{getPostMetadata(selectedPost).title}</h2>
                          <p className="rich-text">{renderRichText(getPostMetadata(selectedPost).body)}</p>
                          <div className="details-grid">
                            <span>{t('postIdLabel')}</span>
                            <strong>#{selectedPost.id}</strong>
                            <span>{t('authorLabel')}</span>
                            <strong>{formatUser(selectedPost.author)}</strong>
                            <span>{t('scoreDetailLabel')}</span>
                            <strong>{votesByPost[selectedPost.id]?.score ?? 0}</strong>
                            <span>{t('commentsLabel')}</span>
                            <strong>{commentsForPost(selectedPost.id).length + onChainCommentsForPost(selectedPost.id).length}</strong>
                          </div>
                        </>
                      ) : (
                        <p className="muted-text">{t('pickPost')}</p>
                      )}
                    </section>
                  </>
                ) : (
                  <section className="panel details-card">
                    <span className="eyebrow">{t('aboutEyebrow')}</span>
                    <h2>{t('aboutTrendingTitle')}</h2>
                    <p>{t('aboutTrendingBody')}</p>
                    <p className="muted-text">{t('aboutTrendingGraph')}</p>
                  </section>
                )}
              </aside>
            </main>
          )}

          {showUsernameModal && (
            <Modal title={t('chooseUsername')} dismissible={false}>
              <p>{t('usernameIntro')}</p>
              <input
                type="text"
                placeholder={t('usernamePh')}
                value={usernameInput}
                onChange={(event) => setUsernameInput(event.target.value)}
              />
              {usernamePolicyError && <p className="warning-text">{t(`username_${usernamePolicyError}` as TranslationKey)}</p>}
              {!usernamePolicyError && usernameInput.trim() && usernameAvailable !== null && (
                <p className={usernameAvailable ? 'muted-text' : 'warning-text'}>
                  {usernameAvailable ? t('usernameAvailable') : t('usernameTaken')}
                </p>
              )}
              <button
                className="primary-button full"
                disabled={!usernameInput.trim() || Boolean(usernamePolicyError) || usernameAvailable === false}
                onClick={submitUsername}
              >
                {t('confirmUsername')}
              </button>
            </Modal>
          )}

          {showChangeUsernameModal && (
            <Modal
              title={t('changeUsernameTitle')}
              onClose={() => {
                setShowChangeUsernameModal(false)
                setUsernameInput('')
              }}
            >
              <p>{t('changeUsernameBody', { fee: USERNAME_CHANGE_FEE_ETH, old: username })}</p>
              <input
                type="text"
                placeholder={t('newUsernamePh')}
                value={usernameInput}
                onChange={(event) => setUsernameInput(event.target.value)}
              />
              {usernamePolicyError && <p className="warning-text">{t(`username_${usernamePolicyError}` as TranslationKey)}</p>}
              {!usernamePolicyError && usernameInput.trim() && usernameAvailable !== null && (
                <p className={usernameAvailable ? 'muted-text' : 'warning-text'}>
                  {usernameAvailable ? t('usernameAvailable') : t('usernameTaken')}
                </p>
              )}
              <button
                className="primary-button full"
                disabled={!usernameInput.trim() || Boolean(usernamePolicyError) || usernameAvailable === false}
                onClick={submitUsernameChange}
              >
                {t('payAndChange', { fee: USERNAME_CHANGE_FEE_ETH })}
              </button>
            </Modal>
          )}

          {reportTarget && (
            <Modal title={t('reportTitle')} onClose={() => setReportTarget(null)}>
              <p className="muted-text">{t('reportBody')}</p>
              <textarea
                placeholder={t('reportReasonPh')}
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
              />
              <button className="danger-button full" onClick={submitReport}>
                {t('reportSubmit')}
              </button>
            </Modal>
          )}

          {showCreateCommunityModal && (
            <Modal title={t('newCommunityTitle')} onClose={() => setShowCreateCommunityModal(false)}>
              <input
                type="text"
                placeholder={t('communityNamePh')}
                value={newCommunityName}
                onChange={(event) => setNewCommunityName(event.target.value)}
              />
              {newCommunityName.trim() && !isValidCommunityName(newCommunityName.trim()) && (
                <p className="warning-text">{t('communityNameInvalid')}</p>
              )}
              <Composer
                placeholder={t('communityDescPh')}
                value={newCommunityDesc}
                onChange={setNewCommunityDesc}
              />
              <button className="primary-button full" onClick={createCommunity}>
                {t('createCommunityButton')}
              </button>
            </Modal>
          )}

          {showCreateSubCommunityModal && selectedCommunity && (
            <Modal
              title={t('subCommunityTitle', { name: selectedCommunity.name })}
              onClose={() => setShowCreateSubCommunityModal(false)}
            >
              <input
                type="text"
                placeholder={t('subNamePh')}
                value={newSubCommunityName}
                onChange={(event) => setNewSubCommunityName(event.target.value)}
              />
              {newSubCommunityName.trim() && !isValidCommunityName(newSubCommunityName.trim()) && (
                <p className="warning-text">{t('communityNameInvalid')}</p>
              )}
              <Composer
                placeholder={t('subDescPh')}
                value={newSubCommunityDesc}
                onChange={setNewSubCommunityDesc}
              />
              <button className="ghost-button full" onClick={createSubCommunity}>
                {t('createSubButton')}
              </button>
            </Modal>
          )}

          {showModeratorActionsModal && selectedCommunity && (
            <Modal title={t('moderatorActions')} onClose={() => setShowModeratorActionsModal(false)}>
              <div className="governance-tools">
                <div className="recommend-box">
                  <strong>{t('recommendTitle')}</strong>
                  <p className="muted-text">{t('recommendBody')}</p>
                  <input
                    type="text"
                    placeholder={t('recommendPh')}
                    value={recommendInput}
                    onChange={(event) => setRecommendInput(event.target.value)}
                  />
                  <button className="secondary-button full" onClick={recommendModerator}>
                    {t('recommendButton')}
                  </button>
                </div>

                <hr className="tools-divider" />
                <p className="muted-text">{t('removalIntro')}</p>
                <input
                  type="text"
                  placeholder={t('removeAddrPh')}
                  value={removeTargetInput}
                  onChange={(event) => setRemoveTargetInput(event.target.value)}
                />
                <input
                  type="text"
                  placeholder={t('reasonPh')}
                  value={removeReasonInput}
                  onChange={(event) => setRemoveReasonInput(event.target.value)}
                />
                <button className="danger-button full" onClick={proposeRemoveModerator}>
                  {t('openRemoval')}
                </button>

                {removalVotes.filter((vote) => vote.communityId === selectedCommunity.id).length > 0 && (
                  <div className="removal-votes-box">
                    <strong>{t('removalVotesSection')}</strong>
                    {removalVotes
                      .filter((vote) => vote.communityId === selectedCommunity.id)
                      .map((vote) => (
                        <div className="notification-item" key={`modal-removal-${vote.proposalId}`}>
                          <strong>
                            {t('removalVoteLine', { target: formatUser(vote.target), name: vote.communityName })}
                          </strong>
                          {vote.reason && <small>"{vote.reason}"</small>}
                          <small>
                            {t('removalVoteProgress', { approvals: vote.approvals, required: vote.required })}
                          </small>
                          <small>{t('expiresOn', { date: formatDate(vote.deadline) })}</small>
                          {vote.approvedByMe ? (
                            <small>{t('alreadyApprovedRemoval')}</small>
                          ) : (
                            <button className="danger-button" onClick={() => approveRemovalVote(vote.proposalId)}>
                              {t('approveRemoval')}
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                )}

                <hr className="tools-divider" />
                <div className="ban-box">
                  <strong>{t('banTitle')}</strong>
                  <p className="muted-text">{t('banBody')}</p>
                  <input
                    type="text"
                    placeholder={t('banAddrPh')}
                    value={banTargetInput}
                    onChange={(event) => setBanTargetInput(event.target.value)}
                  />
                  <input
                    type="text"
                    placeholder={t('reasonPh')}
                    value={banReasonInput}
                    onChange={(event) => setBanReasonInput(event.target.value)}
                  />
                  <button className="danger-button full" onClick={banMember}>
                    {t('banButton')}
                  </button>

                  {bannedUsers.length > 0 && (
                    <div className="removal-votes-box">
                      <strong>{t('bannedListTitle')}</strong>
                      {bannedUsers.map((banned) => (
                        <div className="notification-item" key={`banned-${banned.id}`}>
                          <strong>
                            {banned.user.username ? `@${banned.user.username}` : formatUser(banned.user.id)}
                          </strong>
                          <small>"{banned.reason}"</small>
                          <button className="ghost-button" onClick={() => unbanMember(banned.user.id)}>
                            {t('unbanButton')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {!selectedCommunity.moderatorRole?.isCreatorModerator && (
                  <>
                    <hr className="tools-divider" />
                    <p className="muted-text">{t('resignBody')}</p>
                    <button
                      className="ghost-button full"
                      onClick={() => resignFromModeration(selectedCommunity.id, selectedCommunity.name)}
                    >
                      {t('resignButton')}
                    </button>
                  </>
                )}
              </div>
            </Modal>
          )}

          {reviewPrompt && (
            <Modal title={t('unsafeTitle')} onClose={() => setReviewPrompt(null)}>
              <p>{reviewPrompt.kind === 'post' ? t('unsafePostBody') : t('unsafeCommentBody')}</p>
              {reviewPrompt.selfHarm && <p className="warning-text">{t('selfHarmNote')}</p>}
              <div className="review-actions">
                <button className="primary-button" onClick={confirmReviewSubmission}>
                  {t('submitForReview')}
                </button>
                <button className="ghost-button" onClick={() => setReviewPrompt(null)}>
                  {t('cancel')}
                </button>
              </div>
            </Modal>
          )}
        </>
      )}
    </div>
  )
}

export default App
