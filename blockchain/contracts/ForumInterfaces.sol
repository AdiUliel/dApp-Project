// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

// Small permission-check surface DecentralizedForum exposes to ForumModeration.
// Kept minimal on purpose - the main contract does not know about moderation
// concepts (pending/hidden/locked/reported), it only answers "who is this
// user in this community" questions.
interface IDecentralizedForum {
    function isUserModeratorOfCommunity(uint256 communityId, address user) external view returns (bool);
    function isUserMemberOfCommunity(uint256 communityId, address user) external view returns (bool);
    function isUserBannedFromCommunity(uint256 communityId, address user) external view returns (bool);
    function communityOfPost(uint256 postId) external view returns (uint256);
    function awardPostApprovalActivity(uint256 communityId, address author) external;
    // Anti-spam signal reused by ForumModeration's report gate: has this
    // address ever joined a community (net of leaves/bans)?
    function hasJoinedAnyCommunity(address user) external view returns (bool);
}

// The one call DecentralizedForum makes back into ForumModeration: handing
// off a freshly-created flagged post into the review queue.
interface IForumModeration {
    function flagPostForReview(
        uint256 postId,
        uint256 communityId,
        address author,
        string calldata title
    ) external;
}
