import { useEffect, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import contractArtifact from './DecentralizedForum.json'
import './App.css'

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const MOCK_IPFS_STORAGE_KEY = 'reppit_mock_ipfs_metadata_v2'
const COMMENTS_STORAGE_KEY = 'reppit_signed_comments_v1'

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
}

type PostMetadata = {
  title: string
  body: string
  tags?: string[]
}

type MockIpfsRecord = PostMetadata | CommunityMetadata

type SignedComment = {
  postId: string
  author: string
  content: string
  createdAt: number
  message: string
  signature: string
}

declare global {
  interface Window {
    ethereum?: unknown
  }
}

const emptyAddress = '0x0000000000000000000000000000000000000000'

const isPostMetadata = (value: MockIpfsRecord | null): value is PostMetadata => {
  return Boolean(value && 'title' in value && 'body' in value)
}

const isCommunityMetadata = (value: MockIpfsRecord | null): value is CommunityMetadata => {
  return Boolean(value && 'description' in value)
}

function App() {
  const [walletAddress, setWalletAddress] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const [communities, setCommunities] = useState<Community[]>([])
  const [selectedCommunityId, setSelectedCommunityId] = useState('')
  const [newCommunityName, setNewCommunityName] = useState('')
  const [newCommunityDesc, setNewCommunityDesc] = useState('')

  const [newSubCommunityName, setNewSubCommunityName] = useState('')
  const [newSubCommunityDesc, setNewSubCommunityDesc] = useState('')

  const [posts, setPosts] = useState<Post[]>([])
  const [showCreatePost, setShowCreatePost] = useState(false)
  const [postTitle, setPostTitle] = useState('')
  const [postBody, setPostBody] = useState('')
  const [postTags, setPostTags] = useState('')
  const [selectedPostId, setSelectedPostId] = useState('')

  const [comments, setComments] = useState<SignedComment[]>([])
  const [newCommentByPost, setNewCommentByPost] = useState<Record<string, string>>({})

  const [moderators, setModerators] = useState<ModeratorDisplay[]>([])
  const [topActiveUsers, setTopActiveUsers] = useState<string[]>([])
  const [candidateAddress, setCandidateAddress] = useState('')
  const [addProposalId, setAddProposalId] = useState('')
  const [removeTargetAddress, setRemoveTargetAddress] = useState('')
  const [removeProposalId, setRemoveProposalId] = useState('')

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

  const visiblePosts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return posts
      .filter((post) => !post.hidden || selectedCommunity?.isModerator)
      .filter((post) => {
        if (!query) return true
        const metadata = getPostMetadata(post)
        return (
          metadata.title.toLowerCase().includes(query) ||
          metadata.body.toLowerCase().includes(query) ||
          metadata.tags?.some((tag) => tag.toLowerCase().includes(query))
        )
      })
  }, [posts, selectedCommunity?.isModerator, searchQuery])

  const selectedPost = visiblePosts.find((post) => post.id === selectedPostId) || visiblePosts[0]

  useEffect(() => {
    loadLocalComments()
  }, [])

  useEffect(() => {
    if (walletAddress) {
      loadCommunities(walletAddress)
    }
  }, [walletAddress])

  useEffect(() => {
    if (selectedCommunityId) {
      loadPosts(selectedCommunityId)
      loadModeratorInfo(selectedCommunityId)
      setSelectedPostId('')
    } else {
      setPosts([])
      setModerators([])
      setTopActiveUsers([])
    }
  }, [selectedCommunityId])

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

  const loadMockIpfs = (): Record<string, MockIpfsRecord> => {
    const raw = localStorage.getItem(MOCK_IPFS_STORAGE_KEY)
    if (!raw) return {}

    try {
      return JSON.parse(raw)
    } catch (error) {
      console.error('שגיאה בטעינת mock IPFS:', error)
      return {}
    }
  }

  const saveMockIpfs = (nextStore: Record<string, MockIpfsRecord>) => {
    localStorage.setItem(MOCK_IPFS_STORAGE_KEY, JSON.stringify(nextStore))
  }

  const saveToMockIpfs = (metadata: MockIpfsRecord) => {
    const cid = `local-json-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const store = loadMockIpfs()
    saveMockIpfs({ ...store, [cid]: metadata })
    return cid
  }

  const readFromMockIpfs = (cid: string): MockIpfsRecord | null => {
    const store = loadMockIpfs()
    return store[cid] || null
  }

  const getCommunityDescription = (community: Community) => {
    const metadata = readFromMockIpfs(community.metadataCID)
    if (isCommunityMetadata(metadata)) return metadata.description
    return community.metadataCID
  }

  const getPostMetadata = (post: Post): PostMetadata => {
    const metadata = readFromMockIpfs(post.contentCID)

    if (isPostMetadata(metadata)) {
      return metadata
    }

    return {
      title: `Post #${post.id}`,
      body: post.contentCID,
      tags: [],
    }
  }

  const connectWallet = async () => {
    try {
      const provider = getProvider()
      const accounts = await provider.send('eth_requestAccounts', [])
      setWalletAddress(accounts[0])
      await loadCommunities(accounts[0])
      setTemporaryStatus('הארנק חובר בהצלחה')
    } catch (error) {
      console.error('שגיאה בהתחברות:', error)
      alert('שגיאה בהתחברות ל-MetaMask')
    }
  }

  const loadCommunities = async (account = walletAddress) => {
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
        let moderatorRole: ModeratorRole | undefined

        if (account) {
          isMember = await contract.isUserMemberOfCommunity(communityId, account)
          isModerator = await contract.isUserModeratorOfCommunity(communityId, account)
          isBanned = await contract.isUserBannedFromCommunity(communityId, account)

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
        })
      }

      setCommunities(loadedCommunities)

      if (!selectedCommunityId && loadedCommunities.length > 0) {
        setSelectedCommunityId(loadedCommunities[0].id)
      }
    } catch (error) {
      console.error('שגיאה בטעינת קהילות:', error)
      setTemporaryStatus('לא הצלחתי לטעון קהילות. ודא ש-Hardhat node פעיל והחוזה פרוס.')
    }
  }

  const loadPosts = async (communityId: string) => {
    try {
      const contract = await getContract(false)
      const postIds = await contract.getPostsByCommunity(communityId)
      const loadedPosts: Post[] = []

      for (const id of postIds) {
        const post = await contract.getPost(id)

        loadedPosts.push({
          id: post[0].toString(),
          communityId: post[1].toString(),
          author: post[2],
          contentCID: post[3],
          createdAt: post[4].toString(),
          hidden: post[6],
        })
      }

      setPosts(loadedPosts.reverse())
    } catch (error) {
      console.error('שגיאה בטעינת פוסטים:', error)
      setPosts([])
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
      console.error('שגיאה בטעינת Moderators:', error)
      setModerators([])
      setTopActiveUsers([])
    }
  }

  const loadLocalComments = () => {
    const rawComments = localStorage.getItem(COMMENTS_STORAGE_KEY)

    if (!rawComments) {
      setComments([])
      return
    }

    try {
      setComments(JSON.parse(rawComments))
    } catch (error) {
      console.error('שגיאה בטעינת תגובות מקומיות:', error)
      setComments([])
    }
  }

  const saveLocalComments = (nextComments: SignedComment[]) => {
    localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(nextComments))
    setComments(nextComments)
  }

  const createCommunity = async () => {
    if (!newCommunityName.trim() || !newCommunityDesc.trim()) {
      alert('נא למלא שם ותיאור לקהילה')
      return
    }

    try {
      const metadataCID = saveToMockIpfs({
        description: newCommunityDesc.trim(),
        rules: ['Be respectful', 'Keep posts relevant', 'No spam'],
      })

      const contract = await getContract(true)
      const communityName = newCommunityName.trim()
      const tx = await contract.createCommunity(communityName, metadataCID)

      setTemporaryStatus('העסקה נשלחה. ממתין לאישור יצירת הקהילה...')
      await tx.wait()

      setNewCommunityName('')
      setNewCommunityDesc('')
      const account = await getCurrentWalletAddress()
      await loadCommunities(account)
      setTemporaryStatus(`הקהילה r/${communityName} נוצרה בהצלחה`) 
    } catch (error) {
      console.error('שגיאה ביצירת קהילה:', error)
      alert('שגיאה ביצירת הקהילה. ייתכן שהשם כבר קיים או שהחוזה לא מחובר.')
    }
  }

  const createSubCommunity = async () => {
    if (!selectedCommunityId || !newSubCommunityName.trim() || !newSubCommunityDesc.trim()) {
      alert('נא לבחור קהילת אב ולמלא שם ותיאור לתת־קהילה')
      return
    }

    try {
      const metadataCID = saveToMockIpfs({
        description: newSubCommunityDesc.trim(),
        rules: ['Follow parent community rules', 'Keep discussions focused'],
      })

      const contract = await getContract(true)
      const subName = newSubCommunityName.trim()
      const tx = await contract.createSubCommunity(selectedCommunityId, subName, metadataCID)

      setTemporaryStatus('יוצר תת־קהילה על החוזה...')
      await tx.wait()

      setNewSubCommunityName('')
      setNewSubCommunityDesc('')
      const account = await getCurrentWalletAddress()
      await loadCommunities(account)
      setTemporaryStatus(`תת־הקהילה r/${subName} נוצרה בהצלחה`)
    } catch (error) {
      console.error('שגיאה ביצירת תת־קהילה:', error)
      alert('שגיאה ביצירת תת־קהילה. ודא שהחוזה החדש פרוס וששם התת־קהילה פנוי.')
    }
  }

  const joinCommunity = async (communityId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.joinCommunity(communityId)

      setTemporaryStatus('בקשת ההצטרפות נשלחה. ממתין לאישור...')
      await tx.wait()

      const account = await getCurrentWalletAddress()
      await loadCommunities(account)
      await loadModeratorInfo(communityId)
      setTemporaryStatus('הצטרפת לקהילה בהצלחה')
    } catch (error) {
      console.error('שגיאה בהצטרפות לקהילה:', error)
      alert('שגיאה בהצטרפות. אולי אתה כבר חבר או שהמשתמש חסום.')
    }
  }

  const createPost = async () => {
    if (!selectedCommunityId || !postTitle.trim() || !postBody.trim()) {
      alert('נא לבחור קהילה ולמלא כותרת ותוכן לפוסט')
      return
    }

    const liveStatus = await getLiveMembershipStatus(selectedCommunityId)

    if (!liveStatus.account) {
      alert('צריך לחבר ארנק לפני יצירת פוסט')
      return
    }

    if (!liveStatus.isMember) {
      alert('צריך להצטרף לקהילה לפני יצירת פוסט')
      return
    }

    if (liveStatus.isBanned) {
      alert('המשתמש חסום בקהילה הזאת')
      return
    }

    try {
      const tags = postTags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)

      const contentCID = saveToMockIpfs({
        title: postTitle.trim(),
        body: postBody.trim(),
        tags,
      })

      const contract = await getContract(true)
      const tx = await contract.createPost(selectedCommunityId, contentCID)

      setTemporaryStatus('הפוסט נשלח לבלוקצ׳יין. ממתין לאישור...')
      await tx.wait()

      setPostTitle('')
      setPostBody('')
      setPostTags('')
      setShowCreatePost(false)
      await loadPosts(selectedCommunityId)
      await loadCommunities(liveStatus.account)
      await loadModeratorInfo(selectedCommunityId)
      setTemporaryStatus('הפוסט פורסם בהצלחה. ניקוד הפעילות עודכן.')
    } catch (error) {
      console.error('שגיאה ביצירת פוסט:', error)
      alert('שגיאה ביצירת הפוסט. ודא שאתה חבר בקהילה ולא חסום.')
    }
  }

  const proposeModerator = async () => {
    if (!selectedCommunityId || !candidateAddress.trim()) {
      alert('נא להזין כתובת משתמש למינוי')
      return
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.proposeModerator(selectedCommunityId, candidateAddress.trim())
      setTemporaryStatus('הצעת מינוי Moderator נשלחה. דרושות 3 הסכמות.')
      await tx.wait()
      setCandidateAddress('')
      await loadModeratorInfo(selectedCommunityId)
    } catch (error) {
      console.error('שגיאה בהצעת Moderator:', error)
      alert('רק Moderator יכול להציע מינוי, והמועמד חייב להיות חבר קהילה שאינו Moderator.')
    }
  }

  const approveModeratorProposal = async () => {
    if (!addProposalId.trim()) {
      alert('נא להזין Proposal ID')
      return
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.approveModeratorProposal(addProposalId.trim())
      setTemporaryStatus('אישור מינוי Moderator נשלח.')
      await tx.wait()
      setAddProposalId('')
      await loadCommunities()
      await loadModeratorInfo(selectedCommunityId)
    } catch (error) {
      console.error('שגיאה באישור הצעת מינוי:', error)
      alert('רק Moderator שעדיין לא אישר יכול לאשר את ההצעה.')
    }
  }

  const proposeRemoveModerator = async () => {
    if (!selectedCommunityId || !removeTargetAddress.trim()) {
      alert('נא להזין כתובת Moderator להסרה')
      return
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.proposeRemoveModerator(selectedCommunityId, removeTargetAddress.trim())
      setTemporaryStatus('הצעת הסרת Moderator נשלחה. צריך לפחות חצי מה־Moderators.')
      await tx.wait()
      setRemoveTargetAddress('')
      await loadModeratorInfo(selectedCommunityId)
    } catch (error) {
      console.error('שגיאה בהצעת הסרה:', error)
      alert('אפשר להסיר בהצבעה רק Moderator שמונה בעבר, לא Creator ולא Active Moderator אוטומטי.')
    }
  }

  const approveRemoveModeratorProposal = async () => {
    if (!removeProposalId.trim()) {
      alert('נא להזין Removal Proposal ID')
      return
    }

    try {
      const contract = await getContract(true)
      const tx = await contract.approveRemoveModeratorProposal(removeProposalId.trim())
      setTemporaryStatus('אישור הסרת Moderator נשלח.')
      await tx.wait()
      setRemoveProposalId('')
      await loadCommunities()
      await loadModeratorInfo(selectedCommunityId)
    } catch (error) {
      console.error('שגיאה באישור הסרה:', error)
      alert('רק Moderator שעדיין לא אישר יכול לאשר את ההסרה.')
    }
  }

  const hidePost = async (postId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.hidePost(postId)

      setTemporaryStatus('פעולת ההסתרה נשלחה. ממתין לאישור...')
      await tx.wait()
      await loadPosts(selectedCommunityId)
      setTemporaryStatus('הפוסט הוסתר')
    } catch (error) {
      console.error('שגיאה בהסתרת פוסט:', error)
      alert('רק Moderator יכול להסתיר פוסט')
    }
  }

  const restorePost = async (postId: string) => {
    try {
      const contract = await getContract(true)
      const tx = await contract.restorePost(postId)

      setTemporaryStatus('פעולת השחזור נשלחה. ממתין לאישור...')
      await tx.wait()
      await loadPosts(selectedCommunityId)
      setTemporaryStatus('הפוסט שוחזר')
    } catch (error) {
      console.error('שגיאה בשחזור פוסט:', error)
      alert('רק Moderator יכול לשחזר פוסט')
    }
  }

  const createOffChainComment = async (postId: string) => {
    const content = (newCommentByPost[postId] || '').trim()

    if (!content) {
      alert('נא לכתוב תגובה')
      return
    }

    const liveStatus = await getLiveMembershipStatus(selectedCommunityId)

    if (!liveStatus.account) {
      alert('צריך לחבר ארנק כדי להגיב')
      return
    }

    if (!liveStatus.isMember) {
      alert('צריך להיות חבר בקהילה כדי להגיב')
      return
    }

    if (liveStatus.isBanned) {
      alert('משתמש חסום לא יכול להגיב בקהילה')
      return
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
      })

      const signature = await signer.signMessage(message)
      const nextComments = [...comments, { postId, author, content, createdAt, message, signature }]

      saveLocalComments(nextComments)
      setNewCommentByPost((previous) => ({ ...previous, [postId]: '' }))
      setTemporaryStatus('התגובה נשמרה off-chain ונחתמה בהצלחה')
    } catch (error) {
      console.error('שגיאה ביצירת תגובה off-chain:', error)
      alert('שגיאה בחתימת התגובה. חתימה לא עולה gas, אבל צריך לאשר אותה ב-MetaMask.')
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

  const formatDate = (timestamp: string | number) => {
    const value = Number(timestamp)
    if (!value) return 'Unknown time'

    const date = value > 10_000_000_000 ? new Date(value) : new Date(value * 1000)
    return new Intl.DateTimeFormat('he-IL', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date)
  }

  const commentsForPost = (postId: string) => {
    return comments.filter((comment) => comment.postId === postId)
  }

  const roleLabel = (role?: ModeratorRole) => {
    if (!role?.isModerator) return 'Member'
    if (role.isCreatorModerator) return 'Creator MOD'
    if (role.isAppointedModerator) return 'Appointed MOD'
    if (role.isActiveBasedModerator) return 'Active MOD'
    return 'MOD'
  }

  const renderCommunityButton = (community: Community, depth = 0) => {
    const children = communitiesByParent[community.id] || []

    return (
      <div key={community.id}>
        <button
          className={`community-item ${selectedCommunityId === community.id ? 'active' : ''}`}
          style={{ paddingLeft: `${0.75 + depth * 1.1}rem` }}
          onClick={() => setSelectedCommunityId(community.id)}
        >
          <span className="community-avatar">{depth > 0 ? '↳' : 'r/'}</span>
          <span className="community-main">
            <strong>r/{community.name}</strong>
            <small>{community.membersCount} members</small>
          </span>
          {community.isModerator && <span className="mini-badge mod">MOD</span>}
        </button>

        {children.map((child) => renderCommunityButton(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">R</div>
          <div>
            <h1>Reppit</h1>
            <p>Decentralized forum with community governance</p>
          </div>
        </div>

        <div className="search-shell">
          <span>⌕</span>
          <input
            type="search"
            placeholder="Search communities, posts, tags..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <div className="wallet-panel">
          {walletAddress ? (
            <>
              <span className="status-dot" />
              <span className="wallet-label">Connected</span>
              <code>{formatAddress(walletAddress)}</code>
            </>
          ) : (
            <button className="primary-button" onClick={connectWallet}>Connect Wallet</button>
          )}
        </div>
      </header>

      {statusMessage && <div className="toast-message">{statusMessage}</div>}

      {!walletAddress ? (
        <main className="landing-card">
          <span className="eyebrow">Web3 forum</span>
          <h2>קהילות, תתי־קהילות ו־Moderators לפי פעילות</h2>
          <p>
            החוזה החדש תומך ביוצר קהילה כ־Moderator ראשון, שני Active Moderators אוטומטיים,
            מינוי Moderators בהסכמת 3 Moderators, והסרה של Appointed Moderator לפי הצבעה של לפחות חצי מה־Moderators.
          </p>
          <button className="primary-button large" onClick={connectWallet}>התחבר עם MetaMask</button>
        </main>
      ) : (
        <main className="forum-layout">
          <aside className="sidebar">
            <section className="panel create-community-panel compact-panel">
              <div className="section-heading">
                <span className="eyebrow">Create</span>
                <h2>קהילה ראשית</h2>
              </div>
              <input
                type="text"
                placeholder="שם קהילה, למשל blockchain"
                value={newCommunityName}
                onChange={(event) => setNewCommunityName(event.target.value)}
              />
              <textarea
                placeholder="תיאור קצר לקהילה"
                value={newCommunityDesc}
                onChange={(event) => setNewCommunityDesc(event.target.value)}
              />
              <button className="primary-button full" onClick={createCommunity}>צור קהילה</button>
            </section>

            <section className="panel communities-panel">
              <div className="section-heading row-heading">
                <div>
                  <span className="eyebrow">Sub forums</span>
                  <h2>קהילות</h2>
                </div>
                <span className="counter-pill">{communities.length}</span>
              </div>

              {communities.length === 0 ? (
                <p className="muted-text">אין עדיין קהילות. צור את הראשונה.</p>
              ) : (
                <div className="community-list">
                  {rootCommunities.map((community) => renderCommunityButton(community))}
                </div>
              )}
            </section>
          </aside>

          <section className="main-feed">
            {selectedCommunity ? (
              <>
                <section className="community-hero panel">
                  <div>
                    <span className="eyebrow">Community</span>
                    <h2>r/{selectedCommunity.name}</h2>
                    <p>{getCommunityDescription(selectedCommunity)}</p>
                    <div className="meta-row">
                      <span>{selectedCommunity.membersCount} members</span>
                      <span>Creator {formatAddress(selectedCommunity.creator)}</span>
                      {selectedCommunity.parentCommunityId !== '0' && <span className="badge info">Sub-community</span>}
                      {selectedCommunity.isMember && <span className="badge success">Member</span>}
                      {selectedCommunity.isModerator && <span className="badge warning">{roleLabel(selectedCommunity.moderatorRole)}</span>}
                      {selectedCommunity.isBanned && <span className="badge danger">Banned</span>}
                    </div>
                  </div>

                  <div className="hero-actions">
                    {!selectedCommunity.isMember && !selectedCommunity.isBanned && (
                      <button className="primary-button" onClick={() => joinCommunity(selectedCommunity.id)}>Join</button>
                    )}
                    <button className="secondary-button" onClick={() => setShowCreatePost((previous) => !previous)}>
                      {showCreatePost ? 'סגור כתיבה' : 'כתוב פוסט'}
                    </button>
                  </div>
                </section>

                <section className="panel subcommunity-card">
                  <div className="section-heading row-heading">
                    <div>
                      <span className="eyebrow">Hierarchy</span>
                      <h2>יצירת תת־קהילה</h2>
                    </div>
                    <span className="counter-pill">parent r/{selectedCommunity.name}</span>
                  </div>
                  <div className="two-column-form">
                    <input
                      type="text"
                      placeholder="שם תת־קהילה, למשל solidity"
                      value={newSubCommunityName}
                      onChange={(event) => setNewSubCommunityName(event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="תיאור קצר לתת־קהילה"
                      value={newSubCommunityDesc}
                      onChange={(event) => setNewSubCommunityDesc(event.target.value)}
                    />
                  </div>
                  <button className="ghost-button full" onClick={createSubCommunity}>צור תת־קהילה תחת r/{selectedCommunity.name}</button>
                </section>

                {showCreatePost && (
                  <section className="panel create-post-card secondary-create-card">
                    <div className="section-heading row-heading">
                      <div>
                        <span className="eyebrow">New post</span>
                        <h2>פרסום פוסט</h2>
                      </div>
                      <span className="counter-pill">+5 activity</span>
                    </div>

                    {!selectedCommunity.isMember && (
                      <p className="warning-text">צריך להצטרף לקהילה לפני יצירת פוסט.</p>
                    )}

                    <input
                      type="text"
                      placeholder="כותרת הפוסט"
                      value={postTitle}
                      onChange={(event) => setPostTitle(event.target.value)}
                    />
                    <textarea
                      className="post-body-input"
                      placeholder="תוכן הפוסט"
                      value={postBody}
                      onChange={(event) => setPostBody(event.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="תגיות מופרדות בפסיקים, למשל React, Solidity"
                      value={postTags}
                      onChange={(event) => setPostTags(event.target.value)}
                    />
                    <div className="form-footer">
                      <small>נשמר כ־JSON ב־mock IPFS, וה־CID נשלח לחוזה.</small>
                      <button className="primary-button" onClick={createPost}>Publish</button>
                    </div>
                  </section>
                )}

                <section className="feed-list">
                  <div className="feed-title-row">
                    <h2>Feed</h2>
                    <span>{visiblePosts.length} posts</span>
                  </div>

                  {visiblePosts.length === 0 ? (
                    <div className="empty-state panel">
                      <h3>עדיין אין פוסטים</h3>
                      <p>כפתור כתיבת הפוסט נמצא למעלה, אבל הוא פחות מרכזי כדי שה־Feed יהיה העיקר.</p>
                    </div>
                  ) : (
                    visiblePosts.map((post) => {
                      const metadata = getPostMetadata(post)
                      const postComments = commentsForPost(post.id)
                      const isSelected = selectedPost?.id === post.id

                      return (
                        <article className={`post-card panel ${post.hidden ? 'hidden-post' : ''} ${isSelected ? 'selected' : ''}`} key={post.id}>
                          <button className="post-content-button" onClick={() => setSelectedPostId(post.id)}>
                            <div className="post-vote-box">
                              <span>▲</span>
                              <strong>{postComments.length}</strong>
                              <span>▼</span>
                            </div>

                            <div className="post-main-content">
                              <div className="post-meta-line">
                                <span>r/{selectedCommunity.name}</span>
                                <span>·</span>
                                <span>{formatAddress(post.author)}</span>
                                <span>·</span>
                                <span>{formatDate(post.createdAt)}</span>
                              </div>
                              <h3>{metadata.title}</h3>
                              <p>{metadata.body}</p>
                              {metadata.tags && metadata.tags.length > 0 && (
                                <div className="tag-row">
                                  {metadata.tags.map((tag) => <span key={`${post.id}-${tag}`}>#{tag}</span>)}
                                </div>
                              )}
                              <div className="post-actions-line">
                                <span>{postComments.length} תגובות</span>
                                <span>CID: {post.contentCID.slice(0, 18)}...</span>
                                {post.hidden && <span className="badge danger">Hidden</span>}
                              </div>
                            </div>
                          </button>

                          {selectedCommunity.isModerator && (
                            <div className="moderator-actions">
                              {post.hidden ? (
                                <button className="ghost-button" onClick={() => restorePost(post.id)}>שחזר פוסט</button>
                              ) : (
                                <button className="danger-button" onClick={() => hidePost(post.id)}>הסתר פוסט</button>
                              )}
                            </div>
                          )}

                          {isSelected && (
                            <div className="comments-box">
                              <h4>תגובות off-chain</h4>
                              {postComments.length === 0 ? (
                                <p className="muted-text">אין תגובות עדיין.</p>
                              ) : (
                                <div className="comments-list">
                                  {postComments.map((comment, index) => (
                                    <div className="comment-item" key={`${comment.signature}-${index}`}>
                                      <p>{comment.content}</p>
                                      <small>
                                        {formatAddress(comment.author)} · {formatDate(comment.createdAt)} · חתימה{' '}
                                        {isCommentSignatureValid(comment) ? 'תקינה ✅' : 'לא תקינה ❌'}
                                      </small>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <textarea
                                placeholder="כתוב תגובה. היא תיחתם ב-MetaMask ותישמר localStorage בלי gas."
                                value={newCommentByPost[post.id] || ''}
                                onChange={(event) => setNewCommentByPost((previous) => ({ ...previous, [post.id]: event.target.value }))}
                              />
                              <button className="secondary-button full" onClick={() => createOffChainComment(post.id)}>
                                שלח תגובה ללא gas
                              </button>
                            </div>
                          )}
                        </article>
                      )
                    })
                  )}
                </section>
              </>
            ) : (
              <section className="empty-state panel">
                <h2>בחר קהילה</h2>
                <p>לאחר בחירת קהילה בצד, יופיע כאן ה־Feed שלה.</p>
              </section>
            )}
          </section>

          <aside className="details-sidebar">
            <section className="panel details-card governance-card">
              <span className="eyebrow">Governance</span>
              {selectedCommunity ? (
                <>
                  <h2>Moderators</h2>
                  <p>יוצר הקהילה קבוע. שני המשתמשים הכי פעילים מתעדכנים אוטומטית. מינוי רגיל דורש 3 אישורים.</p>

                  <div className="mod-list">
                    {moderators.length === 0 ? (
                      <p className="muted-text">אין מידע על Moderators.</p>
                    ) : (
                      moderators.map((moderator) => (
                        <div className="mod-row" key={moderator.address}>
                          <div>
                            <strong>{formatAddress(moderator.address)}</strong>
                            <small>{roleLabel(moderator.role)} · score {moderator.score}</small>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="active-box">
                    <strong>Top active users</strong>
                    {topActiveUsers.length === 0 ? (
                      <small>עדיין אין Active Moderators.</small>
                    ) : (
                      topActiveUsers.map((address) => <small key={address}>{formatAddress(address)}</small>)
                    )}
                  </div>

                  {selectedCommunity.isModerator && (
                    <div className="governance-tools">
                      <h3>Moderator actions</h3>
                      <input
                        type="text"
                        placeholder="כתובת משתמש למינוי Moderator"
                        value={candidateAddress}
                        onChange={(event) => setCandidateAddress(event.target.value)}
                      />
                      <button className="ghost-button full" onClick={proposeModerator}>פתח הצעת מינוי</button>

                      <input
                        type="text"
                        placeholder="Proposal ID לאישור מינוי"
                        value={addProposalId}
                        onChange={(event) => setAddProposalId(event.target.value)}
                      />
                      <button className="secondary-button full" onClick={approveModeratorProposal}>אשר הצעת מינוי</button>

                      <input
                        type="text"
                        placeholder="כתובת Appointed Moderator להסרה"
                        value={removeTargetAddress}
                        onChange={(event) => setRemoveTargetAddress(event.target.value)}
                      />
                      <button className="danger-button full" onClick={proposeRemoveModerator}>פתח הצעת הסרה</button>

                      <input
                        type="text"
                        placeholder="Removal Proposal ID לאישור הסרה"
                        value={removeProposalId}
                        onChange={(event) => setRemoveProposalId(event.target.value)}
                      />
                      <button className="danger-button full" onClick={approveRemoveModeratorProposal}>אשר הצעת הסרה</button>
                    </div>
                  )}
                </>
              ) : (
                <p className="muted-text">בחר קהילה כדי לראות ממשל והרשאות.</p>
              )}
            </section>

            <section className="panel details-card">
              <span className="eyebrow">Post details</span>
              {selectedPost ? (
                <>
                  <h2>{getPostMetadata(selectedPost).title}</h2>
                  <p>{getPostMetadata(selectedPost).body}</p>
                  <div className="details-grid">
                    <span>Post ID</span>
                    <strong>#{selectedPost.id}</strong>
                    <span>Author</span>
                    <strong>{formatAddress(selectedPost.author)}</strong>
                    <span>Comments</span>
                    <strong>{commentsForPost(selectedPost.id).length}</strong>
                    <span>Storage</span>
                    <strong>mock IPFS</strong>
                  </div>
                </>
              ) : (
                <p className="muted-text">בחר פוסט כדי לראות פרטים.</p>
              )}
            </section>
          </aside>
        </main>
      )}
    </div>
  )
}

export default App
