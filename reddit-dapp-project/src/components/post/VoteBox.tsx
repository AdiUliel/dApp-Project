import { useForum } from '@/context/useForum'
import { isTempId } from '@/lib/format'

/**
 * Up/down vote control for a post. A confirming (optimistic) post has no
 * on-chain id yet, so its score renders static - a stray click there would
 * fire a doomed transaction.
 */
export function VoteBox({ postId }: { postId: string }) {
  const { votesByPost, castVote } = useForum()
  const voteInfo = votesByPost[postId] || { score: 0, myVote: 0 }

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
