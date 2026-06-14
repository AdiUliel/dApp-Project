// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract DecentralizedForum {
    uint256 private nextCommunityId = 1;
    uint256 private nextPostId = 1;
    uint256 private nextModeratorProposalId = 1;
    uint256 private nextRemoveModeratorProposalId = 1;

    uint256 public constant POST_ACTIVITY_POINTS = 5;
    uint256 public constant ADD_MODERATOR_APPROVALS_REQUIRED = 3;

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

    struct ModeratorProposal {
        uint256 id;
        uint256 communityId;
        address candidate;
        address proposer;
        uint256 approvals;
        bool executed;
        bool exists;
    }

    struct RemoveModeratorProposal {
        uint256 id;
        uint256 communityId;
        address target;
        address proposer;
        uint256 approvals;
        bool executed;
        bool exists;
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

    mapping(uint256 => ModeratorProposal) private moderatorProposals;
    mapping(uint256 => mapping(address => bool)) private moderatorProposalApprovedBy;

    mapping(uint256 => RemoveModeratorProposal) private removeModeratorProposals;
    mapping(uint256 => mapping(address => bool)) private removeModeratorProposalApprovedBy;

    mapping(address => uint256) public userPostCount;
    mapping(address => uint256) public userCommunityCount;

    // Optional cryptographic checkpoint for off-chain comments.
    mapping(uint256 => bytes32) private commentsMerkleRootByPost;
    mapping(uint256 => uint256) private commentsMerkleRootUpdatedAt;

    // ERRORS //
    error CommunityDoesNotExist();
    error PostDoesNotExist();
    error ProposalDoesNotExist();
    error EmptyCommunityName();
    error EmptyMetadataCID();
    error EmptyContentCID();
    error EmptyPostBatch();
    error EmptyCommentsMerkleRoot();
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
    error PostAlreadyHidden();
    error PostNotHidden();

    // EVENTS //
    event CommunityCreated(
        uint256 indexed communityId,
        address indexed creator,
        string name,
        string metadataCID,
        uint256 createdAt
    );

    event SubCommunityCreated(
        uint256 indexed communityId,
        uint256 indexed parentCommunityId,
        address indexed creator,
        string name,
        string metadataCID,
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

    event ModeratorRemoved(
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

    event ModeratorProposalCreated(
        uint256 indexed proposalId,
        uint256 indexed communityId,
        address indexed candidate,
        address proposer,
        uint256 approvals,
        uint256 createdAt
    );

    event ModeratorProposalApproved(
        uint256 indexed proposalId,
        uint256 indexed communityId,
        address indexed approver,
        uint256 approvals,
        uint256 approvedAt
    );

    event ModeratorProposalExecuted(
        uint256 indexed proposalId,
        uint256 indexed communityId,
        address indexed candidate,
        uint256 executedAt
    );

    event RemoveModeratorProposalCreated(
        uint256 indexed proposalId,
        uint256 indexed communityId,
        address indexed target,
        address proposer,
        uint256 approvals,
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
        uint256 createdAt
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

    event CommentsMerkleRootUpdated(
        uint256 indexed postId,
        uint256 indexed communityId,
        bytes32 commentsMerkleRoot,
        address indexed updatedBy,
        uint256 updatedAt
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
    function createCommunity(string calldata name, string calldata metadataCID) external {
        _createCommunity(name, metadataCID, 0, msg.sender);
    }

    function createSubCommunity(uint256 parentCommunityId, string calldata name, string calldata metadataCID)
        external
        communityMustExist(parentCommunityId)
        notBanned(parentCommunityId)
    {
        _createCommunity(name, metadataCID, parentCommunityId, msg.sender);
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

        if (appointedModerators[communityId][msg.sender]) {
            appointedModerators[communityId][msg.sender] = false;
        }

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

    // Backward-compatible entry point: creates a proposal instead of directly appointing.
    function addModerator(uint256 communityId, address user)
        external
        communityMustExist(communityId)
        onlyCommunityModerator(communityId)
        returns (uint256)
    {
        return proposeModerator(communityId, user);
    }

    // Backward-compatible entry point: creates a removal proposal instead of directly removing.
    function removeModerator(uint256 communityId, address user)
        external
        communityMustExist(communityId)
        onlyCommunityModerator(communityId)
        returns (uint256)
    {
        return proposeRemoveModerator(communityId, user);
    }

    function proposeModerator(uint256 communityId, address candidate)
        public
        communityMustExist(communityId)
        onlyCommunityModerator(communityId)
        returns (uint256)
    {
        if (candidate == address(0)) {
            revert EmptyAddress();
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

        uint256 proposalId = nextModeratorProposalId;
        nextModeratorProposalId++;

        ModeratorProposal storage proposal = moderatorProposals[proposalId];
        proposal.id = proposalId;
        proposal.communityId = communityId;
        proposal.candidate = candidate;
        proposal.proposer = msg.sender;
        proposal.approvals = 1;
        proposal.exists = true;

        moderatorProposalApprovedBy[proposalId][msg.sender] = true;

        emit ModeratorProposalCreated(
            proposalId,
            communityId,
            candidate,
            msg.sender,
            proposal.approvals,
            block.timestamp
        );

        _tryExecuteModeratorProposal(proposalId);
        return proposalId;
    }

    function approveModeratorProposal(uint256 proposalId) external returns (bool) {
        ModeratorProposal storage proposal = moderatorProposals[proposalId];

        if (!proposal.exists) {
            revert ProposalDoesNotExist();
        }

        if (proposal.executed) {
            revert ProposalAlreadyExecuted();
        }

        if (!_isModerator(proposal.communityId, msg.sender)) {
            revert OnlyCommunityModeratorAllowed();
        }

        if (moderatorProposalApprovedBy[proposalId][msg.sender]) {
            revert ModeratorProposalAlreadyApproved();
        }

        moderatorProposalApprovedBy[proposalId][msg.sender] = true;
        proposal.approvals++;

        emit ModeratorProposalApproved(
            proposalId,
            proposal.communityId,
            msg.sender,
            proposal.approvals,
            block.timestamp
        );

        return _tryExecuteModeratorProposal(proposalId);
    }

    function proposeRemoveModerator(uint256 communityId, address target)
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

        removeModeratorProposalApprovedBy[proposalId][msg.sender] = true;

        emit RemoveModeratorProposalCreated(
            proposalId,
            communityId,
            target,
            msg.sender,
            proposal.approvals,
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

    function banUser(uint256 communityId, address user)
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

    function createPost(uint256 communityId, string calldata contentCID)
        external
        communityMustExist(communityId)
        onlyCommunityMember(communityId)
        notBanned(communityId)
    {
        _createPost(communityId, contentCID, msg.sender);
    }

    function batchCreatePosts(uint256 communityId, string[] calldata contentCIDs)
        external
        communityMustExist(communityId)
        onlyCommunityMember(communityId)
        notBanned(communityId)
    {
        if (contentCIDs.length == 0) {
            revert EmptyPostBatch();
        }

        for (uint256 i = 0; i < contentCIDs.length; i++) {
            _createPost(communityId, contentCIDs[i], msg.sender);
        }
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

    function restorePost(uint256 postId)
        external
        postMustExist(postId)
        onlyCommunityModerator(posts[postId].communityId)
    {
        if (!posts[postId].hidden) {
            revert PostNotHidden();
        }

        posts[postId].hidden = false;

        emit PostRestored(
            postId,
            posts[postId].communityId,
            msg.sender,
            block.timestamp
        );
    }

    function updateCommentsMerkleRoot(uint256 postId, bytes32 commentsMerkleRoot)
        external
        postMustExist(postId)
        onlyCommunityModerator(posts[postId].communityId)
    {
        if (commentsMerkleRoot == bytes32(0)) {
            revert EmptyCommentsMerkleRoot();
        }

        commentsMerkleRootByPost[postId] = commentsMerkleRoot;
        commentsMerkleRootUpdatedAt[postId] = block.timestamp;

        emit CommentsMerkleRootUpdated(
            postId,
            posts[postId].communityId,
            commentsMerkleRoot,
            msg.sender,
            block.timestamp
        );
    }

    function _createCommunity(
        string calldata name,
        string calldata metadataCID,
        uint256 parentCommunityId,
        address creator
    ) private {
        if (bytes(name).length == 0) {
            revert EmptyCommunityName();
        }

        if (bytes(metadataCID).length == 0) {
            revert EmptyMetadataCID();
        }

        bytes32 nameHash = keccak256(abi.encodePacked(parentCommunityId, name));
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
            block.timestamp
        );

        if (parentCommunityId != 0) {
            emit SubCommunityCreated(
                communityId,
                parentCommunityId,
                creator,
                name,
                metadataCID,
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

    function _createPost(uint256 communityId, string calldata contentCID, address author)
        private
    {
        if (bytes(contentCID).length == 0) {
            revert EmptyContentCID();
        }

        uint256 postId = nextPostId;
        nextPostId++;

        posts[postId] = Post({
            id: postId,
            communityId: communityId,
            author: author,
            contentCID: contentCID,
            createdAt: block.timestamp,
            exists: true,
            hidden: false
        });

        communityPostIds[communityId].push(postId);
        userPostCount[author]++;
        activityScore[communityId][author] += POST_ACTIVITY_POINTS;
        _trackKnownUser(communityId, author);
        _refreshActiveModerators(communityId);

        emit PostCreated(
            postId,
            communityId,
            author,
            contentCID,
            block.timestamp
        );
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
            _isActiveModerator(communityId, user);
    }

    function _tryExecuteModeratorProposal(uint256 proposalId) private returns (bool) {
        ModeratorProposal storage proposal = moderatorProposals[proposalId];

        if (
            proposal.executed ||
            proposal.approvals < ADD_MODERATOR_APPROVALS_REQUIRED ||
            !isMember[proposal.communityId][proposal.candidate] ||
            isBanned[proposal.communityId][proposal.candidate]
        ) {
            return false;
        }

        proposal.executed = true;
        appointedModerators[proposal.communityId][proposal.candidate] = true;
        _trackModeratorCandidate(proposal.communityId, proposal.candidate);

        emit ModeratorAdded(
            proposal.communityId,
            proposal.candidate,
            msg.sender,
            block.timestamp
        );

        emit ModeratorProposalExecuted(
            proposalId,
            proposal.communityId,
            proposal.candidate,
            block.timestamp
        );

        return true;
    }

    function _tryExecuteRemoveModeratorProposal(uint256 proposalId) private returns (bool) {
        RemoveModeratorProposal storage proposal = removeModeratorProposals[proposalId];
        uint256 requiredApprovals = getRequiredRemovalApprovals(proposal.communityId);

        if (
            proposal.executed ||
            proposal.approvals < requiredApprovals ||
            !appointedModerators[proposal.communityId][proposal.target]
        ) {
            return false;
        }

        proposal.executed = true;
        appointedModerators[proposal.communityId][proposal.target] = false;

        emit ModeratorRemoved(
            proposal.communityId,
            proposal.target,
            msg.sender,
            block.timestamp
        );

        emit RemoveModeratorProposalExecuted(
            proposalId,
            proposal.communityId,
            proposal.target,
            block.timestamp
        );

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

    function getModeratorProposal(uint256 proposalId)
        external
        view
        returns (
            uint256 id,
            uint256 communityId,
            address candidate,
            address proposer,
            uint256 approvals,
            bool executed,
            bool exists
        )
    {
        ModeratorProposal memory proposal = moderatorProposals[proposalId];
        return (
            proposal.id,
            proposal.communityId,
            proposal.candidate,
            proposal.proposer,
            proposal.approvals,
            proposal.executed,
            proposal.exists
        );
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
            bool exists
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
            proposal.exists
        );
    }

    function hasApprovedModeratorProposal(uint256 proposalId, address user) external view returns (bool) {
        return moderatorProposalApprovedBy[proposalId][user];
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

    function getCommentsMerkleRoot(uint256 postId)
        external
        view
        postMustExist(postId)
        returns (bytes32 root, uint256 updatedAt)
    {
        return (
            commentsMerkleRootByPost[postId],
            commentsMerkleRootUpdatedAt[postId]
        );
    }
}
