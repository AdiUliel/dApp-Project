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

    error PostAlreadyHidden();
    error PostNotHidden();
    error PostIsLocked();
    error PostNotLocked();
    error PostAlreadyLocked();
    error PostNotPendingReview();
    error CommentAlreadyHidden();
    error CommentDoesNotExist();
    error CommentNotPendingReview();
    error EmptyCommentContent();
    error EmptyCommentsMerkleRoot();

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

    uint256 private nextPendingCommentId = 1;
    mapping(uint256 => PendingComment) private pendingComments;
    mapping(uint256 => uint256[]) private pendingCommentIdsByPost;

    // Clean comments are event-only (content carried in the log, indexed by
    // The Graph) so they cost minimal bytecode and still flow through the dApp.
    uint256 private nextCommentId = 1;

    mapping(uint256 => bool) public postHidden;
    mapping(uint256 => bool) public postLocked;

    // commentId -> postId, recorded at creation so hideComment/reportComment
    // can resolve which community a comment belongs to.
    mapping(uint256 => uint256) private commentPostIds;
    mapping(uint256 => bool) public commentHidden;

    // Optional cryptographic checkpoint for off-chain comments.
    mapping(uint256 => bytes32) private commentsMerkleRootByPost;
    mapping(uint256 => uint256) private commentsMerkleRootUpdatedAt;

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

    event CommentsMerkleRootUpdated(
        uint256 indexed postId,
        uint256 indexed communityId,
        bytes32 commentsMerkleRoot,
        address indexed updatedBy,
        uint256 updatedAt
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

        uint256 commentId = nextPendingCommentId;
        nextPendingCommentId++;

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

    // Anyone can report content the automatic filters missed. No protocol fee -
    // just the tx gas - and fully on-chain, so every community moderator (on any
    // machine) sees it. kind 0 = post, 1 = comment.
    function reportPost(uint256 postId, string calldata reason) external {
        uint256 communityId = forum.communityOfPost(postId);
        emit ContentReported(postId, communityId, 0, msg.sender, reason, block.timestamp);
    }

    function reportComment(uint256 commentId, string calldata reason) external {
        uint256 postId = commentPostIds[commentId];
        if (postId == 0) {
            revert CommentDoesNotExist();
        }

        uint256 communityId = forum.communityOfPost(postId);
        emit ContentReported(commentId, communityId, 1, msg.sender, reason, block.timestamp);
    }

    function updateCommentsMerkleRoot(uint256 postId, bytes32 commentsMerkleRoot) external {
        uint256 communityId = forum.communityOfPost(postId);

        if (!forum.isUserModeratorOfCommunity(communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        if (commentsMerkleRoot == bytes32(0)) {
            revert EmptyCommentsMerkleRoot();
        }

        commentsMerkleRootByPost[postId] = commentsMerkleRoot;
        commentsMerkleRootUpdatedAt[postId] = block.timestamp;

        emit CommentsMerkleRootUpdated(postId, communityId, commentsMerkleRoot, msg.sender, block.timestamp);
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

    function getCommentsMerkleRoot(uint256 postId) external view returns (bytes32 root, uint256 updatedAt) {
        forum.communityOfPost(postId); // reverts PostDoesNotExist if missing
        return (commentsMerkleRootByPost[postId], commentsMerkleRootUpdatedAt[postId]);
    }
}
