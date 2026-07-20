// Composition root for forum state.
//
// Each domain lives in its own hook under ./forum. This file wires them
// together, owns the small amount of genuinely cross-cutting state (current
// view, selection, the safety-review prompt), runs the effects that span more
// than one domain, and binds the currently-selected community into the actions
// so components can keep calling e.g. `hidePost(id)`.
//
// Dependency direction: domain hooks depend on `core` (translate, contracts,
// status) and on loaders passed into them. The hook call order below is a
// topological sort of that graph - each hook only ever receives loaders from
// hooks already constructed above it, so there are no forward references and
// no late binding. Moderation is split into a dependency-free roster (read)
// and actions (write, needs loadPosts/loadCommunities) precisely to keep it
// that way; merging them back would reintroduce a cycle.
import { useEffect, useMemo, useState } from 'react'
import { checkContentSafety } from '@/lib/contentSafety'
import { formatDate as formatDateWithLang, isTempId } from '@/lib/format'
import { useWallet } from '@/features/wallet/useWallet'
import type { ReviewPrompt, View } from '@/types/forum'
import type { ForumCore } from './forum/core'
import { useLanguage } from './forum/useLanguage'
import { useStatusMessages } from './forum/useStatusMessages'
import { useContracts } from './forum/useContracts'
import { useIpfsMetadata } from './forum/useIpfsMetadata'
import { useScopedStorage } from './forum/useScopedStorage'
import { useUsernameDirectory } from './forum/useUsernameDirectory'
import { useVotes } from './forum/useVotes'
import { useReports } from './forum/useReports'
import { useOnChainComments } from './forum/useOnChainComments'
import { useModeratorRoster } from './forum/useModeratorRoster'
import { useModerationActions } from './forum/useModerationActions'
import { useCommunities } from './forum/useCommunities'
import { usePosts } from './forum/usePosts'
import { useTrending } from './forum/useTrending'
import { useNotifications } from './forum/useNotifications'
import { useProfile } from './forum/useProfile'
import { useSearch } from './forum/useSearch'
import { useFeedPagination } from './forum/useFeedPagination'
import { useModeratorEvents } from './forum/useModeratorEvents'

export function useForumState() {
  const { lang, setLang, t } = useLanguage()
  const { walletAddress, getProvider, getCurrentWalletAddress, connect, disconnect } = useWallet()
  const { statusMessage, modNotification, setTemporaryStatus, flashModNotification, failWith } = useStatusMessages(t)

  // --- Cross-cutting UI state ----------------------------------------------
  const [view, setView] = useState<View>('home')
  const [selectedCommunityId, setSelectedCommunityId] = useState('')
  const [selectedPostId, setSelectedPostId] = useState('')
  const [openKebabId, setOpenKebabId] = useState<string | null>(null)
  const [reviewPrompt, setReviewPrompt] = useState<ReviewPrompt | null>(null)

  const { contractAddress, getContract, getLiveMembershipStatus } = useContracts({
    t,
    getProvider,
    getCurrentWalletAddress,
    setTemporaryStatus,
  })

  const core: ForumCore = {
    t,
    walletAddress,
    getProvider,
    getCurrentWalletAddress,
    getContract,
    setTemporaryStatus,
    failWith,
  }

  // Hook order below is the topological sort - do not reorder casually.

  // 1. Leaves: depend on nothing but core.
  const ipfs = useIpfsMetadata()
  const storage = useScopedStorage({ t, walletAddress, getProvider, setTemporaryStatus })
  const votes = useVotes(core)
  const reports = useReports(core)
  const comments = useOnChainComments(core)
  const roster = useModeratorRoster(core)

  // 2. Notifications -> profile -> usernames (a rename refreshes the profile).
  const notifications = useNotifications({
    t,
    readStoredComments: storage.readStoredComments,
    readNotificationIds: storage.readNotificationIds,
    markNotificationsRead: storage.markNotificationsRead,
  })

  const profile = useProfile({ walletAddress, loadNotifications: notifications.loadNotifications })

  const usernames = useUsernameDirectory(core, () => {
    if (view === 'profile') void profile.loadProfileData(profile.profileAddress)
  })

  // 3. Communities, then posts (posts fan out into votes/comments/reports).
  const communities = useCommunities(core, {
    publishToIpfs: ipfs.publishToIpfs,
    loadModeratorInfo: roster.loadModeratorInfo,
  })

  const posts = usePosts(core, {
    publishToIpfs: ipfs.publishToIpfs,
    loadVotesFor: votes.loadVotesFor,
    loadOnChainComments: comments.loadOnChainComments,
    loadReports: reports.loadReports,
    loadCommunities: communities.loadCommunities,
    loadModeratorInfo: roster.loadModeratorInfo,
    getLiveMembershipStatus,
  })

  // 4. Everything that consumes the loaders above.
  const moderation = useModerationActions(core, {
    resolveUserInput: usernames.resolveUserInput,
    loadCommunities: communities.loadCommunities,
    loadPosts: posts.loadPosts,
    loadModeratorInfo: roster.loadModeratorInfo,
  })

  const trending = useTrending(core, { communities: communities.communities, loadVotesFor: votes.loadVotesFor })

  const search = useSearch({
    communities: communities.communities,
    getCommunityDescription: ipfs.getCommunityDescription,
    setView,
  })

  const selectedCommunity = communities.communities.find((community) => community.id === selectedCommunityId)

  const feed = useFeedPagination({
    posts: posts.posts,
    hiddenForMe: storage.hiddenForMe,
    showHiddenForMe: storage.showHiddenForMe,
    selectedCommunity,
    selectedCommunityId,
    myAddress: walletAddress.toLowerCase(),
  })

  // Strictly explicit selection: clicking a post expands it, clicking again
  // collapses it (no implicit fallback to the first post).
  const selectedPost = feed.visiblePosts.find((post) => post.id === selectedPostId)

  const bellCount =
    notifications.unreadNotificationsCount + communities.moderatorOffers.length + communities.pendingRemovalVotes.length

  useModeratorEvents({
    t,
    walletAddress,
    contractAddress,
    lang,
    knownModeratorCommunities: communities.knownModeratorCommunities,
    getCommunityName: communities.getCommunityName,
    flashModNotification,
    refreshAfterRoleChange: (account) => {
      communities.loadCommunities(account)
      notifications.loadNotifications(account)
    },
  })

  // --- Cross-cutting effects ------------------------------------------------

  useEffect(() => {
    if (walletAddress) {
      communities.loadCommunities(walletAddress, true)
      usernames.loadUsername(walletAddress)
    }
  }, [walletAddress])

  useEffect(() => {
    if (walletAddress && storage.storageScope) {
      notifications.loadNotifications(walletAddress)
    }
  }, [walletAddress, storage.storageScope])

  // Without polling, votes/comments made by others while the tab is open never
  // reach the bell — the author had to reload to see them.
  useEffect(() => {
    if (!walletAddress || !storage.storageScope) return
    const interval = setInterval(() => notifications.loadNotifications(walletAddress), 30_000)
    return () => clearInterval(interval)
  }, [walletAddress, storage.storageScope])

  // Clicking anywhere outside a kebab menu closes it.
  useEffect(() => {
    if (!openKebabId) return
    const close = () => setOpenKebabId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openKebabId])

  // Resolve a display name for every address currently on screen.
  useEffect(() => {
    const addresses = new Set<string>()
    communities.communities.forEach((community) => addresses.add(community.creator))
    posts.posts.forEach((post) => addresses.add(post.author))
    roster.moderators.forEach((moderator) => addresses.add(moderator.address))
    roster.topActiveUsers.forEach((address) => addresses.add(address))
    storage.comments.forEach((comment) => addresses.add(comment.author))
    trending.trendingPosts.forEach((post) => addresses.add(post.author))
    comments.onChainComments.forEach((comment) => addresses.add(comment.author))
    comments.pendingComments.forEach((comment) => addresses.add(comment.author))
    addresses.forEach(usernames.fetchUsername)
  }, [
    communities.communities,
    posts.posts,
    roster.moderators,
    roster.topActiveUsers,
    storage.comments,
    trending.trendingPosts,
    comments.onChainComments,
    comments.pendingComments,
  ])

  // Collapse any expanded post when the community changes. Adjusted during
  // render rather than in the effect below, so the old selection never renders
  // against the new community's feed.
  const [lastCommunityId, setLastCommunityId] = useState(selectedCommunityId)
  if (selectedCommunityId !== lastCommunityId) {
    setLastCommunityId(selectedCommunityId)
    setSelectedPostId('')
  }

  useEffect(() => {
    if (selectedCommunityId) {
      posts.loadPosts(selectedCommunityId)
      roster.loadModeratorInfo(selectedCommunityId)
    } else {
      posts.setPosts([])
      roster.clearModerators()
      comments.clearComments()
    }
  }, [selectedCommunityId])

  useEffect(() => {
    if (view === 'home' && walletAddress) {
      trending.loadTrending()
    }
  }, [view, walletAddress])

  useEffect(() => {
    if (view === 'profile' && profile.profileAddress) {
      profile.loadProfileData(profile.profileAddress)
    }
  }, [view, profile.profileAddress])

  useEffect(() => {
    communities.communities.forEach((community) => ipfs.fetchIpfsMetadata(community.metadataCID))
  }, [communities.communities])

  useEffect(() => {
    posts.posts.forEach((post) => ipfs.fetchIpfsMetadata(post.contentCID))
  }, [posts.posts])

  useEffect(() => {
    trending.trendingPosts.forEach((post) => ipfs.fetchIpfsMetadata(post.contentCID))
  }, [trending.trendingPosts])

  // --- Actions that span domains -------------------------------------------

  // walletAddress changing (set inside WalletProvider) already triggers the
  // loadCommunities/loadUsername effect above, so this just requests accounts
  // and surfaces a translated error - the unsupported-network case is already
  // handled by resolveAddresses's own status message.
  const handleConnectWallet = async () => {
    try {
      await connect()
      setTemporaryStatus(t('walletConnected'))
    } catch (error) {
      console.error('Wallet connection failed:', error)
      alert(t('connectFailed'))
    }
  }

  const createPost = async () => {
    if (!selectedCommunityId || !posts.postTitle.trim() || !posts.postBody.trim()) {
      alert(t('fillPostFields'))
      return
    }

    const safety = checkContentSafety(`${posts.postTitle} ${posts.postBody} ${posts.postTags}`)

    if (!safety.safe) {
      setReviewPrompt({ kind: 'post', selfHarm: safety.selfHarm })
      return
    }

    await posts.submitPost(selectedCommunityId, false)
  }

  // Clean comments go straight on-chain (addComment) so every site instance
  // sees them; unsafe ones are routed into the moderator queue instead.
  const submitComment = async (postId: string) => {
    const content = (comments.newCommentByPost[postId] || '').trim()

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

    const imageCid = await comments.uploadCommentImage(postId)
    if (imageCid === null) return

    try {
      const contract = await getContract(true, 'moderation')
      const tx = await contract.addComment(postId, content, imageCid)

      const account = liveStatus.account
      const communityId = selectedCommunityId

      // Show the comment the instant the tx is submitted - the content is what
      // the user just typed, so nothing needs to be fetched.
      comments.addOptimisticComment(postId, account, content, imageCid)
      comments.clearCommentDraft(postId)
      setTemporaryStatus(t('commentConfirming'))

      void posts.reconcileAfterTx(tx, communityId, account, t('commentPostedOnChain'), 'commentSubmitFailed')
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
      await posts.submitPost(selectedCommunityId, true)
    } else {
      await comments.submitFlaggedComment(prompt.postId, () => posts.loadPosts(selectedCommunityId))
    }
  }

  const openCommunity = (communityId: string) => {
    // A community that is still confirming on-chain has no real id to query yet.
    if (isTempId(communityId)) return
    // Re-clicking the current community won't re-fire the load effect (state
    // unchanged), so refresh explicitly - it doubles as a manual refresh.
    if (communityId === selectedCommunityId) {
      posts.loadPosts(communityId)
      roster.loadModeratorInfo(communityId)
    }
    setSelectedCommunityId(communityId)
    setView('community')
  }

  const openProfile = (address: string) => {
    profile.setProfileAddress(address)
    setView('profile')
  }

  // --- Display helpers bound to current state/language ----------------------

  const formatDate = (timestamp: string | number) => formatDateWithLang(timestamp, lang)

  const commentsForPost = useMemo(
    () => (postId: string) => storage.comments.filter((comment) => comment.postId === postId),
    [storage.comments],
  )

  const onChainCommentsForPost = useMemo(
    () => (postId: string) => comments.onChainComments.filter((comment) => comment.postId === postId),
    [comments.onChainComments],
  )

  return {
    // language
    lang,
    setLang,
    t,

    // wallet
    walletAddress,
    disconnect,
    handleConnectWallet,

    // navigation / chrome
    view,
    setView,
    statusMessage,
    modNotification,
    searchQuery: search.searchQuery,
    setSearchQuery: search.setSearchQuery,
    openKebabId,
    setOpenKebabId,

    // username
    username: usernames.username,
    usernameInput: usernames.usernameInput,
    setUsernameInput: usernames.setUsernameInput,
    usernameAvailable: usernames.usernameAvailable,
    usernamePolicyError: usernames.usernamePolicyError,
    changeCooldownRemaining: usernames.changeCooldownRemaining,
    setChangeCooldownRemaining: usernames.setChangeCooldownRemaining,
    showUsernameModal: usernames.showUsernameModal,
    showChangeUsernameModal: usernames.showChangeUsernameModal,
    setShowChangeUsernameModal: usernames.setShowChangeUsernameModal,
    submitUsername: usernames.submitUsername,
    submitUsernameChange: usernames.submitUsernameChange,
    getContract,

    // communities
    communities: communities.communities,
    communitiesByParent: communities.communitiesByParent,
    rootCommunities: communities.rootCommunities,
    selectedCommunity,
    selectedCommunityId,
    openCommunity,
    joinCommunity: communities.joinCommunity,
    leaveCommunity: communities.leaveCommunity,
    getCommunityDescription: ipfs.getCommunityDescription,
    newCommunityName: communities.newCommunityName,
    setNewCommunityName: communities.setNewCommunityName,
    newCommunityDesc: communities.newCommunityDesc,
    setNewCommunityDesc: communities.setNewCommunityDesc,
    showCreateCommunityModal: communities.showCreateCommunityModal,
    setShowCreateCommunityModal: communities.setShowCreateCommunityModal,
    createCommunity: communities.createCommunity,
    newSubCommunityName: communities.newSubCommunityName,
    setNewSubCommunityName: communities.setNewSubCommunityName,
    newSubCommunityDesc: communities.newSubCommunityDesc,
    setNewSubCommunityDesc: communities.setNewSubCommunityDesc,
    showCreateSubCommunityModal: communities.showCreateSubCommunityModal,
    setShowCreateSubCommunityModal: communities.setShowCreateSubCommunityModal,
    createSubCommunity: () => communities.createSubCommunity(selectedCommunityId),

    // posts + feed
    visiblePosts: feed.visiblePosts,
    pagedPosts: feed.pagedPosts,
    pageCount: feed.pageCount,
    feedPage: feed.feedPage,
    setFeedPage: feed.setFeedPage,
    postsPerPage: feed.postsPerPage,
    setPostsPerPage: feed.setPostsPerPage,
    selectedPost,
    setSelectedPostId,
    getPostMetadata: ipfs.getPostMetadata,
    hiddenForMe: storage.hiddenForMe,
    hiddenForMeCount: feed.hiddenForMeCount,
    showHiddenForMe: storage.showHiddenForMe,
    setShowHiddenForMe: storage.setShowHiddenForMe,
    hidePostForMe: (postId: string) =>
      storage.hidePostForMe(postId, (hidden) => {
        if (selectedPostId === hidden) setSelectedPostId('')
      }),
    unhidePostForMe: storage.unhidePostForMe,

    // post composer
    showCreatePost: posts.showCreatePost,
    setShowCreatePost: posts.setShowCreatePost,
    postTitle: posts.postTitle,
    setPostTitle: posts.setPostTitle,
    postBody: posts.postBody,
    setPostBody: posts.setPostBody,
    postTags: posts.postTags,
    setPostTags: posts.setPostTags,
    postImages: posts.postImages,
    setPostImages: posts.setPostImages,
    uploadingMedia: posts.uploadingMedia,
    createPost,

    // votes + trending
    votesByPost: votes.votesByPost,
    castVote: votes.castVote,
    rankedTrending: trending.rankedTrending,
    trendingSource: trending.trendingSource,

    // comments
    newCommentByPost: comments.newCommentByPost,
    setNewCommentByPost: comments.setNewCommentByPost,
    commentImageByPost: comments.commentImageByPost,
    setCommentImageByPost: comments.setCommentImageByPost,
    commentsForPost,
    onChainCommentsForPost,
    submitComment,

    // moderation
    moderators: roster.moderators,
    topActiveUsers: roster.topActiveUsers,
    pendingPosts: feed.pendingPosts,
    pendingComments: comments.pendingComments,
    reports: reports.reports,
    decidePendingPost: (postId: string, approved: boolean) =>
      moderation.decidePendingPost(postId, selectedCommunityId, approved),
    decidePendingComment: (commentId: string, approved: boolean) =>
      moderation.decidePendingComment(commentId, selectedCommunityId, approved),
    resolveReport: (kind: 0 | 1, refId: string, action: 0 | 1) =>
      reports.resolveReport(selectedCommunityId, kind, refId, action),
    hidePost: (postId: string) => posts.hidePost(postId, selectedCommunityId),
    restorePost: (postId: string) => posts.restorePost(postId, selectedCommunityId),
    setPostLock: (postId: string, lock: boolean) => posts.setPostLock(postId, selectedCommunityId, lock),
    hideChainComment: (commentId: string) => moderation.hideChainComment(commentId, selectedCommunityId),
    showModeratorActionsModal: moderation.showModeratorActionsModal,
    setShowModeratorActionsModal: moderation.setShowModeratorActionsModal,
    recommendInput: moderation.recommendInput,
    setRecommendInput: moderation.setRecommendInput,
    recommendModerator: () => moderation.recommendModerator(selectedCommunityId),
    removeTargetInput: moderation.removeTargetInput,
    setRemoveTargetInput: moderation.setRemoveTargetInput,
    removeReasonInput: moderation.removeReasonInput,
    setRemoveReasonInput: moderation.setRemoveReasonInput,
    proposeRemoveModerator: () => moderation.proposeRemoveModerator(selectedCommunityId),
    banTargetInput: moderation.banTargetInput,
    setBanTargetInput: moderation.setBanTargetInput,
    banReasonInput: moderation.banReasonInput,
    setBanReasonInput: moderation.setBanReasonInput,
    banMember: () => moderation.banMember(selectedCommunityId),
    resignFromModeration: (communityId: string, communityName: string) =>
      moderation.resignFromModeration(communityId, communityName, selectedCommunityId),
    removalVotes: communities.removalVotes,
    approveRemovalVote: (proposalId: string) => moderation.approveRemovalVote(proposalId, selectedCommunityId),
    moderatorOffers: communities.moderatorOffers,
    acceptModeratorOffer: (communityId: string) =>
      moderation.acceptModeratorOffer(communityId, selectedCommunityId),
    declineModeratorOffer: moderation.declineModeratorOffer,

    // reporting
    reportTarget: reports.reportTarget,
    setReportTarget: reports.setReportTarget,
    reportReason: reports.reportReason,
    setReportReason: reports.setReportReason,
    submitReport: () => reports.submitReport(selectedCommunityId),

    // safety review prompt
    reviewPrompt,
    setReviewPrompt,
    confirmReviewSubmission,

    // notifications
    notifications: notifications.notifications,
    readNotificationIds: storage.readNotificationIds,
    markNotificationRead: storage.markNotificationRead,
    markAllNotificationsRead: notifications.markAllNotificationsRead,
    showNotificationsPanel: notifications.showNotificationsPanel,
    setShowNotificationsPanel: notifications.setShowNotificationsPanel,
    bellCount,

    // profile
    usernamesCache: usernames.usernamesCache,
    profileAddress: profile.profileAddress,
    profileData: profile.profileData,
    profileActivities: profile.profileActivities,
    profileGraphOffline: profile.profileGraphOffline,
    openProfile,

    // search
    searchFilter: search.searchFilter,
    setSearchFilter: search.setSearchFilter,
    searchResults: search.searchResults,
    searchLoading: search.searchLoading,
    activeSearchTerm: search.activeSearchTerm,
    runSearch: search.runSearch,

    // display helpers
    formatUser: usernames.formatUser,
    formatDate,
    notifLabel: notifications.notifLabel,
    activityLabel: notifications.activityLabel,
  }
}
