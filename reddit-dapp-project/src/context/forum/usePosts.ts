import { useState } from 'react'
import { ethers } from 'ethers'
import { addFile } from '@/services/ipfs'
import { waitForGraphBlock } from '@/services/graph'
import type { TranslationKey } from '@/lib/i18n'
import type { ForumCore } from './core'
import type { IpfsMetadataRecord, Post } from '@/types/forum'

type Options = {
  publishToIpfs: (metadata: IpfsMetadataRecord) => Promise<string>
  loadVotesFor: (postIds: string[]) => Promise<void>
  loadOnChainComments: (communityId: string, communityPosts: Post[]) => Promise<void>
  loadReports: (communityId: string) => Promise<void>
  loadCommunities: (account?: string) => Promise<void>
  loadModeratorInfo: (communityId: string) => Promise<void>
  getLiveMembershipStatus: (communityId: string) => Promise<{ account: string; isMember: boolean; isBanned: boolean }>
}

/**
 * Posts for the selected community, the post composer, and the moderator
 * write actions that operate on a single post (hide/restore/lock).
 *
 * loadPosts is the fan-out point: loading a community's posts also refreshes
 * their votes, comments and reports.
 */
export function usePosts(core: ForumCore, options: Options) {
  const { t, getContract, setTemporaryStatus, failWith } = core
  const {
    publishToIpfs,
    loadVotesFor,
    loadOnChainComments,
    loadReports,
    loadCommunities,
    loadModeratorInfo,
    getLiveMembershipStatus,
  } = options

  const [posts, setPosts] = useState<Post[]>([])
  const [showCreatePost, setShowCreatePost] = useState(false)
  const [postTitle, setPostTitle] = useState('')
  const [postBody, setPostBody] = useState('')
  const [postTags, setPostTags] = useState('')
  const [postImages, setPostImages] = useState<File[]>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)

  const loadPosts = async (communityId: string) => {
    try {
      const contract = await getContract(false)
      // Networks without a moderation contract deployed yet (e.g. Sepolia,
      // still on the pre-split single-contract deployment) resolve this to
      // an empty address - construction or calls on it will throw, so every
      // status flag below degrades to "not hidden/pending/rejected/locked"
      // instead of taking down the whole post list.
      const moderation = await getContract(false, 'moderation').catch(() => null)
      const postIds = await contract.getPostsByCommunity(communityId)

      // Load every post and its status flags in parallel. Previously each post
      // waited for the one before it, so N posts meant N serial round-trips;
      // now it's a single concurrent batch. Hidden/pending/rejected/locked all
      // live on the moderation contract now, so getPost itself only returns
      // the core fields.
      const loadedPosts: Post[] = await Promise.all(
        postIds.map(async (id: bigint): Promise<Post> => {
          const post = await contract.getPost(id)
          let hidden = false
          let pending = false
          let rejected = false
          let locked = false

          if (moderation) {
            try {
              ;[hidden, pending, rejected, locked] = await Promise.all([
                moderation.postHidden(id),
                moderation.postPendingReview(id),
                moderation.postRejected(id),
                moderation.postLocked(id),
              ])
            } catch {
              // No moderation contract on this network - defaults above stand.
            }
          }

          return {
            id: post[0].toString(),
            communityId: post[1].toString(),
            author: post[2],
            contentCID: post[3],
            createdAt: post[4].toString(),
            hidden,
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
      // Know whether the graph actually caught up: if not, what we reload next
      // may be stale, so tell the user it's still syncing instead of implying done.
      const indexed = receipt ? await waitForGraphBlock(receipt.blockNumber) : false
      await loadPosts(communityId)
      await loadCommunities(account)
      await loadModeratorInfo(communityId)
      setTemporaryStatus(indexed ? successMessage : `${successMessage} ${t('graphSyncPending')}`)
    } catch (error) {
      console.error('Transaction reconciliation failed:', error)
      await loadPosts(communityId).catch(() => {})
      failWith(failKey, error)
    }
  }

  // Publishes the composed post: uploads any attached media, pins metadata,
  // and sends either the normal or the flagged (review-queue) transaction.
  const submitPost = async (communityId: string, flagged: boolean) => {
    const liveStatus = await getLiveMembershipStatus(communityId)

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
        ? await contract.createFlaggedPost(communityId, contentCID, title, tags.join(','))
        : await contract.createPost(communityId, contentCID, title, tags.join(','))

      const account = liveStatus.account

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
        setPosts((prev) => [
          {
            id: `pending-${Date.now()}`,
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

  const hidePost = async (postId: string, communityId: string) => {
    try {
      const contract = await getContract(true, 'moderation')
      const tx = await contract.hidePost(postId)

      setTemporaryStatus(t('hideSent'))
      await tx.wait()
      await loadPosts(communityId)
      setTemporaryStatus(t('postHiddenToast'))
    } catch (error) {
      console.error('Failed to hide post:', error)
      failWith('hideFailed', error)
    }
  }

  const restorePost = async (postId: string, communityId: string) => {
    try {
      const contract = await getContract(true, 'moderation')
      const tx = await contract.restorePost(postId)

      setTemporaryStatus(t('restoreSent'))
      await tx.wait()
      await loadPosts(communityId)
      setTemporaryStatus(t('postRestoredToast'))
    } catch (error) {
      console.error('Failed to restore post:', error)
      failWith('restoreFailed', error)
    }
  }

  // Lock keeps the post visible but blocks new comments; unlock reopens it.
  const setPostLock = async (postId: string, communityId: string, lock: boolean) => {
    try {
      const contract = await getContract(true, 'moderation')
      const tx = lock ? await contract.lockPost(postId) : await contract.unlockPost(postId)

      setTemporaryStatus(t('txSent'))
      const receipt = await tx.wait()
      await waitForGraphBlock(receipt.blockNumber)
      await loadPosts(communityId)
      setTemporaryStatus(t(lock ? 'postLockedToast' : 'postUnlockedToast'))
    } catch (error) {
      console.error('Failed to change post lock:', error)
      failWith('lockFailed', error)
    }
  }

  return {
    posts,
    setPosts,
    loadPosts,
    reconcileAfterTx,
    submitPost,
    hidePost,
    restorePost,
    setPostLock,
    showCreatePost,
    setShowCreatePost,
    postTitle,
    setPostTitle,
    postBody,
    setPostBody,
    postTags,
    setPostTags,
    postImages,
    setPostImages,
    uploadingMedia,
  }
}
