import { BigInt, ethereum, Address } from '@graphprotocol/graph-ts'
import {
  CommunityCreated,
  SubCommunityCreated,
  CommunityJoined,
  CommunityLeft,
  PostCreated,
  PostVoted,
  PostHidden,
  PostRestored,
  ModeratorAdded,
  ModeratorRemoved,
  ModeratorRecommended,
  ModeratorOfferCreated,
  ModeratorResigned,
  RemoveModeratorProposalCreated,
  ActiveModeratorsUpdated,
  UsernameRegistered,
  UsernameChanged,
  UserBanned,
  UserUnbanned,
  PostSubmittedForReview,
  PendingPostApproved,
  PendingPostRejected,
  CommentCreated,
  CommentSubmittedForReview,
  PendingCommentApproved,
  PendingCommentRejected,
} from '../generated/DecentralizedForum/DecentralizedForum'
import { User, Community, Post, Vote, Activity, Notification, Comment, PendingComment } from '../generated/schema'

const EMPTY_ADDRESS = '0x0000000000000000000000000000000000000000'

const ZERO = BigInt.fromI32(0)
const ONE = BigInt.fromI32(1)

function getOrCreateUser(address: Address): User {
  const id = address.toHexString()
  let user = User.load(id)

  if (user == null) {
    user = new User(id)
    user.postCount = 0
    user.communitiesJoined = 0
    user.totalGasUsed = ZERO
    user.totalFeesWei = ZERO
    user.save()
  }

  return user
}

function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + '-' + event.logIndex.toString()
}

// Records the action in the user's activity feed and accumulates the gas the
// transaction burned onto their running totals.
function recordActivity(
  event: ethereum.Event,
  userAddress: Address,
  type: string,
  refId: BigInt,
  detail: string
): void {
  const user = getOrCreateUser(userAddress)

  let gasUsed = ZERO
  const receipt = event.receipt
  if (receipt != null) {
    gasUsed = receipt.gasUsed
  }
  const feeWei = gasUsed.times(event.transaction.gasPrice)

  // Only charge gas to the account that actually sent the transaction; events
  // can describe other users (e.g. the candidate in ModeratorAdded).
  if (event.transaction.from.equals(userAddress)) {
    user.totalGasUsed = user.totalGasUsed.plus(gasUsed)
    user.totalFeesWei = user.totalFeesWei.plus(feeWei)
    user.save()
  }

  const activity = new Activity(eventId(event) + '-' + type)
  activity.user = user.id
  activity.type = type
  activity.refId = refId
  activity.detail = detail
  activity.gasUsed = gasUsed
  activity.feeWei = feeWei
  activity.timestamp = event.block.timestamp
  activity.save()
}

function notify(
  event: ethereum.Event,
  recipient: Address,
  type: string,
  actor: Address,
  refId: BigInt,
  detail: string
): void {
  // Recipient is part of the id so one event can notify several moderators.
  const notification = new Notification(eventId(event) + '-' + type + '-' + recipient.toHexString())
  notification.recipient = getOrCreateUser(recipient).id
  notification.type = type
  notification.actor = getOrCreateUser(actor).id
  notification.refId = refId
  notification.detail = detail
  notification.timestamp = event.block.timestamp
  notification.save()
}

// Full moderator set: creator + appointed (tracked in community.moderators)
// plus the current automatic active pair.
function moderatorSet(community: Community): string[] {
  const all: string[] = []

  const base = community.moderators
  for (let i = 0; i < base.length; i++) {
    if (!all.includes(base[i])) all.push(base[i])
  }

  const active1 = community.activeModerator1
  if (active1 !== null && !all.includes(active1)) all.push(active1)

  const active2 = community.activeModerator2
  if (active2 !== null && !all.includes(active2)) all.push(active2)

  return all
}

function notifyModerators(
  event: ethereum.Event,
  community: Community,
  type: string,
  actor: Address,
  refId: BigInt,
  detail: string
): void {
  const mods = moderatorSet(community)

  for (let i = 0; i < mods.length; i++) {
    const recipient = Address.fromString(mods[i])
    if (!recipient.equals(actor)) {
      notify(event, recipient, type, actor, refId, detail)
    }
  }
}

function splitTags(tags: string): string[] {
  const parts = tags.split(',')
  const cleaned: string[] = []

  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length > 0) {
      cleaned.push(parts[i])
    }
  }

  return cleaned
}

export function handleCommunityCreated(event: CommunityCreated): void {
  const creator = getOrCreateUser(event.params.creator)

  const community = new Community(event.params.communityId.toString())
  community.name = event.params.name
  community.description = event.params.description
  community.creator = creator.id
  community.membersCount = ONE
  community.createdAt = event.params.createdAt
  community.moderators = [creator.id]
  community.save()

  recordActivity(event, event.params.creator, 'COMMUNITY_CREATED', event.params.communityId, event.params.name)
}

export function handleSubCommunityCreated(event: SubCommunityCreated): void {
  const community = Community.load(event.params.communityId.toString())

  if (community != null) {
    community.parent = event.params.parentCommunityId.toString()
    community.save()
  }

  recordActivity(event, event.params.creator, 'SUBCOMMUNITY_CREATED', event.params.communityId, event.params.name)
}

export function handleCommunityJoined(event: CommunityJoined): void {
  const user = getOrCreateUser(event.params.member)
  user.communitiesJoined = user.communitiesJoined + 1
  user.save()

  const community = Community.load(event.params.communityId.toString())
  if (community != null) {
    // The creator's implicit join is already counted at creation time.
    if (community.creator != user.id) {
      community.membersCount = community.membersCount.plus(ONE)
      community.save()
    }
  }

  recordActivity(event, event.params.member, 'COMMUNITY_JOINED', event.params.communityId, '')
}

export function handleCommunityLeft(event: CommunityLeft): void {
  const user = getOrCreateUser(event.params.member)
  if (user.communitiesJoined > 0) {
    user.communitiesJoined = user.communitiesJoined - 1
    user.save()
  }

  const community = Community.load(event.params.communityId.toString())
  if (community != null && community.membersCount.gt(ZERO)) {
    community.membersCount = community.membersCount.minus(ONE)
    community.save()
  }

  recordActivity(event, event.params.member, 'COMMUNITY_LEFT', event.params.communityId, '')
}

export function handlePostCreated(event: PostCreated): void {
  const author = getOrCreateUser(event.params.author)
  author.postCount = author.postCount + 1
  author.save()

  const post = new Post(event.params.postId.toString())
  post.community = event.params.communityId.toString()
  post.author = author.id
  post.contentCID = event.params.contentCID
  post.title = event.params.title
  post.tags = splitTags(event.params.tags)
  post.tagsText = event.params.tags
  post.score = ZERO
  post.upvotes = ZERO
  post.downvotes = ZERO
  post.hidden = false
  post.pending = false
  post.rejected = false
  post.createdAt = event.params.createdAt
  post.save()

  recordActivity(event, event.params.author, 'POST_CREATED', event.params.postId, event.params.title)
}

export function handlePostVoted(event: PostVoted): void {
  const post = Post.load(event.params.postId.toString())
  if (post == null) {
    return
  }

  const voteId = event.params.postId.toString() + '-' + event.params.voter.toHexString()
  let vote = Vote.load(voteId)
  let previousValue = 0

  if (vote == null) {
    vote = new Vote(voteId)
    vote.post = post.id
    vote.voter = getOrCreateUser(event.params.voter).id
  } else {
    previousValue = vote.value
  }

  const newValue = event.params.vote

  if (previousValue == 1) {
    post.upvotes = post.upvotes.minus(ONE)
  } else if (previousValue == -1) {
    post.downvotes = post.downvotes.minus(ONE)
  }

  if (newValue == 1) {
    post.upvotes = post.upvotes.plus(ONE)
  } else if (newValue == -1) {
    post.downvotes = post.downvotes.plus(ONE)
  }

  post.score = event.params.newScore
  post.save()

  vote.value = newValue
  vote.updatedAt = event.params.votedAt
  vote.save()

  recordActivity(event, event.params.voter, 'POST_VOTED', event.params.postId, newValue.toString())

  // Tell the author, but not about their own votes.
  const authorAddress = Address.fromString(post.author)
  if (!authorAddress.equals(event.params.voter)) {
    if (newValue == 1) {
      notify(event, authorAddress, 'POST_UPVOTED', event.params.voter, event.params.postId, post.title)
    } else if (newValue == -1) {
      notify(event, authorAddress, 'POST_DOWNVOTED', event.params.voter, event.params.postId, post.title)
    }
  }
}

export function handlePostHidden(event: PostHidden): void {
  const post = Post.load(event.params.postId.toString())
  if (post == null) {
    return
  }

  post.hidden = true
  post.save()

  recordActivity(event, event.params.hiddenBy, 'POST_HIDDEN', event.params.postId, post.title)

  const authorAddress = Address.fromString(post.author)
  if (!authorAddress.equals(event.params.hiddenBy)) {
    notify(event, authorAddress, 'POST_HIDDEN', event.params.hiddenBy, event.params.postId, post.title)
  }
}

export function handlePostRestored(event: PostRestored): void {
  const post = Post.load(event.params.postId.toString())
  if (post == null) {
    return
  }

  post.hidden = false
  post.save()

  recordActivity(event, event.params.restoredBy, 'POST_RESTORED', event.params.postId, post.title)
}

export function handleModeratorAdded(event: ModeratorAdded): void {
  const community = Community.load(event.params.communityId.toString())
  if (community != null) {
    const moderatorId = event.params.moderator.toHexString()
    const mods = community.moderators
    if (!mods.includes(moderatorId)) {
      mods.push(moderatorId)
      community.moderators = mods
      community.save()
    }
  }

  recordActivity(event, event.params.moderator, 'BECAME_MODERATOR', event.params.communityId, '')

  if (!event.params.moderator.equals(event.params.addedBy)) {
    notify(event, event.params.moderator, 'BECAME_MODERATOR', event.params.addedBy, event.params.communityId, '')
  }
}

export function handleModeratorRemoved(event: ModeratorRemoved): void {
  const community = Community.load(event.params.communityId.toString())
  if (community != null) {
    const moderatorId = event.params.moderator.toHexString()
    const mods: string[] = []
    const current = community.moderators
    for (let i = 0; i < current.length; i++) {
      if (current[i] != moderatorId) mods.push(current[i])
    }
    community.moderators = mods
    community.save()
  }

  recordActivity(event, event.params.moderator, 'MODERATOR_REMOVED', event.params.communityId, '')

  if (!event.params.moderator.equals(event.params.removedBy)) {
    notify(event, event.params.moderator, 'MODERATOR_REMOVED', event.params.removedBy, event.params.communityId, '')
  }
}

export function handleModeratorRecommended(event: ModeratorRecommended): void {
  recordActivity(
    event,
    event.params.recommender,
    'MODERATOR_RECOMMENDED',
    event.params.communityId,
    event.params.candidate.toHexString()
  )
}

// 3 recommendations reached: the candidate must now accept or decline.
export function handleModeratorOfferCreated(event: ModeratorOfferCreated): void {
  const community = Community.load(event.params.communityId.toString())
  const detail = community != null ? community.name : ''

  notify(
    event,
    event.params.candidate,
    'MODERATOR_OFFER',
    event.params.candidate,
    event.params.communityId,
    detail
  )
}

export function handleModeratorResigned(event: ModeratorResigned): void {
  recordActivity(event, event.params.moderator, 'MODERATOR_RESIGNED', event.params.communityId, '')
}

// A removal vote opened: every moderator (except the proposer) is asked to weigh in.
export function handleRemoveModeratorProposalCreated(event: RemoveModeratorProposalCreated): void {
  const community = Community.load(event.params.communityId.toString())
  if (community == null) return

  notifyModerators(
    event,
    community,
    'REMOVAL_VOTE_PENDING',
    event.params.proposer,
    event.params.proposalId,
    event.params.target.toHexString()
  )
}

export function handleActiveModeratorsUpdated(event: ActiveModeratorsUpdated): void {
  const community = Community.load(event.params.communityId.toString())
  if (community == null) return

  const first = event.params.firstActiveModerator.toHexString()
  const second = event.params.secondActiveModerator.toHexString()

  community.activeModerator1 = first == EMPTY_ADDRESS ? null : first
  community.activeModerator2 = second == EMPTY_ADDRESS ? null : second
  community.save()
}

export function handlePostSubmittedForReview(event: PostSubmittedForReview): void {
  const post = Post.load(event.params.postId.toString())
  if (post == null) return

  post.pending = true
  post.hidden = true
  post.save()

  const community = Community.load(post.community)
  if (community != null) {
    notifyModerators(
      event,
      community,
      'POST_PENDING_REVIEW',
      event.params.author,
      event.params.postId,
      event.params.title
    )
  }
}

export function handlePendingPostApproved(event: PendingPostApproved): void {
  const post = Post.load(event.params.postId.toString())
  if (post == null) return

  post.pending = false
  post.hidden = false
  post.save()

  recordActivity(event, event.params.moderator, 'POST_REVIEWED', event.params.postId, 'approved: ' + post.title)

  const author = Address.fromString(post.author)
  if (!author.equals(event.params.moderator)) {
    notify(event, author, 'POST_APPROVED', event.params.moderator, event.params.postId, post.title)
  }
}

export function handlePendingPostRejected(event: PendingPostRejected): void {
  const post = Post.load(event.params.postId.toString())
  if (post == null) return

  post.pending = false
  post.rejected = true
  post.save()

  recordActivity(event, event.params.moderator, 'POST_REVIEWED', event.params.postId, 'rejected: ' + post.title)

  const author = Address.fromString(post.author)
  if (!author.equals(event.params.moderator)) {
    notify(event, author, 'POST_REJECTED', event.params.moderator, event.params.postId, post.title)
  }
}

export function handleCommentCreated(event: CommentCreated): void {
  const comment = new Comment(event.params.commentId.toString())
  comment.post = event.params.postId.toString()
  comment.community = event.params.communityId.toString()
  comment.author = getOrCreateUser(event.params.author).id
  comment.content = event.params.content
  comment.imageCid = event.params.imageCid
  comment.createdAt = event.params.createdAt
  comment.save()

  recordActivity(event, event.params.author, 'COMMENT_CREATED', event.params.postId, event.params.content)

  // Notify the post author (unless they commented on their own post). Works
  // cross-machine now that comments live on-chain.
  const post = Post.load(event.params.postId.toString())
  if (post != null) {
    const author = Address.fromString(post.author)
    if (!author.equals(event.params.author)) {
      notify(event, author, 'COMMENT_REPLY', event.params.author, event.params.postId, event.params.content)
    }
  }
}

export function handleCommentSubmittedForReview(event: CommentSubmittedForReview): void {
  const comment = new PendingComment(event.params.commentId.toString())
  comment.post = event.params.postId.toString()
  comment.community = event.params.communityId.toString()
  comment.author = getOrCreateUser(event.params.author).id
  comment.content = event.params.content
  comment.imageCid = event.params.imageCid
  comment.status = 0
  comment.createdAt = event.params.submittedAt
  comment.save()

  recordActivity(event, event.params.author, 'COMMENT_SUBMITTED', event.params.postId, event.params.content)

  const community = Community.load(event.params.communityId.toString())
  if (community != null) {
    notifyModerators(
      event,
      community,
      'COMMENT_PENDING_REVIEW',
      event.params.author,
      event.params.postId,
      event.params.content
    )
  }
}

export function handlePendingCommentApproved(event: PendingCommentApproved): void {
  const comment = PendingComment.load(event.params.commentId.toString())
  if (comment == null) return

  comment.status = 1
  comment.save()

  recordActivity(event, event.params.moderator, 'COMMENT_REVIEWED', event.params.commentId, 'approved')

  const author = Address.fromString(comment.author)
  if (!author.equals(event.params.moderator)) {
    notify(event, author, 'COMMENT_APPROVED', event.params.moderator, event.params.postId, comment.content)
  }
}

export function handlePendingCommentRejected(event: PendingCommentRejected): void {
  const comment = PendingComment.load(event.params.commentId.toString())
  if (comment == null) return

  comment.status = 2
  comment.save()

  recordActivity(event, event.params.moderator, 'COMMENT_REVIEWED', event.params.commentId, 'rejected')

  const author = Address.fromString(comment.author)
  if (!author.equals(event.params.moderator)) {
    notify(event, author, 'COMMENT_REJECTED', event.params.moderator, event.params.postId, comment.content)
  }
}

export function handleUsernameRegistered(event: UsernameRegistered): void {
  const user = getOrCreateUser(event.params.user)
  user.username = event.params.username
  user.registeredAt = event.params.registeredAt
  user.save()

  recordActivity(event, event.params.user, 'USERNAME_REGISTERED', ZERO, event.params.username)
}

export function handleUsernameChanged(event: UsernameChanged): void {
  const user = getOrCreateUser(event.params.user)
  user.username = event.params.newUsername
  user.save()

  recordActivity(
    event,
    event.params.user,
    'USERNAME_CHANGED',
    ZERO,
    event.params.oldUsername + ' -> ' + event.params.newUsername
  )
}

export function handleUserBanned(event: UserBanned): void {
  recordActivity(event, event.params.bannedBy, 'USER_BANNED', event.params.communityId, event.params.user.toHexString())
  notify(event, event.params.user, 'BANNED', event.params.bannedBy, event.params.communityId, '')
}

export function handleUserUnbanned(event: UserUnbanned): void {
  recordActivity(event, event.params.unbannedBy, 'USER_UNBANNED', event.params.communityId, event.params.user.toHexString())
  notify(event, event.params.user, 'UNBANNED', event.params.unbannedBy, event.params.communityId, '')
}
