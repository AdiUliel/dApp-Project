// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract DecentralizedForum {
    uint256 private nextCommunityId = 1;
    uint256 private nextPostId = 1;
    uint256 private nextRemoveModeratorProposalId = 1;

    uint256 public constant POST_ACTIVITY_POINTS = 5;
    uint256 public constant MODERATOR_RECOMMENDATIONS_REQUIRED = 3;
    // A moderator-removal vote is only valid for this long after it opens.
    uint256 public constant REMOVAL_PROPOSAL_DURATION = 7 days;
    uint256 public constant USERNAME_CHANGE_FEE = 0.05 ether;
    uint256 public constant USERNAME_MIN_LENGTH = 3;
    uint256 public constant USERNAME_MAX_LENGTH = 20;

    // On-chain input length caps (bytes). Kept private (no public getter) to save
    // bytecode; the values are asserted directly in the tests.
    uint256 private constant MAX_TITLE_LENGTH = 200;
    uint256 private constant MAX_TAGS_LENGTH = 500;
    uint256 private constant MAX_COMMENT_LENGTH = 5000;
    uint256 private constant MAX_REASON_LENGTH = 500;
    uint256 private constant MAX_CID_LENGTH = 200;
    uint256 private constant MAX_DESCRIPTION_LENGTH = 2000;

    // STRUCTS //
    struct Community {
        uint256 id;
        string name;
        address creator;
        string metadataCID;
        uint256 createdAt;
        uint256 membersCount;
        bool exists;
        uint256 parentCommunityId;
    }

    struct Post {
        uint256 id;
        uint256 communityId;
        address author;
        string contentCID;
        uint256 createdAt;
        bool exists;
        bool hidden;
    }

    struct RemoveModeratorProposal {
        uint256 id;
        uint256 communityId;
        address target;
        address proposer;
        uint256 approvals;
        bool executed;
        bool exists;
        string reason;
        // Snapshotted at creation so a later change in moderator count can't move
        // the goalposts, and a deadline so a stale vote can't linger forever.
        uint256 requiredApprovals;
        uint256 deadline;
    }

    // STORAGE //
    mapping(uint256 => Community) private communities;
    mapping(uint256 => Post) private posts;

    mapping(uint256 => uint256[]) private communityPostIds;
    mapping(uint256 => uint256[]) private subCommunityIds;
    uint256[] private allCommunityIds;

    mapping(bytes32 => bool) private communityNameExists;

    mapping(uint256 => mapping(address => bool)) public isMember;
    mapping(uint256 => mapping(address => uint256)) public joinedAt;
    mapping(uint256 => mapping(address => bool)) public isBanned;

    mapping(uint256 => address[]) private communityKnownUsers;
    mapping(uint256 => mapping(address => bool)) private isKnownUserInCommunity;

    mapping(uint256 => mapping(address => uint256)) public activityScore;
    mapping(uint256 => address[2]) private topActiveUsers;

    mapping(uint256 => mapping(address => bool)) private creatorModerators;
    mapping(uint256 => mapping(address => bool)) private appointedModerators;
    mapping(uint256 => address[]) private moderatorCandidates;
    mapping(uint256 => mapping(address => bool)) private isModeratorCandidateKnown;

    // Named (non-anonymous) moderator recommendations - hasRecommendedModerator
    // publicly reveals who recommended whom, and that is intended.
    // MODERATOR_RECOMMENDATIONS_REQUIRED distinct votes open a moderator offer
    // the candidate must accept. A recommendation keeps counting even if its
    // author later stops being a moderator. Rounds invalidate old votes whenever
    // an offer is resolved or cancelled, so a fresh nomination starts from zero.
    mapping(uint256 => mapping(address => uint256)) private recommendationRound;
    mapping(uint256 => mapping(address => uint256)) private recommendationCount;
    mapping(bytes32 => bool) private recommendedInRound;
    mapping(uint256 => mapping(address => bool)) private pendingModeratorOffers;
    mapping(uint256 => mapping(address => bool)) private resignedModerators;

    mapping(uint256 => RemoveModeratorProposal) private removeModeratorProposals;
    mapping(uint256 => mapping(address => bool)) private removeModeratorProposalApprovedBy;
    mapping(uint256 => uint256[]) private removalProposalIdsByCommunity;

    mapping(address => uint256) public userPostCount;
    mapping(address => uint256) public userCommunityCount;


    mapping(address => string) private usernames;
    mapping(bytes32 => bool) private usernameExists;
    mapping(bytes32 => address) private usernameOwner;

    mapping(uint256 => mapping(address => int8)) public postVotes;
    mapping(uint256 => int256) public postScore;

    mapping(uint256 => bool) public postPendingReview;
    mapping(uint256 => bool) public postRejected;

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

    mapping(uint256 => PendingComment) private pendingComments;
    mapping(uint256 => uint256[]) private pendingCommentIdsByPost;

    // Clean comments are event-only (content carried in the log, indexed by The
    // Graph) so they cost minimal bytecode and still flow through the dApp.
    // Shared by clean AND flagged comments so ids never collide (see #13).
    uint256 private nextCommentId = 1;

    // Locked posts stay visible but accept no new comments (clean or flagged).
    mapping(uint256 => bool) public postLocked;
    // commentId -> postId, recorded at creation so hideComment can verify the
    // caller moderates the community the comment actually belongs to.
    mapping(uint256 => uint256) private commentPostIds;
    mapping(uint256 => bool) public commentHidden;

    // Prevents the same address reporting the same content twice.
    // key = keccak256(reporter, kind, refId).
    mapping(bytes32 => bool) private hasReported;

    // ERRORS //
    error CommunityDoesNotExist();
    error PostDoesNotExist();
    error ProposalDoesNotExist();
    error EmptyCommunityName();
    error EmptyMetadataCID();
    error EmptyContentCID();
    error EmptyAddress();
    error CommunityNameAlreadyExists();
    error AlreadyCommunityMember();
    error NotCommunityMember();
    error OnlyCommunityMembersAllowed();
    error OnlyCommunityCreatorAllowed();
    error OnlyCommunityModeratorAllowed();
    error UserBannedFromCommunity();
    error UserNotBannedFromCommunity();
    error AlreadyModerator();
    error NotModerator();
    error CannotRemoveCreatorModerator();
    error CannotBanCommunityCreator();
    error CannotRemoveActiveModeratorWithVote();
    error ModeratorProposalAlreadyApproved();
    error ProposalAlreadyExecuted();
    error ProposalExpired();
    error CannotRestoreModeratedPost();
    error AlreadyRecommended();
    error CannotRecommendSelf();
    error ModeratorOfferAlreadyPending();
    error NoPendingModeratorOffer();
    error PostAlreadyHidden();
    error PostNotHidden();
    error PostIsLocked();
    error PostNotLocked();
    error PostAlreadyLocked();
    error CommentAlreadyHidden();
    error EmptyUsername();
    error UsernameAlreadyTaken();
    error UsernameAlreadySet();
    error UsernameTooShort();
    error UsernameTooLong();
    error InvalidUsernameCharacter();
    error ReservedUsername();
    error NoUsernameSet();
    error InsufficientUsernameChangeFee();
    error InvalidVoteValue();
    error InvalidCommunityName();
    error PostNotPendingReview();
    error CommentDoesNotExist();
    error CommentNotPendingReview();
    error EmptyCommentContent();
    error EmptyTitle();
    error InputTooLong();
    error MustJoinCommunityFirst();
    error AlreadyReported();

    // EVENTS //
    event CommunityCreated(
        uint256 indexed communityId,
        address indexed creator,
        string name,
        string metadataCID,
        string description,
        uint256 createdAt
    );

    event SubCommunityCreated(
        uint256 indexed communityId,
        uint256 indexed parentCommunityId,
        address indexed creator,
        string name,
        string metadataCID,
        string description,
        uint256 createdAt
    );

    event CommunityMetadataUpdated(
        uint256 indexed communityId,
        string metadataCID,
        uint256 updatedAt
    );

    event CommunityJoined(
        uint256 indexed communityId,
        address indexed member,
        uint256 joinedAt
    );

    event CommunityLeft(
        uint256 indexed communityId,
        address indexed member,
        uint256 leftAt
    );

    event ModeratorAdded(
        uint256 indexed communityId,
        address indexed moderator,
        address indexed addedBy,
        uint256 addedAt
    );

    // Emitted when someone stops being a moderator by ANY path (removal vote,
    // ban, leave, resign) - i.e. they have lost all moderator access.
    event ModeratorRemoved(
        uint256 indexed communityId,
        address indexed moderator,
        address indexed removedBy,
        uint256 removedAt
    );

    // Emitted when only the appointed role is stripped by a removal vote. The
    // person may still be a moderator via the creator or active-moderator role;
    // ModeratorRemoved fires in the same tx only if they lost everything.
    event AppointedModeratorRoleRemoved(
        uint256 indexed communityId,
        address indexed moderator,
        address indexed removedBy,
        uint256 removedAt
    );

    event ActiveModeratorsUpdated(
        uint256 indexed communityId,
        address firstActiveModerator,
        address secondActiveModerator,
        uint256 updatedAt
    );

    event ModeratorRecommended(
        uint256 indexed communityId,
        address indexed candidate,
        address indexed recommender,
        uint256 recommendations,
        uint256 recommendedAt
    );

    event ModeratorOfferCreated(
        uint256 indexed communityId,
        address indexed candidate,
        uint256 createdAt
    );

    event ModeratorOfferAccepted(
        uint256 indexed communityId,
        address indexed candidate,
        uint256 acceptedAt
    );

    event ModeratorOfferDeclined(
        uint256 indexed communityId,
        address indexed candidate,
        uint256 declinedAt
    );

    event ModeratorResigned(
        uint256 indexed communityId,
        address indexed moderator,
        uint256 resignedAt
    );

    event RemoveModeratorProposalCreated(
        uint256 indexed proposalId,
        uint256 indexed communityId,
        address indexed target,
        address proposer,
        uint256 approvals,
        string reason,
        uint256 requiredApprovals,
        uint256 deadline,
        uint256 createdAt
    );

    event RemoveModeratorProposalApproved(
        uint256 indexed proposalId,
        uint256 indexed communityId,
        address indexed approver,
        uint256 approvals,
        uint256 approvedAt
    );

    event RemoveModeratorProposalExecuted(
        uint256 indexed proposalId,
        uint256 indexed communityId,
        address indexed target,
        uint256 executedAt
    );

    event UserBanned(
        uint256 indexed communityId,
        address indexed user,
        address indexed bannedBy,
        string reason,
        uint256 bannedAt
    );

    event UserUnbanned(
        uint256 indexed communityId,
        address indexed user,
        address indexed unbannedBy,
        uint256 unbannedAt
    );

    event PostCreated(
        uint256 indexed postId,
        uint256 indexed communityId,
        address indexed author,
        string contentCID,
        string title,
        string tags,
        uint256 createdAt
    );

    event PostVoted(
        uint256 indexed postId,
        uint256 indexed communityId,
        address indexed voter,
        int8 vote,
        int256 newScore,
        uint256 votedAt
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


    event UsernameRegistered(
        address indexed user,
        string username,
        uint256 registeredAt
    );

    event UsernameChanged(
        address indexed user,
        string oldUsername,
        string newUsername,
        uint256 changedAt
    );

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
    // flips the content's report thread to resolved so it leaves the open queue.
    // action 0 = dismissed (report unfounded), 1 = action taken.
    event ReportResolved(
        uint256 indexed communityId,
        uint256 indexed refId,
        address indexed resolvedBy,
        uint8 kind,
        uint8 action,
        uint256 resolvedAt
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

    // MODIFIERS //
    modifier communityMustExist(uint256 communityId) {
        if (!communities[communityId].exists) {
            revert CommunityDoesNotExist();
        }
        _;
    }

    modifier postMustExist(uint256 postId) {
        if (!posts[postId].exists) {
            revert PostDoesNotExist();
        }
        _;
    }

    modifier onlyCommunityMember(uint256 communityId) {
        if (!isMember[communityId][msg.sender]) {
            revert OnlyCommunityMembersAllowed();
        }
        _;
    }

    modifier notBanned(uint256 communityId) {
        if (isBanned[communityId][msg.sender]) {
            revert UserBannedFromCommunity();
        }
        _;
    }

    modifier onlyCommunityCreator(uint256 communityId) {
        if (communities[communityId].creator != msg.sender) {
            revert OnlyCommunityCreatorAllowed();
        }
        _;
    }

    modifier onlyCommunityModerator(uint256 communityId) {
        if (!_isModerator(communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }
        _;
    }

    // WRITE FUNCTIONS //
    function createCommunity(string calldata name, string calldata metadataCID, string calldata description) external {
        _createCommunity(name, metadataCID, description, 0, msg.sender);
    }

    function createSubCommunity(
        uint256 parentCommunityId,
        string calldata name,
        string calldata metadataCID,
        string calldata description
    )
        external
        communityMustExist(parentCommunityId)
        notBanned(parentCommunityId)
    {
        _createCommunity(name, metadataCID, description, parentCommunityId, msg.sender);
    }

    function updateCommunityMetadata(uint256 communityId, string calldata metadataCID)
        external
        communityMustExist(communityId)
        onlyCommunityCreator(communityId)
    {
        if (bytes(metadataCID).length == 0) {
            revert EmptyMetadataCID();
        }

        communities[communityId].metadataCID = metadataCID;

        emit CommunityMetadataUpdated(
            communityId,
            metadataCID,
            block.timestamp
        );
    }

    function joinCommunity(uint256 communityId)
        external
        communityMustExist(communityId)
        notBanned(communityId)
    {
        if (isMember[communityId][msg.sender]) {
            revert AlreadyCommunityMember();
        }

        isMember[communityId][msg.sender] = true;
        joinedAt[communityId][msg.sender] = block.timestamp;
        communities[communityId].membersCount++;
        userCommunityCount[msg.sender]++;
        _trackKnownUser(communityId, msg.sender);

        emit CommunityJoined(
            communityId,
            msg.sender,
            block.timestamp
        );
    }

    function leaveCommunity(uint256 communityId)
        external
        communityMustExist(communityId)
    {
        if (!isMember[communityId][msg.sender]) {
            revert NotCommunityMember();
        }

        if (communities[communityId].creator == msg.sender) {
            revert CannotRemoveCreatorModerator();
        }

        bool wasModerator = _isModerator(communityId, msg.sender);

        isMember[communityId][msg.sender] = false;
        joinedAt[communityId][msg.sender] = 0;
        communities[communityId].membersCount--;
        userCommunityCount[msg.sender]--;

        if (appointedModerators[communityId][msg.sender]) {
            appointedModerators[communityId][msg.sender] = false;
        }

        // Leaving forfeits activity points in this community (you can't stay a
        // moderator on a community you left), so rejoining starts from zero.
        activityScore[communityId][msg.sender] = 0;
        _resetRecommendations(communityId, msg.sender);
        _refreshActiveModerators(communityId);

        if (wasModerator && !_isModerator(communityId, msg.sender)) {
            emit ModeratorRemoved(
                communityId,
                msg.sender,
                msg.sender,
                block.timestamp
            );
        }

        emit CommunityLeft(
            communityId,
            msg.sender,
            block.timestamp
        );
    }

    // Only current moderators can recommend a candidate. The offer opens once
    // min(MODERATOR_RECOMMENDATIONS_REQUIRED, moderator count) distinct
    // moderators recommend, so small communities are not deadlocked. The
    // candidate must accept before becoming a moderator. One vote per
    // moderator per round; self-recommendation and recommending a sitting
    // moderator are rejected.
    function recommendModerator(uint256 communityId, address candidate)
        external
        communityMustExist(communityId)
        onlyCommunityModerator(communityId)
        notBanned(communityId)
    {
        if (candidate == address(0)) {
            revert EmptyAddress();
        }

        if (candidate == msg.sender) {
            revert CannotRecommendSelf();
        }

        if (isBanned[communityId][candidate]) {
            revert UserBannedFromCommunity();
        }

        if (!isMember[communityId][candidate]) {
            revert NotCommunityMember();
        }

        if (_isModerator(communityId, candidate)) {
            revert AlreadyModerator();
        }

        if (pendingModeratorOffers[communityId][candidate]) {
            revert ModeratorOfferAlreadyPending();
        }

        bytes32 voteKey = _recommendationKey(communityId, candidate, msg.sender);
        if (recommendedInRound[voteKey]) {
            revert AlreadyRecommended();
        }

        recommendedInRound[voteKey] = true;
        recommendationCount[communityId][candidate]++;
        uint256 votes = recommendationCount[communityId][candidate];

        emit ModeratorRecommended(
            communityId,
            candidate,
            msg.sender,
            votes,
            block.timestamp
        );

        if (votes >= _recommendationsRequired(communityId)) {
            pendingModeratorOffers[communityId][candidate] = true;

            emit ModeratorOfferCreated(
                communityId,
                candidate,
                block.timestamp
            );
        }
    }

    // min(MODERATOR_RECOMMENDATIONS_REQUIRED, current moderator count) - with
    // fewer than 3 moderators the community would otherwise never be able to
    // appoint anyone.
    function _recommendationsRequired(uint256 communityId) private view returns (uint256) {
        uint256 count = getModeratorCount(communityId);
        return count < MODERATOR_RECOMMENDATIONS_REQUIRED ? count : MODERATOR_RECOMMENDATIONS_REQUIRED;
    }

    function acceptModeratorRole(uint256 communityId)
        external
        communityMustExist(communityId)
        notBanned(communityId)
    {
        if (!pendingModeratorOffers[communityId][msg.sender]) {
            revert NoPendingModeratorOffer();
        }

        if (!isMember[communityId][msg.sender]) {
            revert OnlyCommunityMembersAllowed();
        }

        _resetRecommendations(communityId, msg.sender);
        resignedModerators[communityId][msg.sender] = false;
        appointedModerators[communityId][msg.sender] = true;
        _trackModeratorCandidate(communityId, msg.sender);

        emit ModeratorOfferAccepted(communityId, msg.sender, block.timestamp);

        emit ModeratorAdded(
            communityId,
            msg.sender,
            msg.sender,
            block.timestamp
        );
    }

    function declineModeratorRole(uint256 communityId)
        external
        communityMustExist(communityId)
    {
        if (!pendingModeratorOffers[communityId][msg.sender]) {
            revert NoPendingModeratorOffer();
        }

        _resetRecommendations(communityId, msg.sender);

        emit ModeratorOfferDeclined(communityId, msg.sender, block.timestamp);
    }

    // Voluntary exit from the role. Costs only the transaction gas. Resigned
    // users are also excluded from automatic activity-based moderation until
    // they accept a new offer.
    function resignModerator(uint256 communityId)
        external
        communityMustExist(communityId)
    {
        if (communities[communityId].creator == msg.sender) {
            revert CannotRemoveCreatorModerator();
        }

        if (!_isModerator(communityId, msg.sender)) {
            revert NotModerator();
        }

        appointedModerators[communityId][msg.sender] = false;
        resignedModerators[communityId][msg.sender] = true;
        _refreshActiveModerators(communityId);

        emit ModeratorResigned(communityId, msg.sender, block.timestamp);

        emit ModeratorRemoved(
            communityId,
            msg.sender,
            msg.sender,
            block.timestamp
        );
    }

    function proposeRemoveModerator(uint256 communityId, address target, string calldata reason)
        public
        communityMustExist(communityId)
        onlyCommunityModerator(communityId)
        returns (uint256)
    {
        if (target == address(0)) {
            revert EmptyAddress();
        }

        if (target == communities[communityId].creator) {
            revert CannotRemoveCreatorModerator();
        }

        if (!_isModerator(communityId, target)) {
            revert NotModerator();
        }

        if (!appointedModerators[communityId][target]) {
            revert CannotRemoveActiveModeratorWithVote();
        }

        uint256 proposalId = nextRemoveModeratorProposalId;
        nextRemoveModeratorProposalId++;

        RemoveModeratorProposal storage proposal = removeModeratorProposals[proposalId];
        proposal.id = proposalId;
        proposal.communityId = communityId;
        proposal.target = target;
        proposal.proposer = msg.sender;
        proposal.approvals = 1;
        proposal.exists = true;
        proposal.reason = reason;
        // Threshold is fixed now, not recomputed at execution time.
        proposal.requiredApprovals = getRequiredRemovalApprovals(communityId);
        proposal.deadline = block.timestamp + REMOVAL_PROPOSAL_DURATION;

        removeModeratorProposalApprovedBy[proposalId][msg.sender] = true;
        removalProposalIdsByCommunity[communityId].push(proposalId);

        emit RemoveModeratorProposalCreated(
            proposalId,
            communityId,
            target,
            msg.sender,
            proposal.approvals,
            reason,
            proposal.requiredApprovals,
            proposal.deadline,
            block.timestamp
        );

        _tryExecuteRemoveModeratorProposal(proposalId);
        return proposalId;
    }

    function approveRemoveModeratorProposal(uint256 proposalId) external returns (bool) {
        RemoveModeratorProposal storage proposal = removeModeratorProposals[proposalId];

        if (!proposal.exists) {
            revert ProposalDoesNotExist();
        }

        if (proposal.executed) {
            revert ProposalAlreadyExecuted();
        }

        if (block.timestamp > proposal.deadline) {
            revert ProposalExpired();
        }

        if (!_isModerator(proposal.communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        if (removeModeratorProposalApprovedBy[proposalId][msg.sender]) {
            revert ModeratorProposalAlreadyApproved();
        }

        removeModeratorProposalApprovedBy[proposalId][msg.sender] = true;
        proposal.approvals++;

        emit RemoveModeratorProposalApproved(
            proposalId,
            proposal.communityId,
            msg.sender,
            proposal.approvals,
            block.timestamp
        );

        return _tryExecuteRemoveModeratorProposal(proposalId);
    }

    // Moderators ban a member with a reason (indexed off-chain so other
    // moderators can see why). A ban wipes the user's activity points in this
    // community, so if they are ever unbanned they start fresh and cannot walk
    // straight back into an active-moderator slot on old activity.
    function banUser(uint256 communityId, address user, string calldata reason)
        external
        communityMustExist(communityId)
        onlyCommunityModerator(communityId)
    {
        if (user == address(0)) {
            revert EmptyAddress();
        }

        if (user == communities[communityId].creator) {
            revert CannotBanCommunityCreator();
        }

        if (isBanned[communityId][user]) {
            revert UserBannedFromCommunity();
        }

        bool wasModerator = _isModerator(communityId, user);

        if (isMember[communityId][user]) {
            isMember[communityId][user] = false;
            joinedAt[communityId][user] = 0;
            communities[communityId].membersCount--;
        }

        if (appointedModerators[communityId][user]) {
            appointedModerators[communityId][user] = false;
        }

        activityScore[communityId][user] = 0;
        _resetRecommendations(communityId, user);
        isBanned[communityId][user] = true;
        _refreshActiveModerators(communityId);

        if (wasModerator && !_isModerator(communityId, user)) {
            emit ModeratorRemoved(
                communityId,
                user,
                msg.sender,
                block.timestamp
            );
        }

        emit UserBanned(
            communityId,
            user,
            msg.sender,
            reason,
            block.timestamp
        );
    }

    function unbanUser(uint256 communityId, address user)
        external
        communityMustExist(communityId)
        onlyCommunityModerator(communityId)
    {
        if (user == address(0)) {
            revert EmptyAddress();
        }

        if (!isBanned[communityId][user]) {
            revert UserNotBannedFromCommunity();
        }

        isBanned[communityId][user] = false;

        emit UserUnbanned(
            communityId,
            user,
            msg.sender,
            block.timestamp
        );
    }

    function createPost(uint256 communityId, string calldata contentCID, string calldata title, string calldata tags)
        external
        communityMustExist(communityId)
        onlyCommunityMember(communityId)
        notBanned(communityId)
    {
        _createPost(communityId, contentCID, title, tags, msg.sender, false);
    }

    // Entry point for content the client flagged as unsafe: stored hidden and
    // awaiting a single moderator decision.
    function createFlaggedPost(uint256 communityId, string calldata contentCID, string calldata title, string calldata tags)
        external
        communityMustExist(communityId)
        onlyCommunityMember(communityId)
        notBanned(communityId)
    {
        _createPost(communityId, contentCID, title, tags, msg.sender, true);
    }

    function approvePendingPost(uint256 postId)
        external
        postMustExist(postId)
        onlyCommunityModerator(posts[postId].communityId)
    {
        if (!postPendingReview[postId]) {
            revert PostNotPendingReview();
        }

        postPendingReview[postId] = false;
        posts[postId].hidden = false;

        uint256 communityId = posts[postId].communityId;
        address author = posts[postId].author;
        activityScore[communityId][author] += POST_ACTIVITY_POINTS;
        _refreshActiveModerators(communityId);

        emit PendingPostApproved(postId, communityId, msg.sender, block.timestamp);
    }

    function rejectPendingPost(uint256 postId)
        external
        postMustExist(postId)
        onlyCommunityModerator(posts[postId].communityId)
    {
        if (!postPendingReview[postId]) {
            revert PostNotPendingReview();
        }

        postPendingReview[postId] = false;
        postRejected[postId] = true;

        emit PendingPostRejected(postId, posts[postId].communityId, msg.sender, block.timestamp);
    }

    // Publishes a clean comment straight to the chain (event-indexed). Same
    // gate as submitFlaggedComment so every instance sees the same comments.
    function addComment(uint256 postId, string calldata content, string calldata imageCid)
        external
        postMustExist(postId)
    {
        if (bytes(content).length == 0) {
            revert EmptyCommentContent();
        }

        _requireMaxLen(bytes(content).length, MAX_COMMENT_LENGTH);
        _requireMaxLen(bytes(imageCid).length, MAX_CID_LENGTH);

        uint256 communityId = posts[postId].communityId;

        if (isBanned[communityId][msg.sender]) {
            revert UserBannedFromCommunity();
        }

        if (!isMember[communityId][msg.sender]) {
            revert OnlyCommunityMembersAllowed();
        }

        if (postLocked[postId]) {
            revert PostIsLocked();
        }

        uint256 commentId = nextCommentId;
        nextCommentId++;
        commentPostIds[commentId] = postId;

        emit CommentCreated(
            commentId,
            postId,
            communityId,
            msg.sender,
            content,
            imageCid,
            block.timestamp
        );
    }

    function submitFlaggedComment(uint256 postId, string calldata content, string calldata imageCid)
        external
        postMustExist(postId)
    {
        if (bytes(content).length == 0) {
            revert EmptyCommentContent();
        }

        _requireMaxLen(bytes(content).length, MAX_COMMENT_LENGTH);
        _requireMaxLen(bytes(imageCid).length, MAX_CID_LENGTH);

        uint256 communityId = posts[postId].communityId;

        // Ban wins over the membership check: banUser also strips membership,
        // and the banned error is the meaningful one for the user.
        if (isBanned[communityId][msg.sender]) {
            revert UserBannedFromCommunity();
        }

        if (!isMember[communityId][msg.sender]) {
            revert OnlyCommunityMembersAllowed();
        }

        if (postLocked[postId]) {
            revert PostIsLocked();
        }

        // Clean and flagged comments share ONE global id space (nextCommentId) so
        // an id like "1" is never ambiguous between the two, and every comment can
        // travel the same hide/report path once it is visible.
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

        emit CommentSubmittedForReview(
            commentId,
            postId,
            communityId,
            msg.sender,
            content,
            imageCid,
            block.timestamp
        );
    }

    function approvePendingComment(uint256 commentId) external {
        PendingComment storage comment = _pendingCommentForReview(commentId);
        comment.status = 1;

        // Now that it is public, register it in the same commentId -> postId map
        // the clean comments use, so hideComment / reportComment work on it too.
        commentPostIds[commentId] = comment.postId;

        emit PendingCommentApproved(
            commentId,
            comment.postId,
            posts[comment.postId].communityId,
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
            posts[comment.postId].communityId,
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

        if (!_isModerator(posts[comment.postId].communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        return comment;
    }

    function votePost(uint256 postId, int8 vote)
        external
        postMustExist(postId)
    {
        if (vote < -1 || vote > 1) {
            revert InvalidVoteValue();
        }

        // Anti-spam: only accounts that actually belong to a community (a "real"
        // participant) may vote. Brand-new wallets that never joined anything
        // cannot brigade scores.
        if (userCommunityCount[msg.sender] == 0) {
            revert MustJoinCommunityFirst();
        }

        uint256 communityId = posts[postId].communityId;

        if (isBanned[communityId][msg.sender]) {
            revert UserBannedFromCommunity();
        }

        int8 previousVote = postVotes[postId][msg.sender];
        if (previousVote == vote) {
            return;
        }

        postVotes[postId][msg.sender] = vote;
        postScore[postId] = postScore[postId] - int256(previousVote) + int256(vote);

        emit PostVoted(
            postId,
            communityId,
            msg.sender,
            vote,
            postScore[postId],
            block.timestamp
        );
    }

    function hidePost(uint256 postId)
        external
        postMustExist(postId)
        onlyCommunityModerator(posts[postId].communityId)
    {
        if (posts[postId].hidden) {
            revert PostAlreadyHidden();
        }

        posts[postId].hidden = true;

        emit PostHidden(
            postId,
            posts[postId].communityId,
            msg.sender,
            block.timestamp
        );
    }

    // Locking keeps the post visible but blocks any new comments on it.
    function lockPost(uint256 postId)
        external
        postMustExist(postId)
        onlyCommunityModerator(posts[postId].communityId)
    {
        if (postLocked[postId]) {
            revert PostAlreadyLocked();
        }

        postLocked[postId] = true;

        emit PostLocked(
            postId,
            posts[postId].communityId,
            msg.sender,
            block.timestamp
        );
    }

    function unlockPost(uint256 postId)
        external
        postMustExist(postId)
        onlyCommunityModerator(posts[postId].communityId)
    {
        if (!postLocked[postId]) {
            revert PostNotLocked();
        }

        postLocked[postId] = false;

        emit PostUnlocked(
            postId,
            posts[postId].communityId,
            msg.sender,
            block.timestamp
        );
    }

    // Hides a regular on-chain comment. The stored commentId -> postId link
    // proves which community the comment belongs to, so only that community's
    // moderators can hide it.
    function hideComment(uint256 commentId) external {
        uint256 postId = commentPostIds[commentId];
        if (postId == 0) {
            revert CommentDoesNotExist();
        }

        uint256 communityId = posts[postId].communityId;
        if (!_isModerator(communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        if (commentHidden[commentId]) {
            revert CommentAlreadyHidden();
        }

        commentHidden[commentId] = true;

        emit CommentHidden(
            commentId,
            postId,
            communityId,
            msg.sender,
            block.timestamp
        );
    }

    // Anyone can report content the automatic filters missed. No protocol fee -
    // just the tx gas - and fully on-chain, so every community moderator (on any
    // machine) sees it. kind 0 = post, 1 = comment.
    function reportPost(uint256 postId, string calldata reason)
        external
        postMustExist(postId)
    {
        _emitReport(0, postId, posts[postId].communityId, reason);
    }

    function reportComment(uint256 commentId, string calldata reason) external {
        uint256 postId = commentPostIds[commentId];
        if (postId == 0) {
            revert CommentDoesNotExist();
        }
        _emitReport(1, commentId, posts[postId].communityId, reason);
    }

    // Shared report path: only real members can report, the reason is bounded,
    // and one address cannot report the same content twice.
    function _emitReport(uint8 kind, uint256 refId, uint256 communityId, string calldata reason) private {
        if (userCommunityCount[msg.sender] == 0) {
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
            if (!posts[refId].exists) {
                revert PostDoesNotExist();
            }
            communityId = posts[refId].communityId;
        } else {
            uint256 postId = commentPostIds[refId];
            if (postId == 0) {
                revert CommentDoesNotExist();
            }
            communityId = posts[postId].communityId;
        }

        if (!_isModerator(communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        emit ReportResolved(communityId, refId, msg.sender, kind, action, block.timestamp);
    }

    function restorePost(uint256 postId)
        external
        postMustExist(postId)
        onlyCommunityModerator(posts[postId].communityId)
    {
        if (!posts[postId].hidden) {
            revert PostNotHidden();
        }

        // Invariant: pending => hidden and rejected => hidden. A post still in
        // (or already out of) the review queue must not be made visible here;
        // use approve/reject for those instead of restore.
        if (postPendingReview[postId] || postRejected[postId]) {
            revert CannotRestoreModeratedPost();
        }

        posts[postId].hidden = false;

        emit PostRestored(
            postId,
            posts[postId].communityId,
            msg.sender,
            block.timestamp
        );
    }

    function registerUsername(string calldata username) external {
        if (bytes(usernames[msg.sender]).length != 0) {
            revert UsernameAlreadySet();
        }

        bytes32 nameHash = keccak256(_validateUsername(username));
        if (usernameExists[nameHash]) {
            revert UsernameAlreadyTaken();
        }

        usernameExists[nameHash] = true;
        usernameOwner[nameHash] = msg.sender;
        usernames[msg.sender] = username;

        emit UsernameRegistered(msg.sender, username, block.timestamp);
    }

    function changeUsername(string calldata newUsername) external payable {
        string memory oldUsername = usernames[msg.sender];

        if (bytes(oldUsername).length == 0) {
            revert NoUsernameSet();
        }

        if (msg.value < USERNAME_CHANGE_FEE) {
            revert InsufficientUsernameChangeFee();
        }

        bytes32 newHash = keccak256(_validateUsername(newUsername));
        if (usernameExists[newHash]) {
            revert UsernameAlreadyTaken();
        }

        bytes32 oldHash = keccak256(_toLower(bytes(oldUsername)));
        delete usernameExists[oldHash];
        delete usernameOwner[oldHash];
        usernameExists[newHash] = true;
        usernameOwner[newHash] = msg.sender;
        usernames[msg.sender] = newUsername;

        emit UsernameChanged(msg.sender, oldUsername, newUsername, block.timestamp);
    }

    // Community names are English-only: letters, digits, underscore, hyphen.
    // Returns the lowercased name for case-insensitive uniqueness checks.
    function _validateCommunityName(string calldata name) private pure returns (bytes memory) {
        bytes memory nameBytes = bytes(name);

        if (nameBytes.length < 3 || nameBytes.length > 30) {
            revert InvalidCommunityName();
        }

        bytes memory lower = new bytes(nameBytes.length);
        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 c = nameBytes[i];
            bool isLowerCase = (c >= 0x61 && c <= 0x7a);
            bool isUpperCase = (c >= 0x41 && c <= 0x5a);
            bool isDigit = (c >= 0x30 && c <= 0x39);
            bool isSeparator = (c == 0x5f || c == 0x2d);

            if (!isLowerCase && !isUpperCase && !isDigit && !isSeparator) {
                revert InvalidCommunityName();
            }

            lower[i] = isUpperCase ? bytes1(uint8(c) + 32) : c;
        }

        return lower;
    }

    // Enforces format (charset, length) and anti-impersonation rules. Profanity
    // filtering is handled client-side; the chain only guarantees what it can
    // verify cheaply.
    // Returns the lowercased username for case-insensitive uniqueness checks.
    function _validateUsername(string calldata username) private pure returns (bytes memory) {
        bytes memory nameBytes = bytes(username);

        if (nameBytes.length < USERNAME_MIN_LENGTH) {
            revert UsernameTooShort();
        }

        if (nameBytes.length > USERNAME_MAX_LENGTH) {
            revert UsernameTooLong();
        }

        bytes memory lower = new bytes(nameBytes.length);
        for (uint256 i = 0; i < nameBytes.length; i++) {
            bytes1 c = nameBytes[i];
            bool isLowerCase = (c >= 0x61 && c <= 0x7a);
            bool isUpperCase = (c >= 0x41 && c <= 0x5a);
            bool isDigit = (c >= 0x30 && c <= 0x39);
            bool isUnderscore = (c == 0x5f);

            if (!isLowerCase && !isUpperCase && !isDigit && !isUnderscore) {
                revert InvalidUsernameCharacter();
            }

            lower[i] = isUpperCase ? bytes1(uint8(c) + 32) : c;
        }

        if (
            _hasReservedToken(lower, "mod") ||
            _hasReservedToken(lower, "admin") ||
            _hasReservedToken(lower, "gm") ||
            _hasReservedToken(lower, "moderator")
        ) {
            revert ReservedUsername();
        }

        return lower;
    }

    // Blocks a reserved token when it stands alone: the whole name, a prefix
    // followed by a non-letter (mod_dan, admin123), or a suffix preceded by a
    // non-letter (x_mod). Tokens embedded in longer words (modern) stay legal.
    function _hasReservedToken(bytes memory lowerName, bytes memory token) private pure returns (bool) {
        uint256 nameLength = lowerName.length;
        uint256 tokenLength = token.length;

        if (nameLength < tokenLength) {
            return false;
        }

        if (nameLength == tokenLength) {
            return _matchesAt(lowerName, token, 0);
        }

        if (_matchesAt(lowerName, token, 0) && !_isLetter(lowerName[tokenLength])) {
            return true;
        }

        if (_matchesAt(lowerName, token, nameLength - tokenLength) && !_isLetter(lowerName[nameLength - tokenLength - 1])) {
            return true;
        }

        return false;
    }

    function _matchesAt(bytes memory haystack, bytes memory needle, uint256 offset) private pure returns (bool) {
        for (uint256 i = 0; i < needle.length; i++) {
            if (haystack[offset + i] != needle[i]) {
                return false;
            }
        }

        return true;
    }

    function _isLetter(bytes1 c) private pure returns (bool) {
        return c >= 0x61 && c <= 0x7a;
    }

    // Lowercases ASCII A-Z so name uniqueness is case-insensitive ("Blockchain"
    // and "blockchain" collide). Non-letters pass through unchanged.
    function _toLower(bytes memory input) private pure returns (bytes memory) {
        bytes memory out = new bytes(input.length);
        for (uint256 i = 0; i < input.length; i++) {
            bytes1 c = input[i];
            out[i] = (c >= 0x41 && c <= 0x5a) ? bytes1(uint8(c) + 32) : c;
        }
        return out;
    }

    // Shared byte-length guard so a direct contract call can't store oversized
    // strings (the UI limits inputs, but the chain must enforce it too).
    function _requireMaxLen(uint256 len, uint256 limit) private pure {
        if (len > limit) {
            revert InputTooLong();
        }
    }

    function _createCommunity(
        string calldata name,
        string calldata metadataCID,
        string calldata description,
        uint256 parentCommunityId,
        address creator
    ) private {
        if (bytes(name).length == 0) {
            revert EmptyCommunityName();
        }

        bytes memory lowerName = _validateCommunityName(name);

        if (bytes(metadataCID).length == 0) {
            revert EmptyMetadataCID();
        }

        _requireMaxLen(bytes(metadataCID).length, MAX_CID_LENGTH);
        _requireMaxLen(bytes(description).length, MAX_DESCRIPTION_LENGTH);

        // Case-insensitive uniqueness scoped to the parent community.
        bytes32 nameHash = keccak256(abi.encodePacked(parentCommunityId, lowerName));
        if (communityNameExists[nameHash]) {
            revert CommunityNameAlreadyExists();
        }

        uint256 communityId = nextCommunityId;
        nextCommunityId++;

        communities[communityId] = Community({
            id: communityId,
            name: name,
            creator: creator,
            metadataCID: metadataCID,
            createdAt: block.timestamp,
            membersCount: 1,
            exists: true,
            parentCommunityId: parentCommunityId
        });

        allCommunityIds.push(communityId);
        if (parentCommunityId != 0) {
            subCommunityIds[parentCommunityId].push(communityId);
        }
        communityNameExists[nameHash] = true;

        isMember[communityId][creator] = true;
        joinedAt[communityId][creator] = block.timestamp;
        creatorModerators[communityId][creator] = true;
        userCommunityCount[creator]++;
        _trackKnownUser(communityId, creator);
        _trackModeratorCandidate(communityId, creator);

        emit CommunityCreated(
            communityId,
            creator,
            name,
            metadataCID,
            description,
            block.timestamp
        );

        if (parentCommunityId != 0) {
            emit SubCommunityCreated(
                communityId,
                parentCommunityId,
                creator,
                name,
                metadataCID,
                description,
                block.timestamp
            );
        }

        emit CommunityJoined(
            communityId,
            creator,
            block.timestamp
        );

        emit ModeratorAdded(
            communityId,
            creator,
            creator,
            block.timestamp
        );
    }

    function _createPost(
        uint256 communityId,
        string calldata contentCID,
        string calldata title,
        string calldata tags,
        address author,
        bool flagged
    )
        private
    {
        if (bytes(contentCID).length == 0) {
            revert EmptyContentCID();
        }

        if (bytes(title).length == 0) {
            revert EmptyTitle();
        }

        _requireMaxLen(bytes(title).length, MAX_TITLE_LENGTH);
        _requireMaxLen(bytes(tags).length, MAX_TAGS_LENGTH);
        _requireMaxLen(bytes(contentCID).length, MAX_CID_LENGTH);

        uint256 postId = nextPostId;
        nextPostId++;

        posts[postId] = Post({
            id: postId,
            communityId: communityId,
            author: author,
            contentCID: contentCID,
            createdAt: block.timestamp,
            exists: true,
            hidden: flagged
        });

        communityPostIds[communityId].push(postId);
        userPostCount[author]++;
        _trackKnownUser(communityId, author);

        // Activity points wait until a moderator approves a flagged post, so
        // unsafe content cannot farm Active-Moderator status.
        if (!flagged) {
            activityScore[communityId][author] += POST_ACTIVITY_POINTS;
            _refreshActiveModerators(communityId);
        } else {
            postPendingReview[postId] = true;
        }

        emit PostCreated(
            postId,
            communityId,
            author,
            contentCID,
            title,
            tags,
            block.timestamp
        );

        if (flagged) {
            emit PostSubmittedForReview(
                postId,
                communityId,
                author,
                title,
                block.timestamp
            );
        }
    }

    function _trackKnownUser(uint256 communityId, address user) private {
        if (!isKnownUserInCommunity[communityId][user]) {
            isKnownUserInCommunity[communityId][user] = true;
            communityKnownUsers[communityId].push(user);
        }
    }

    function _trackModeratorCandidate(uint256 communityId, address user) private {
        if (!isModeratorCandidateKnown[communityId][user]) {
            isModeratorCandidateKnown[communityId][user] = true;
            moderatorCandidates[communityId].push(user);
        }
    }

    function _recommendationKey(uint256 communityId, address candidate, address voter) private view returns (bytes32) {
        return keccak256(abi.encodePacked(communityId, candidate, recommendationRound[communityId][candidate], voter));
    }

    // Starts a fresh recommendation round: prior votes stop counting and the
    // open offer (if any) is withdrawn.
    function _resetRecommendations(uint256 communityId, address user) private {
        recommendationRound[communityId][user]++;
        recommendationCount[communityId][user] = 0;
        pendingModeratorOffers[communityId][user] = false;
    }

    function _refreshActiveModerators(uint256 communityId) private {
        address[2] memory previousTop = topActiveUsers[communityId];
        address first = address(0);
        address second = address(0);
        uint256 firstScore = 0;
        uint256 secondScore = 0;
        address creator = communities[communityId].creator;

        address[] storage users = communityKnownUsers[communityId];

        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            uint256 score = activityScore[communityId][user];

            if (
                user == creator ||
                !isMember[communityId][user] ||
                isBanned[communityId][user] ||
                resignedModerators[communityId][user] ||
                score == 0
            ) {
                continue;
            }

            if (score > firstScore) {
                second = first;
                secondScore = firstScore;
                first = user;
                firstScore = score;
            } else if (score > secondScore && user != first) {
                second = user;
                secondScore = score;
            }
        }

        topActiveUsers[communityId][0] = first;
        topActiveUsers[communityId][1] = second;

        if (first != address(0)) {
            _trackModeratorCandidate(communityId, first);
        }
        if (second != address(0)) {
            _trackModeratorCandidate(communityId, second);
        }

        if (previousTop[0] != first || previousTop[1] != second) {
            emit ActiveModeratorsUpdated(communityId, first, second, block.timestamp);
        }
    }

    function _isActiveModerator(uint256 communityId, address user) private view returns (bool) {
        return topActiveUsers[communityId][0] == user || topActiveUsers[communityId][1] == user;
    }

    function _isModerator(uint256 communityId, address user) private view returns (bool) {
        if (user == address(0) || isBanned[communityId][user]) {
            return false;
        }

        return
            creatorModerators[communityId][user] ||
            appointedModerators[communityId][user] ||
            (!resignedModerators[communityId][user] && _isActiveModerator(communityId, user));
    }

    function _tryExecuteRemoveModeratorProposal(uint256 proposalId) private returns (bool) {
        RemoveModeratorProposal storage proposal = removeModeratorProposals[proposalId];

        if (
            proposal.executed ||
            block.timestamp > proposal.deadline ||
            proposal.approvals < proposal.requiredApprovals ||
            !appointedModerators[proposal.communityId][proposal.target]
        ) {
            return false;
        }

        uint256 communityId = proposal.communityId;
        address target = proposal.target;

        proposal.executed = true;
        appointedModerators[communityId][target] = false;
        _resetRecommendations(communityId, target);

        // Losing the appointed role is distinct from losing all moderator access:
        // a double-role moderator (also creator or active) keeps their status.
        emit AppointedModeratorRoleRemoved(communityId, target, msg.sender, block.timestamp);

        if (!_isModerator(communityId, target)) {
            emit ModeratorRemoved(communityId, target, msg.sender, block.timestamp);
        }

        emit RemoveModeratorProposalExecuted(proposalId, communityId, target, block.timestamp);

        return true;
    }

    // READ FUNCTIONS //
    function getCommunity(uint256 communityId)
        external
        view
        communityMustExist(communityId)
        returns (
            uint256 id,
            string memory name,
            address creator,
            string memory metadataCID,
            uint256 createdAt,
            uint256 membersCount,
            bool exists
        )
    {
        Community memory community = communities[communityId];

        return (
            community.id,
            community.name,
            community.creator,
            community.metadataCID,
            community.createdAt,
            community.membersCount,
            community.exists
        );
    }

    function getCommunityV2(uint256 communityId)
        external
        view
        communityMustExist(communityId)
        returns (
            uint256 id,
            string memory name,
            address creator,
            string memory metadataCID,
            uint256 createdAt,
            uint256 membersCount,
            bool exists,
            uint256 parentCommunityId
        )
    {
        Community memory community = communities[communityId];

        return (
            community.id,
            community.name,
            community.creator,
            community.metadataCID,
            community.createdAt,
            community.membersCount,
            community.exists,
            community.parentCommunityId
        );
    }

    function getPost(uint256 postId)
        external
        view
        postMustExist(postId)
        returns (
            uint256 id,
            uint256 communityId,
            address author,
            string memory contentCID,
            uint256 createdAt,
            bool exists,
            bool hidden
        )
    {
        Post memory post = posts[postId];

        return (
            post.id,
            post.communityId,
            post.author,
            post.contentCID,
            post.createdAt,
            post.exists,
            post.hidden
        );
    }

    function getAllCommunityIds() external view returns (uint256[] memory) {
        return allCommunityIds;
    }

    function getSubCommunities(uint256 parentCommunityId)
        external
        view
        communityMustExist(parentCommunityId)
        returns (uint256[] memory)
    {
        return subCommunityIds[parentCommunityId];
    }

    function getPostsByCommunity(uint256 communityId)
        external
        view
        communityMustExist(communityId)
        returns (uint256[] memory)
    {
        return communityPostIds[communityId];
    }

    function isUserMemberOfCommunity(uint256 communityId, address user)
        external
        view
        communityMustExist(communityId)
        returns (bool)
    {
        return isMember[communityId][user];
    }

    function isUserModeratorOfCommunity(uint256 communityId, address user)
        external
        view
        communityMustExist(communityId)
        returns (bool)
    {
        return _isModerator(communityId, user);
    }

    function getModeratorRole(uint256 communityId, address user)
        external
        view
        communityMustExist(communityId)
        returns (
            bool isModerator,
            bool isCreatorModerator,
            bool isActiveBasedModerator,
            bool isAppointedModerator
        )
    {
        return (
            _isModerator(communityId, user),
            creatorModerators[communityId][user],
            _isActiveModerator(communityId, user),
            appointedModerators[communityId][user]
        );
    }

    function getTopActiveUsers(uint256 communityId)
        external
        view
        communityMustExist(communityId)
        returns (address first, address second)
    {
        return (topActiveUsers[communityId][0], topActiveUsers[communityId][1]);
    }

    function getKnownUsersByCommunity(uint256 communityId)
        external
        view
        communityMustExist(communityId)
        returns (address[] memory)
    {
        return communityKnownUsers[communityId];
    }

    function getModeratorAddresses(uint256 communityId)
        public
        view
        communityMustExist(communityId)
        returns (address[] memory)
    {
        address[] storage candidates = moderatorCandidates[communityId];
        uint256 count = 0;

        for (uint256 i = 0; i < candidates.length; i++) {
            if (_isModerator(communityId, candidates[i])) {
                count++;
            }
        }

        address[] memory moderators = new address[](count);
        uint256 writeIndex = 0;

        for (uint256 i = 0; i < candidates.length; i++) {
            if (_isModerator(communityId, candidates[i])) {
                moderators[writeIndex] = candidates[i];
                writeIndex++;
            }
        }

        return moderators;
    }

    function getModeratorCount(uint256 communityId)
        public
        view
        communityMustExist(communityId)
        returns (uint256)
    {
        return getModeratorAddresses(communityId).length;
    }

    function getRequiredRemovalApprovals(uint256 communityId)
        public
        view
        communityMustExist(communityId)
        returns (uint256)
    {
        uint256 moderatorCount = getModeratorCount(communityId);
        if (moderatorCount == 0) {
            return 1;
        }
        return (moderatorCount + 1) / 2;
    }

    function getModeratorRecommendationStatus(uint256 communityId, address candidate)
        external
        view
        communityMustExist(communityId)
        returns (uint256 recommendations, uint256 required, bool offerPending)
    {
        return (
            recommendationCount[communityId][candidate],
            _recommendationsRequired(communityId),
            pendingModeratorOffers[communityId][candidate]
        );
    }

    function hasRecommendedModerator(uint256 communityId, address candidate, address user)
        external
        view
        returns (bool)
    {
        return recommendedInRound[_recommendationKey(communityId, candidate, user)];
    }

    function hasPendingModeratorOffer(uint256 communityId, address user)
        external
        view
        returns (bool)
    {
        return pendingModeratorOffers[communityId][user];
    }

    function getRemovalProposalsByCommunity(uint256 communityId)
        external
        view
        communityMustExist(communityId)
        returns (uint256[] memory)
    {
        return removalProposalIdsByCommunity[communityId];
    }

    function getRemoveModeratorProposal(uint256 proposalId)
        external
        view
        returns (
            uint256 id,
            uint256 communityId,
            address target,
            address proposer,
            uint256 approvals,
            bool executed,
            bool exists,
            string memory reason,
            uint256 requiredApprovals,
            uint256 deadline
        )
    {
        RemoveModeratorProposal memory proposal = removeModeratorProposals[proposalId];
        return (
            proposal.id,
            proposal.communityId,
            proposal.target,
            proposal.proposer,
            proposal.approvals,
            proposal.executed,
            proposal.exists,
            proposal.reason,
            proposal.requiredApprovals,
            proposal.deadline
        );
    }

    function hasApprovedRemoveModeratorProposal(uint256 proposalId, address user) external view returns (bool) {
        return removeModeratorProposalApprovedBy[proposalId][user];
    }

    function isUserBannedFromCommunity(uint256 communityId, address user)
        external
        view
        communityMustExist(communityId)
        returns (bool)
    {
        return isBanned[communityId][user];
    }

    function getUserJoinedAt(uint256 communityId, address user)
        external
        view
        communityMustExist(communityId)
        returns (uint256)
    {
        return joinedAt[communityId][user];
    }

    function getCommunityCount() external view returns (uint256) {
        return allCommunityIds.length;
    }

    function getPostCount() external view returns (uint256) {
        return nextPostId - 1;
    }

    function communityOfPost(uint256 postId)
        external
        view
        postMustExist(postId)
        returns (uint256)
    {
        return posts[postId].communityId;
    }

    function isPostHidden(uint256 postId)
        external
        view
        postMustExist(postId)
        returns (bool)
    {
        return posts[postId].hidden;
    }

    function getPendingCommentsByPost(uint256 postId)
        external
        view
        postMustExist(postId)
        returns (uint256[] memory)
    {
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

    function getUsername(address user) external view returns (string memory) {
        return usernames[user];
    }

    function getAddressByUsername(string calldata username) external view returns (address) {
        return usernameOwner[keccak256(_toLower(bytes(username)))];
    }

    function isUsernameAvailable(string calldata username) external view returns (bool) {
        if (bytes(username).length == 0) {
            return false;
        }

        return !usernameExists[keccak256(_toLower(bytes(username)))];
    }
}
