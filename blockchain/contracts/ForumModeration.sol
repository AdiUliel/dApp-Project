// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { IDecentralizedForum, IForumModeration } from "./ForumInterfaces.sol";

// All content-moderation machinery, split out of DecentralizedForum to keep
// that contract under the EIP-170 bytecode size limit. Holds no community or
// post data itself - permission checks (moderator/member/ban status) and post
// existence/community resolution are delegated back to the main forum
// contract via IDecentralizedForum, resolved once at construction and never
// changed (deploy-time wiring only).
contract ForumModeration is IForumModeration {
    IDecentralizedForum private immutable forum;

    constructor(address forumAddress) {
        forum = IDecentralizedForum(forumAddress);
    }

    // ERRORS //
    // Re-declared with the same names/signatures as DecentralizedForum's own
    // access-control errors: Solidity custom-error selectors are computed
    // from the signature text only, so these produce identical 4-byte
    // selectors and stay decodable by the same frontend ABI-based error map.
    error OnlyCommunityModeratorAllowed();
    error OnlyCommunityMembersAllowed();
    error UserBannedFromCommunity();
    error OnlyForumContractAllowed();
    error MustJoinCommunityFirst();

    error PostAlreadyHidden();
    error PostNotHidden();
    error PostIsLocked();
    error PostNotLocked();
    error PostAlreadyLocked();
    error PostNotPendingReview();
    error CannotRestoreModeratedPost();
    error CommentAlreadyHidden();
    error CommentDoesNotExist();
    error CommentNotPendingReview();
    error EmptyCommentContent();
    error InputTooLong();
    error AlreadyReported();

    // On-chain input length caps (bytes), mirroring DecentralizedForum's.
    uint256 private constant MAX_COMMENT_LENGTH = 5000;
    uint256 private constant MAX_REASON_LENGTH = 500;
    uint256 private constant MAX_CID_LENGTH = 200;

    // STRUCTS //
    struct PendingPostReview {
        uint256 communityId;
        address author;
        bool exists;
    }

    struct PendingComment {
        uint256 id;
        uint256 postId;
        address author;
        string content;
        string imageCid;
        uint256 createdAt;
        uint8 status; // 0 = pending, 1 = approved, 2 = rejected
        bool exists;
    }

    // STORAGE //
    mapping(uint256 => PendingPostReview) private pendingPostReviews;
    mapping(uint256 => bool) public postPendingReview;
    mapping(uint256 => bool) public postRejected;

    mapping(uint256 => PendingComment) private pendingComments;
    mapping(uint256 => uint256[]) private pendingCommentIdsByPost;

    // Clean AND flagged comments share ONE global id space so an id like "1"
    // is never ambiguous between the two, and every comment can travel the
    // same hide/report path once it is visible.
    uint256 private nextCommentId = 1;

    mapping(uint256 => bool) public postHidden;
    mapping(uint256 => bool) public postLocked;

    // commentId -> postId, recorded at creation so hideComment/reportComment
    // can resolve which community a comment belongs to.
    mapping(uint256 => uint256) private commentPostIds;
    mapping(uint256 => bool) public commentHidden;

    // Prevents the same address reporting the same content twice.
    // key = keccak256(reporter, kind, refId).
    mapping(bytes32 => bool) private hasReported;

    // EVENTS //
    event PostSubmittedForReview(
        uint256 indexed postId,
        uint256 indexed communityId,
        address indexed author,
        string title,
        uint256 submittedAt
    );

    event PendingPostApproved(
        uint256 indexed postId,
        uint256 indexed communityId,
        address indexed moderator,
        uint256 approvedAt
    );

    event PendingPostRejected(
        uint256 indexed postId,
        uint256 indexed communityId,
        address indexed moderator,
        uint256 rejectedAt
    );

    event CommentCreated(
        uint256 indexed commentId,
        uint256 indexed postId,
        uint256 indexed communityId,
        address author,
        string content,
        string imageCid,
        uint256 createdAt
    );

    event CommentSubmittedForReview(
        uint256 indexed commentId,
        uint256 indexed postId,
        uint256 indexed communityId,
        address author,
        string content,
        string imageCid,
        uint256 submittedAt
    );

    event PendingCommentApproved(
        uint256 indexed commentId,
        uint256 indexed postId,
        uint256 indexed communityId,
        address moderator,
        uint256 approvedAt
    );

    event PendingCommentRejected(
        uint256 indexed commentId,
        uint256 indexed postId,
        uint256 indexed communityId,
        address moderator,
        uint256 rejectedAt
    );

    event PostHidden(
        uint256 indexed postId,
        uint256 indexed communityId,
        address indexed hiddenBy,
        uint256 hiddenAt
    );

    event PostRestored(
        uint256 indexed postId,
        uint256 indexed communityId,
        address indexed restoredBy,
        uint256 restoredAt
    );

    event PostLocked(
        uint256 indexed postId,
        uint256 indexed communityId,
        address lockedBy,
        uint256 lockedAt
    );

    event PostUnlocked(
        uint256 indexed postId,
        uint256 indexed communityId,
        address unlockedBy,
        uint256 unlockedAt
    );

    event CommentHidden(
        uint256 indexed commentId,
        uint256 indexed postId,
        uint256 indexed communityId,
        address hiddenBy,
        uint256 hiddenAt
    );

    // User report of content that the automatic filters did not catch.
    // kind 0 = post, 1 = comment. Event-only: nothing stored on-chain, the
    // subgraph indexes it and fans it out to the community's moderators.
    event ContentReported(
        uint256 indexed refId,
        uint256 indexed communityId,
        uint8 kind,
        address reporter,
        string reason,
        uint256 reportedAt
    );

    // A moderator closed out the reports on a piece of content. The subgraph
    // flips the content's report thread to resolved so it leaves the open
    // queue. action 0 = dismissed (report unfounded), 1 = action taken.
    event ReportResolved(
        uint256 indexed communityId,
        uint256 indexed refId,
        address indexed resolvedBy,
        uint8 kind,
        uint8 action,
        uint256 resolvedAt
    );

    // MODIFIERS //
    modifier onlyForumContract() {
        if (msg.sender != address(forum)) {
            revert OnlyForumContractAllowed();
        }
        _;
    }

    // WRITE FUNCTIONS //

    // Entry point DecentralizedForum calls right after minting a flagged
    // post, handing it off into the review queue.
    function flagPostForReview(
        uint256 postId,
        uint256 communityId,
        address author,
        string calldata title
    )
        external
        onlyForumContract
    {
        pendingPostReviews[postId] = PendingPostReview({
            communityId: communityId,
            author: author,
            exists: true
        });
        postPendingReview[postId] = true;
        // A post awaiting review is not publicly visible until a moderator
        // approves it (approvePendingPost un-hides it); rejection leaves it
        // hidden permanently.
        postHidden[postId] = true;

        emit PostSubmittedForReview(postId, communityId, author, title, block.timestamp);
    }

    function approvePendingPost(uint256 postId) external {
        PendingPostReview storage review = pendingPostReviews[postId];

        if (!review.exists || !postPendingReview[postId]) {
            revert PostNotPendingReview();
        }

        if (!forum.isUserModeratorOfCommunity(review.communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        postPendingReview[postId] = false;
        postHidden[postId] = false;
        forum.awardPostApprovalActivity(review.communityId, review.author);

        emit PendingPostApproved(postId, review.communityId, msg.sender, block.timestamp);
    }

    function rejectPendingPost(uint256 postId) external {
        PendingPostReview storage review = pendingPostReviews[postId];

        if (!review.exists || !postPendingReview[postId]) {
            revert PostNotPendingReview();
        }

        if (!forum.isUserModeratorOfCommunity(review.communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        postPendingReview[postId] = false;
        postRejected[postId] = true;

        emit PendingPostRejected(postId, review.communityId, msg.sender, block.timestamp);
    }

    // Publishes a clean comment straight to the chain (event-indexed). Same
    // gate as submitFlaggedComment so every instance sees the same comments.
    function addComment(uint256 postId, string calldata content, string calldata imageCid) external {
        if (bytes(content).length == 0) {
            revert EmptyCommentContent();
        }

        _requireMaxLen(bytes(content).length, MAX_COMMENT_LENGTH);
        _requireMaxLen(bytes(imageCid).length, MAX_CID_LENGTH);

        uint256 communityId = forum.communityOfPost(postId);

        if (forum.isUserBannedFromCommunity(communityId, msg.sender)) {
            revert UserBannedFromCommunity();
        }

        if (!forum.isUserMemberOfCommunity(communityId, msg.sender)) {
            revert OnlyCommunityMembersAllowed();
        }

        if (postLocked[postId]) {
            revert PostIsLocked();
        }

        uint256 commentId = nextCommentId;
        nextCommentId++;
        commentPostIds[commentId] = postId;

        emit CommentCreated(commentId, postId, communityId, msg.sender, content, imageCid, block.timestamp);
    }

    function submitFlaggedComment(uint256 postId, string calldata content, string calldata imageCid) external {
        if (bytes(content).length == 0) {
            revert EmptyCommentContent();
        }

        _requireMaxLen(bytes(content).length, MAX_COMMENT_LENGTH);
        _requireMaxLen(bytes(imageCid).length, MAX_CID_LENGTH);

        uint256 communityId = forum.communityOfPost(postId);

        // Ban wins over the membership check: banUser also strips membership,
        // and the banned error is the meaningful one for the user.
        if (forum.isUserBannedFromCommunity(communityId, msg.sender)) {
            revert UserBannedFromCommunity();
        }

        if (!forum.isUserMemberOfCommunity(communityId, msg.sender)) {
            revert OnlyCommunityMembersAllowed();
        }

        if (postLocked[postId]) {
            revert PostIsLocked();
        }

        uint256 commentId = nextCommentId;
        nextCommentId++;

        pendingComments[commentId] = PendingComment({
            id: commentId,
            postId: postId,
            author: msg.sender,
            content: content,
            imageCid: imageCid,
            createdAt: block.timestamp,
            status: 0,
            exists: true
        });

        pendingCommentIdsByPost[postId].push(commentId);

        emit CommentSubmittedForReview(commentId, postId, communityId, msg.sender, content, imageCid, block.timestamp);
    }

    function approvePendingComment(uint256 commentId) external {
        PendingComment storage comment = _pendingCommentForReview(commentId);
        comment.status = 1;

        // Now that it is public, register it in the same commentId -> postId
        // map the clean comments use, so hideComment / reportComment work on
        // it too.
        commentPostIds[commentId] = comment.postId;

        emit PendingCommentApproved(
            commentId,
            comment.postId,
            forum.communityOfPost(comment.postId),
            msg.sender,
            block.timestamp
        );
    }

    function rejectPendingComment(uint256 commentId) external {
        PendingComment storage comment = _pendingCommentForReview(commentId);
        comment.status = 2;

        emit PendingCommentRejected(
            commentId,
            comment.postId,
            forum.communityOfPost(comment.postId),
            msg.sender,
            block.timestamp
        );
    }

    function _pendingCommentForReview(uint256 commentId) private view returns (PendingComment storage) {
        PendingComment storage comment = pendingComments[commentId];

        if (!comment.exists) {
            revert CommentDoesNotExist();
        }

        if (comment.status != 0) {
            revert CommentNotPendingReview();
        }

        uint256 communityId = forum.communityOfPost(comment.postId);
        if (!forum.isUserModeratorOfCommunity(communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        return comment;
    }

    function hidePost(uint256 postId) external {
        uint256 communityId = forum.communityOfPost(postId);

        if (!forum.isUserModeratorOfCommunity(communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        if (postHidden[postId]) {
            revert PostAlreadyHidden();
        }

        postHidden[postId] = true;

        emit PostHidden(postId, communityId, msg.sender, block.timestamp);
    }

    function restorePost(uint256 postId) external {
        uint256 communityId = forum.communityOfPost(postId);

        if (!forum.isUserModeratorOfCommunity(communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        if (!postHidden[postId]) {
            revert PostNotHidden();
        }

        // Invariant: pending => hidden and rejected => hidden. A post still in
        // (or already out of) the review queue must not be made visible here;
        // use approve/reject for those instead of restore.
        if (postPendingReview[postId] || postRejected[postId]) {
            revert CannotRestoreModeratedPost();
        }

        postHidden[postId] = false;

        emit PostRestored(postId, communityId, msg.sender, block.timestamp);
    }

    // Locking keeps the post visible but blocks any new comments on it.
    function lockPost(uint256 postId) external {
        uint256 communityId = forum.communityOfPost(postId);

        if (!forum.isUserModeratorOfCommunity(communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        if (postLocked[postId]) {
            revert PostAlreadyLocked();
        }

        postLocked[postId] = true;

        emit PostLocked(postId, communityId, msg.sender, block.timestamp);
    }

    function unlockPost(uint256 postId) external {
        uint256 communityId = forum.communityOfPost(postId);

        if (!forum.isUserModeratorOfCommunity(communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        if (!postLocked[postId]) {
            revert PostNotLocked();
        }

        postLocked[postId] = false;

        emit PostUnlocked(postId, communityId, msg.sender, block.timestamp);
    }

    // Hides a regular on-chain comment. The stored commentId -> postId link
    // proves which community the comment belongs to, so only that community's
    // moderators can hide it.
    function hideComment(uint256 commentId) external {
        uint256 postId = commentPostIds[commentId];
        if (postId == 0) {
            revert CommentDoesNotExist();
        }

        uint256 communityId = forum.communityOfPost(postId);
        if (!forum.isUserModeratorOfCommunity(communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        if (commentHidden[commentId]) {
            revert CommentAlreadyHidden();
        }

        commentHidden[commentId] = true;

        emit CommentHidden(commentId, postId, communityId, msg.sender, block.timestamp);
    }

    // Reports require the reporter to have joined at least one community (a
    // cheap anti-spam signal, checked via the forum contract) - no protocol
    // fee beyond that, just the tx gas - and fully on-chain, so every
    // community moderator (on any machine) sees it. kind 0 = post, 1 = comment.
    function reportPost(uint256 postId, string calldata reason) external {
        uint256 communityId = forum.communityOfPost(postId);
        _emitReport(0, postId, communityId, reason);
    }

    function reportComment(uint256 commentId, string calldata reason) external {
        uint256 postId = commentPostIds[commentId];
        if (postId == 0) {
            revert CommentDoesNotExist();
        }

        uint256 communityId = forum.communityOfPost(postId);
        _emitReport(1, commentId, communityId, reason);
    }

    // Shared report path: only real (community-joined) accounts can report,
    // the reason is bounded, and one address cannot report the same content
    // twice.
    function _emitReport(uint8 kind, uint256 refId, uint256 communityId, string calldata reason) private {
        if (!forum.hasJoinedAnyCommunity(msg.sender)) {
            revert MustJoinCommunityFirst();
        }

        _requireMaxLen(bytes(reason).length, MAX_REASON_LENGTH);

        bytes32 reportKey = keccak256(abi.encodePacked(msg.sender, kind, refId));
        if (hasReported[reportKey]) {
            revert AlreadyReported();
        }
        hasReported[reportKey] = true;

        emit ContentReported(refId, communityId, kind, msg.sender, reason, block.timestamp);
    }

    // A moderator closes out the reports on a piece of content. Off-chain the
    // subgraph flips that content's report thread out of the open queue, so a
    // handled report stops lingering. action 0 = dismissed, 1 = action taken.
    function resolveReport(uint8 kind, uint256 refId, uint8 action) external {
        uint256 communityId;
        if (kind == 0) {
            communityId = forum.communityOfPost(refId);
        } else {
            uint256 postId = commentPostIds[refId];
            if (postId == 0) {
                revert CommentDoesNotExist();
            }
            communityId = forum.communityOfPost(postId);
        }

        if (!forum.isUserModeratorOfCommunity(communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        emit ReportResolved(communityId, refId, msg.sender, kind, action, block.timestamp);
    }

    // Shared byte-length guard so a direct contract call can't store
    // oversized strings (the UI limits inputs, but the chain must enforce it
    // too).
    function _requireMaxLen(uint256 len, uint256 limit) private pure {
        if (len > limit) {
            revert InputTooLong();
        }
    }

    // READ FUNCTIONS //
    function getPendingCommentsByPost(uint256 postId) external view returns (uint256[] memory) {
        forum.communityOfPost(postId); // reverts PostDoesNotExist if missing
        return pendingCommentIdsByPost[postId];
    }

    function getPendingComment(uint256 commentId)
        external
        view
        returns (
            uint256 id,
            uint256 postId,
            address author,
            string memory content,
            string memory imageCid,
            uint256 createdAt,
            uint8 status
        )
    {
        PendingComment storage comment = pendingComments[commentId];

        if (!comment.exists) {
            revert CommentDoesNotExist();
        }

        return (
            comment.id,
            comment.postId,
            comment.author,
            comment.content,
            comment.imageCid,
            comment.createdAt,
            comment.status
        );
    }

}
