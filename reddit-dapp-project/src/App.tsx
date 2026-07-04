import { useEffect, useMemo, useRef, useState } from 'react'
import { ethers } from 'ethers'
import contractArtifact from './DecentralizedForum.json'
import { addJson, addFile, getJson, ipfsUrl } from './ipfs'
import Modal from './Modal'
import { validateUsername, isValidCommunityName } from './usernamePolicy'
import { checkContentSafety } from './contentSafety'
import { loadLanguage, makeTranslator, LANGUAGE_STORAGE_KEY, type Language, type TranslationKey } from './i18n'
import {
  fetchApprovedComments,
  fetchPendingComments,
  fetchRecentPosts,
  fetchUserActivities,
  fetchUserNotifications,
  fetchUserProfile,
  graphQuery,
  searchByTag,
  searchCommunities,
  searchPosts,
  searchUsers,
  type GraphActivity,
  type GraphPost,
  type GraphUser,
} from './graph'
import './App.css'

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const COMMENTS_STORAGE_KEY = 'reppit_signed_comments_v1'
const READ_NOTIFICATIONS_KEY = 'reppit_read_notifications_v1'
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
  pending: boolean
  rejected: boolean
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

  const [walletAddress, setWalletAddress] = useState('')
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
  const [showModeratorActionsModal, setShowModeratorActionsModal] = useState(false)
  const [removalVotes, setRemovalVotes] = useState<RemovalVote[]>([])

  const [profileAddress, setProfileAddress] = useState('')
  const [profileData, setProfileData] = useState<GraphUser | null>(null)
  const [profileActivities, setProfileActivities] = useState<GraphActivity[]>([])
  const [profileGraphOffline, setProfileGraphOffline] = useState(false)

  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([])
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false)

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
    return communities.reduce<Record<string, Community[]>>((acc, community) => {
      const parentId = community.parentCommunityId || '0'
      acc[parentId] = acc[parentId] || []
      acc[parentId].push(community)
      return acc
    }, {})
  }, [communities])

  const rootCommunities = communitiesByParent['0'] || []

  const myAddress = walletAddress.toLowerCase()

  const visiblePosts = useMemo(() => {
    return posts.filter((post) => {
      if (selectedCommunity?.isModerator) return true
      if (post.author.toLowerCase() === myAddress) return true
      return !post.hidden && !post.pending && !post.rejected
    })
  }, [posts, selectedCommunity?.isModerator, myAddress])

  const pendingPosts = useMemo(() => posts.filter((post) => post.pending), [posts])

  const selectedPost = visiblePosts.find((post) => post.id === selectedPostId) || visiblePosts[0]

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

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
  }, [lang])

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
    if (!walletAddress || !window.ethereum) return

    let cancelled = false
    const provider = new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider)
    const contract = new ethers.Contract(CONTRACT_ADDRESS, contractArtifact.abi, provider)

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
  }, [walletAddress, lang])

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

    if (withSigner) {
      const signer = await provider.getSigner()
      return new ethers.Contract(CONTRACT_ADDRESS, contractArtifact.abi, signer)
    }

    return new ethers.Contract(CONTRACT_ADDRESS, contractArtifact.abi, provider)
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
      setWalletAddress(accounts[0])
      await loadCommunities(accounts[0], true)
      setTemporaryStatus(t('walletConnected'))
    } catch (error) {
      console.error('Wallet connection failed:', error)
      alert(t('connectFailed'))
    }
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
      alert(t('registerFailed'))
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
      alert(t('changeFailed'))
    }
  }

  const loadCommunities = async (account = walletAddress, seedKnownModerators = false) => {
    try {
      const contract = await getContract(false)
      const ids = await contract.getAllCommunityIds()
      const loadedCommunities: Community[] = []

      for (const id of ids) {
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
          isMember = await contract.isUserMemberOfCommunity(communityId, account)
          isModerator = await contract.isUserModeratorOfCommunity(communityId, account)
          isBanned = await contract.isUserBannedFromCommunity(communityId, account)

          try {
            hasModeratorOffer = await contract.hasPendingModeratorOffer(communityId, account)
          } catch {
            hasModeratorOffer = false
          }

          try {
            const role = await contract.getModeratorRole(communityId, account)
            moderatorRole = {
              isModerator: role[0],
              isCreatorModerator: role[1],
              isActiveBasedModerator: role[2],
              isAppointedModerator: role[3],
            }
          } catch {
            moderatorRole = { isModerator, isCreatorModerator: false, isActiveBasedModerator: false, isAppointedModerator: false }
          }
        }

        loadedCommunities.push({
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
        })
      }

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

        const required = await contract.getRequiredRemovalApprovals(community.id)

        for (const proposalId of proposalIds) {
          const proposal = await contract.getRemoveModeratorProposal(proposalId)
          if (proposal[5]) continue // already executed

          const approvedByMe = await contract.hasApprovedRemoveModeratorProposal(proposalId, account)

          votes.push({
            proposalId: proposal[0].toString(),
            communityId: proposal[1].toString(),
            communityName: community.name,
            target: proposal[2],
            approvals: Number(proposal[4]),
            required: Number(required),
            approvedByMe,
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
      const entries: Record<string, VoteInfo> = {}

      for (const postId of postIds) {
        const [score, myVote] = await Promise.all([
          contract.postScore(postId),
          account ? contract.postVotes(postId, account) : Promise.resolve(0),
        ])
        entries[postId] = { score: Number(score), myVote: Number(myVote) }
      }

      setVotesByPost((prev) => ({ ...prev, ...entries }))
    } catch (error) {
      console.error('Failed to load votes:', error)
    }
  }

  const loadPosts = async (communityId: string) => {
    try {
      const contract = await getContract(false)
      const postIds = await contract.getPostsByCommunity(communityId)
      const loadedPosts: Post[] = []

      for (const id of postIds) {
        const post = await contract.getPost(id)
        const [pending, rejected] = await Promise.all([
          contract.postPendingReview(id),
          contract.postRejected(id),
        ])

        loadedPosts.push({
          id: post[0].toString(),
          communityId: post[1].toString(),
          author: post[2],
          contentCID: post[3],
          createdAt: post[4].toString(),
          hidden: post[6],
          pending,
          rejected,
        })
      }

      setPosts(loadedPosts.reverse())
      loadVotesFor(loadedPosts.map((post) => post.id))
      loadOnChainComments(communityId, loadedPosts)
    } catch (error) {
      console.error('Failed to load posts:', error)
      setPosts([])
    }
  }

  // Approved + pending on-chain comments for the community. Prefers the graph;
  // falls back to per-post chain reads.
  const loadOnChainComments = async (communityId: string, communityPosts: Post[]) => {
    const [graphPending, approvedPerPost] = await Promise.all([
      fetchPendingComments(communityId),
      Promise.all(communityPosts.map((post) => fetchApprovedComments(post.id))),
    ])

    if (graphPending !== null) {
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

      const approved: OnChainComment[] = []
      approvedPerPost.forEach((batch) => {
        if (batch) {
          batch.forEach((comment) => {
            approved.push({
              id: comment.id,
              postId: comment.post.id,
              author: comment.author.id,
              content: comment.content,
              imageCid: comment.imageCid,
              createdAt: Number(comment.createdAt),
              status: comment.status,
            })
          })
        }
      })
      setOnChainComments(approved)
      return
    }

    // Chain fallback
    try {
      const contract = await getContract(false)
      const pending: OnChainComment[] = []
      const approved: OnChainComment[] = []

      for (const post of communityPosts) {
        const ids = await contract.getPendingCommentsByPost(post.id)

        for (const id of ids) {
          const c = await contract.getPendingComment(id)
          const item: OnChainComment = {
            id: c[0].toString(),
            postId: c[1].toString(),
            author: c[2],
            content: c[3],
            imageCid: c[4],
            createdAt: Number(c[5]),
            status: Number(c[6]),
          }

          if (item.status === 0) pending.push(item)
          if (item.status === 1) approved.push(item)
        }
      }

      setPendingComments(pending)
      setOnChainComments(approved)
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

  const saveLocalComments = (nextComments: SignedComment[]) => {
    const key = scopedStorageKey(COMMENTS_STORAGE_KEY)
    if (key) localStorage.setItem(key, JSON.stringify(nextComments))
    setComments(nextComments)
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

    setProfileGraphOffline(profile === null && activities === null)
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

      setTemporaryStatus(t('creatingCommunity'))
      await tx.wait()

      setNewCommunityName('')
      setNewCommunityDesc('')
      setShowCreateCommunityModal(false)
      const account = await getCurrentWalletAddress()
      await loadCommunities(account)
      setTemporaryStatus(t('communityCreated', { name: communityName }))
    } catch (error) {
      console.error('Community creation failed:', error)
      alert(t('createCommunityFailed'))
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
      const tx = await contract.createSubCommunity(selectedCommunityId, subName, metadataCID, description)

      setTemporaryStatus(t('creatingSub'))
      await tx.wait()

      setNewSubCommunityName('')
      setNewSubCommunityDesc('')
      setShowCreateSubCommunityModal(false)
      const account = await getCurrentWalletAddress()
      await loadCommunities(account)
      setTemporaryStatus(t('subCreated', { name: subName }))
    } catch (error) {
      console.error('Sub-community creation failed:', error)
      alert(t('subFailed'))
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
      alert(t('joinFailed'))
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

      setTemporaryStatus(t('postSent'))
      await tx.wait()

      setPostTitle('')
      setPostBody('')
      setPostTags('')
      setPostImages([])
      setShowCreatePost(false)
      await loadPosts(selectedCommunityId)
      await loadCommunities(liveStatus.account)
      await loadModeratorInfo(selectedCommunityId)
      setTemporaryStatus(flagged ? t('postSubmittedForReview') : t('postPublished'))
    } catch (error) {
      console.error('Post creation failed:', error)
      alert(t('postFailed'))
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
      alert(t('voteFailed'))
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
      alert(t('recommendationFailed'))
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
      alert(t('offerActionFailed'))
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
      alert(t('offerActionFailed'))
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
      alert(t('resignFailed'))
    }
  }

  const proposeRemoveModerator = async () => {
    if (!selectedCommunityId || !removeTargetInput.trim()) {
      alert(t('enterRemovalAddress'))
      return
    }

    const target = await resolveUserInput(removeTargetInput)
    if (!target) {
      alert(t('userNotFound'))
      return
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.proposeRemoveModerator(selectedCommunityId, target)
      setTemporaryStatus(t('removalSent'))
      await tx.wait()
      setRemoveTargetInput('')
      await loadCommunities()
      await loadModeratorInfo(selectedCommunityId)
    } catch (error) {
      console.error('Removal proposal failed:', error)
      alert(t('removalFailed'))
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
      alert(t('removalApprovalFailed'))
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
      alert(t('hideFailed'))
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
      alert(t('restoreFailed'))
    }
  }

  const decidePendingPost = async (postId: string, approved: boolean) => {
    try {
      const contract = await getContract(true)
      setTemporaryStatus(t('approvingItem'))
      const tx = approved ? await contract.approvePendingPost(postId) : await contract.rejectPendingPost(postId)
      await tx.wait()
      await loadPosts(selectedCommunityId)
      setTemporaryStatus(approved ? t('postApprovedToast') : t('postRejectedToast'))
    } catch (error) {
      console.error('Moderation decision failed:', error)
      alert(t('decisionFailed'))
    }
  }

  const decidePendingComment = async (commentId: string, approved: boolean) => {
    try {
      const contract = await getContract(true)
      setTemporaryStatus(t('approvingItem'))
      const tx = approved
        ? await contract.approvePendingComment(commentId)
        : await contract.rejectPendingComment(commentId)
      await tx.wait()
      await loadPosts(selectedCommunityId)
      setTemporaryStatus(approved ? t('commentApprovedToast') : t('commentRejectedToast'))
    } catch (error) {
      console.error('Moderation decision failed:', error)
      alert(t('decisionFailed'))
    }
  }

  // Sends a flagged comment on-chain for review (unlike clean comments, which
  // stay gas-free in localStorage).
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
      await tx.wait()

      setNewCommentByPost((previous) => ({ ...previous, [postId]: '' }))
      setCommentImageByPost((previous) => ({ ...previous, [postId]: undefined }))
      await loadPosts(selectedCommunityId)
      setTemporaryStatus(t('commentSubmittedForReview'))
    } catch (error) {
      console.error('Flagged comment submission failed:', error)
      alert(t('commentSubmitFailed'))
    }
  }

  const createOffChainComment = async (postId: string) => {
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

    // Image pinning happens before signing and has its own error message, so a
    // Pinata failure is never misreported as a MetaMask signing problem.
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
      const provider = getProvider()
      const signer = await provider.getSigner()
      const author = await signer.getAddress()
      const createdAt = Date.now()

      const message = JSON.stringify({
        app: 'Reppit',
        type: 'OFF_CHAIN_COMMENT',
        postId,
        author,
        content,
        createdAt,
        imageCid,
      })

      const signature = await signer.signMessage(message)
      const nextComments = [...comments, { postId, author, content, createdAt, message, signature, imageCid }]

      saveLocalComments(nextComments)
      setNewCommentByPost((previous) => ({ ...previous, [postId]: '' }))
      setCommentImageByPost((previous) => ({ ...previous, [postId]: undefined }))
      setTemporaryStatus(t('commentSaved'))
    } catch (error) {
      console.error('Off-chain comment failed:', error)
      alert(t('commentSignFailed'))
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
    setSelectedCommunityId(communityId)
    setView('community')
  }

  const openProfile = (address: string) => {
    setProfileAddress(address)
    setView('profile')
  }

  const usernamePolicyError = usernameInput.trim() ? validateUsername(usernameInput.trim()) : null

  const renderVoteBox = (postId: string) => {
    const voteInfo = votesByPost[postId] || { score: 0, myVote: 0 }

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
          className={`community-item ${view === 'community' && selectedCommunityId === community.id ? 'active' : ''}`}
          style={{ paddingInlineStart: `${0.75 + depth * 1.1}rem` }}
          onClick={() => openCommunity(community.id)}
        >
          <span className="community-avatar">{depth > 0 ? '↳' : 'r/'}</span>
          <span className="community-main">
            <strong>r/{community.name}</strong>
            <small>{t('membersLabel', { count: community.membersCount })}</small>
          </span>
          {community.isModerator && <span className="mini-badge mod">MOD</span>}
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
                    <p>{metadata.body}</p>
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
    if (pendingPosts.length === 0 && pendingComments.length === 0) return null

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
                    <p>{metadata.body}</p>
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
                  <p>{comment.content}</p>
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
            <textarea
              className="post-body-input"
              placeholder={t('postBodyPh')}
              value={postBody}
              onChange={(event) => setPostBody(event.target.value)}
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

          {visiblePosts.length === 0 ? (
            <div className="empty-state panel">
              <h3>{t('noPostsYet')}</h3>
              <p>{t('noPostsBody')}</p>
            </div>
          ) : (
            visiblePosts.map((post) => {
              const metadata = getPostMetadata(post)
              const postComments = commentsForPost(post.id)
              const chainComments = onChainCommentsForPost(post.id)
              const totalComments = postComments.length + chainComments.length
              const isSelected = selectedPost?.id === post.id

              return (
                <article
                  className={`post-card panel ${post.hidden && !post.pending ? 'hidden-post' : ''} ${isSelected ? 'selected' : ''}`}
                  key={post.id}
                >
                  {renderVoteBox(post.id)}
                  <div className="post-card-body">
                    <button className="post-content-button" onClick={() => setSelectedPostId(post.id)}>
                      <div className="post-main-content">
                        <div className="post-meta-line">
                          <span>r/{selectedCommunity.name}</span>
                          <span>·</span>
                          <span>{formatUser(post.author)}</span>
                          <span>·</span>
                          <span>{formatDate(post.createdAt)}</span>
                        </div>
                        <h3>{metadata.title}</h3>
                        <p>{metadata.body}</p>
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
                          <span>CID: {post.contentCID.slice(0, 18)}...</span>
                          {post.pending && <span className="badge warning">{t('pendingBadge')}</span>}
                          {post.rejected && <span className="badge danger">{t('rejectedBadge')}</span>}
                          {post.hidden && !post.pending && !post.rejected && (
                            <span className="badge danger">{t('hiddenBadge')}</span>
                          )}
                        </div>
                      </div>
                    </button>

                    {selectedCommunity.isModerator && !post.pending && !post.rejected && (
                      <div className="moderator-actions">
                        {post.hidden ? (
                          <button className="ghost-button" onClick={() => restorePost(post.id)}>
                            {t('restorePost')}
                          </button>
                        ) : (
                          <button className="danger-button" onClick={() => hidePost(post.id)}>
                            {t('hidePostButton')}
                          </button>
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
                              <div className="comment-item" key={`chain-${comment.id}`}>
                                <p>{comment.content}</p>
                                {comment.imageCid && <img className="post-image" src={ipfsUrl(comment.imageCid)} alt="" />}
                                <small>
                                  {formatUser(comment.author)} · {formatDate(comment.createdAt)} · {t('onChainComment')}
                                </small>
                              </div>
                            ))}
                            {postComments.map((comment, index) => (
                              <div className="comment-item" key={`${comment.signature}-${index}`}>
                                <p>{comment.content}</p>
                                {comment.imageCid && <img className="post-image" src={ipfsUrl(comment.imageCid)} alt="" />}
                                <small>
                                  {formatUser(comment.author)} · {formatDate(comment.createdAt)} · {t('signatureLabel')}{' '}
                                  {isCommentSignatureValid(comment) ? t('signatureValid') : t('signatureInvalid')}
                                </small>
                              </div>
                            ))}
                          </div>
                        )}

                        <textarea
                          placeholder={t('commentPh')}
                          value={newCommentByPost[post.id] || ''}
                          onChange={(event) =>
                            setNewCommentByPost((previous) => ({ ...previous, [post.id]: event.target.value }))
                          }
                        />
                        <label className="file-input-label">
                          {t('attachCommentImage')}
                          {commentImageByPost[post.id] && <span> ({commentImageByPost[post.id]?.name})</span>}
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
                        <button className="secondary-button full" onClick={() => createOffChainComment(post.id)}>
                          {t('sendComment')}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })
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
            <div className={`notification-item ${isRead ? '' : 'unread'}`} key={notification.id}>
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

                          {selectedCommunity.isMember && (
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
                          )}

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
                          <p>{getPostMetadata(selectedPost).body}</p>
                          <div className="details-grid">
                            <span>{t('postIdLabel')}</span>
                            <strong>#{selectedPost.id}</strong>
                            <span>{t('authorLabel')}</span>
                            <strong>{formatUser(selectedPost.author)}</strong>
                            <span>{t('scoreDetailLabel')}</span>
                            <strong>{votesByPost[selectedPost.id]?.score ?? 0}</strong>
                            <span>{t('commentsLabel')}</span>
                            <strong>{commentsForPost(selectedPost.id).length + onChainCommentsForPost(selectedPost.id).length}</strong>
                            <span>{t('storageLabel')}</span>
                            <strong>IPFS</strong>
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
              <textarea
                placeholder={t('communityDescPh')}
                value={newCommunityDesc}
                onChange={(event) => setNewCommunityDesc(event.target.value)}
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
              <textarea
                placeholder={t('subDescPh')}
                value={newSubCommunityDesc}
                onChange={(event) => setNewSubCommunityDesc(event.target.value)}
              />
              <button className="ghost-button full" onClick={createSubCommunity}>
                {t('createSubButton')}
              </button>
            </Modal>
          )}

          {showModeratorActionsModal && selectedCommunity && (
            <Modal title={t('moderatorActions')} onClose={() => setShowModeratorActionsModal(false)}>
              <div className="governance-tools">
                <p className="muted-text">{t('removalIntro')}</p>
                <input
                  type="text"
                  placeholder={t('removeAddrPh')}
                  value={removeTargetInput}
                  onChange={(event) => setRemoveTargetInput(event.target.value)}
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
                          <small>
                            {t('removalVoteProgress', { approvals: vote.approvals, required: vote.required })}
                          </small>
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
