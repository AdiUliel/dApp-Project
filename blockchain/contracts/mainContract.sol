// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract DecentralizedForum {
    uint256 private nextCommunityId = 1;
    uint256 private nextPostId = 1;
    uint256 private nextCommentId = 1;


// STRUCTS //
    struct Community {
        uint256 id;
        string name;
        address creator;
        string metadataCID;
        uint256 createdAt;
        uint256 membersCount;
        bool exists;
    }

    struct Post {
        uint256 id;
        uint256 communityId;
        address author;
        string contentCID;
        uint256 createdAt;
        bool exists;
    }

    struct Comment {
        uint256 id;
        uint256 postId;
        address author;
        string contentCID;
        uint256 createdAt;
        bool exists;
    }

// MAPPING //
    mapping(uint256 => Community) private communities;
    mapping(uint256 => Post) private posts;
    mapping(uint256 => Comment) private comments;

    mapping(uint256 => uint256[]) private communityPostIds;
    mapping(uint256 => uint256[]) private postCommentIds;

    mapping(uint256 => mapping(address => bool)) public isMember;

    uint256[] private allCommunityIds;
    mapping(bytes32 => bool) private communityNameExists;

    error CommunityDoesNotExist();
    error PostDoesNotExist();
    error CommentDoesNotExist();
    error EmptyCommunityName();
    error EmptyMetadataCID();
    error EmptyContentCID();
    error CommunityNameAlreadyExists();
    error AlreadyCommunityMember();
    error OnlyCommunityMembersAllowed();

    event CommunityCreated(
        uint256 indexed communityId,
        address indexed creator,
        string name,
        string metadataCID,
        uint256 createdAt
    );

    event CommunityJoined(
        uint256 indexed communityId,
        address indexed member,
        uint256 joinedAt
    );

    event PostCreated(
        uint256 indexed postId,
        uint256 indexed communityId,
        address indexed author,
        string contentCID,
        uint256 createdAt
    );

    event CommentCreated(
        uint256 indexed commentId,
        uint256 indexed postId,
        address indexed author,
        string contentCID,
        uint256 createdAt
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

    modifier commentMustExist(uint256 commentId) {
        if (!comments[commentId].exists) {
            revert CommentDoesNotExist();
        }
        _;
    }

    modifier onlyCommunityMember(uint256 communityId) {
        if (!isMember[communityId][msg.sender]) {
            revert OnlyCommunityMembersAllowed();
        }
        _;
    }

// WRITE FUNCTIONS //

    function createCommunity(string calldata name, string calldata metadataCID) external {
        if (bytes(name).length == 0) {
            revert EmptyCommunityName();
        }

        if (bytes(metadataCID).length == 0) {
            revert EmptyMetadataCID();
        }

        bytes32 nameHash = keccak256(abi.encodePacked(name));
        if (communityNameExists[nameHash]) {
            revert CommunityNameAlreadyExists();
        }

        uint256 communityId = nextCommunityId;
        nextCommunityId++;

        communities[communityId] = Community({
            id: communityId,
            name: name,
            creator: msg.sender,
            metadataCID: metadataCID,
            createdAt: block.timestamp,
            membersCount: 1,
            exists: true
        });

        allCommunityIds.push(communityId);
        communityNameExists[nameHash] = true;
        isMember[communityId][msg.sender] = true;

        emit CommunityCreated(
            communityId,
            msg.sender,
            name,
            metadataCID,
            block.timestamp
        );
    }

    function joinCommunity(uint256 communityId)
        external
        communityMustExist(communityId)
    {
        if (isMember[communityId][msg.sender]) {
            revert AlreadyCommunityMember();
        }

        isMember[communityId][msg.sender] = true;
        communities[communityId].membersCount++;

        emit CommunityJoined(
            communityId,
            msg.sender,
            block.timestamp
        );
    }

    function createPost(uint256 communityId, string calldata contentCID)
        external
        communityMustExist(communityId)
        onlyCommunityMember(communityId)
    {
        if (bytes(contentCID).length == 0) {
            revert EmptyContentCID();
        }

        uint256 postId = nextPostId;
        nextPostId++;

        posts[postId] = Post({
            id: postId,
            communityId: communityId,
            author: msg.sender,
            contentCID: contentCID,
            createdAt: block.timestamp,
            exists: true
        });

        communityPostIds[communityId].push(postId);

        emit PostCreated(
            postId,
            communityId,
            msg.sender,
            contentCID,
            block.timestamp
        );
    }

    function createComment(uint256 postId, string calldata contentCID)
        external
        postMustExist(postId)
    {
        if (bytes(contentCID).length == 0) {
            revert EmptyContentCID();
        }

        uint256 communityId = posts[postId].communityId;
        if (!isMember[communityId][msg.sender]) {
            revert OnlyCommunityMembersAllowed();
        }

        uint256 commentId = nextCommentId;
        nextCommentId++;

        comments[commentId] = Comment({
            id: commentId,
            postId: postId,
            author: msg.sender,
            contentCID: contentCID,
            createdAt: block.timestamp,
            exists: true
        });

        postCommentIds[postId].push(commentId);

        emit CommentCreated(
            commentId,
            postId,
            msg.sender,
            contentCID,
            block.timestamp
        );
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
            bool exists
        )
    {
        Post memory post = posts[postId];

        return (
            post.id,
            post.communityId,
            post.author,
            post.contentCID,
            post.createdAt,
            post.exists
        );
    }

    function getComment(uint256 commentId)
        external
        view
        commentMustExist(commentId)
        returns (
            uint256 id,
            uint256 postId,
            address author,
            string memory contentCID,
            uint256 createdAt,
            bool exists
        )
    {
        Comment memory commentData = comments[commentId];

        return (
            commentData.id,
            commentData.postId,
            commentData.author,
            commentData.contentCID,
            commentData.createdAt,
            commentData.exists
        );
    }

    function getAllCommunityIds() external view returns (uint256[] memory) {
        return allCommunityIds;
    }

    function getPostsByCommunity(uint256 communityId)
        external
        view
        communityMustExist(communityId)
        returns (uint256[] memory)
    {
        return communityPostIds[communityId];
    }

    function getCommentsByPost(uint256 postId)
        external
        view
        postMustExist(postId)
        returns (uint256[] memory)
    {
        return postCommentIds[postId];
    }

    function isUserMemberOfCommunity(uint256 communityId, address user)
        external
        view
        communityMustExist(communityId)
        returns (bool)
    {
        return isMember[communityId][user];
    }

    function getCommunityCount() external view returns (uint256) {
        return allCommunityIds.length;
    }

    function getPostCount() external view returns (uint256) {
        return nextPostId - 1;
    }

    function getCommentCount() external view returns (uint256) {
        return nextCommentId - 1;
    }

    function communityOfPost(uint256 postId)
        external
        view
        postMustExist(postId)
        returns (uint256)
    {
        return posts[postId].communityId;
    }
}