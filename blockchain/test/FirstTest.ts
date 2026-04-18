import { expect } from "chai";
import hre from "hardhat";

describe("DecentralizedForum", function () {
  let ethers: any;
  let owner: any;
  let user1: any;
  let user2: any;

  before(async function () {
    ({ ethers } = await hre.network.connect());
    [owner, user1, user2] = await ethers.getSigners();
  });

  async function deployForum() {
    const forum = await ethers.deployContract("DecentralizedForum");
    await forum.waitForDeployment();
    return forum;
  }

  describe("createCommunity", function () {
    it("should create a community successfully", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");

      const count = await forum.getCommunityCount();
      expect(count).to.equal(1n);

      const ids = await forum.getAllCommunityIds();
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);

      const community = await forum.getCommunity(1n);
      expect(community[0]).to.equal(1n); // id
      expect(community[1]).to.equal("Solidity"); // name
      expect(community[2]).to.equal(owner.address); // creator
      expect(community[3]).to.equal("cid-123"); // metadataCID
      expect(community[5]).to.equal(1n); // membersCount
      expect(community[6]).to.equal(true); // exists
    });

    it("should automatically make the creator a member", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");

      const isMember = await forum.isUserMemberOfCommunity(1n, owner.address);
      expect(isMember).to.equal(true);
    });

    it("should not allow empty community name", async function () {
      const forum = await deployForum();

      await expect(
        forum.createCommunity("", "cid-123")
      ).to.be.revertedWithCustomError(forum, "EmptyCommunityName");
    });

    it("should not allow empty metadata CID", async function () {
      const forum = await deployForum();

      await expect(
        forum.createCommunity("Solidity", "")
      ).to.be.revertedWithCustomError(forum, "EmptyMetadataCID");
    });

    it("should not allow duplicate community name", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");

      await expect(
        forum.createCommunity("Solidity", "cid-456")
      ).to.be.revertedWithCustomError(forum, "CommunityNameAlreadyExists");
    });
  });

  describe("joinCommunity", function () {
    it("should allow another user to join a community", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");
      await forum.connect(user1).joinCommunity(1n);

      const isMember = await forum.isUserMemberOfCommunity(1n, user1.address);
      expect(isMember).to.equal(true);

      const community = await forum.getCommunity(1n);
      expect(community[5]).to.equal(2n); // membersCount
    });

    it("should not allow a user to join twice", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");
      await forum.connect(user1).joinCommunity(1n);

      await expect(
        forum.connect(user1).joinCommunity(1n)
      ).to.be.revertedWithCustomError(forum, "AlreadyCommunityMember");
    });

    it("should not allow joining a non-existing community", async function () {
      const forum = await deployForum();

      await expect(
        forum.connect(user1).joinCommunity(999n)
      ).to.be.revertedWithCustomError(forum, "CommunityDoesNotExist");
    });
  });

  describe("createPost", function () {
    it("should allow a member to create a post", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");
      await forum.connect(user1).joinCommunity(1n);

      await forum.connect(user1).createPost(1n, "post-cid-1");

      const postCount = await forum.getPostCount();
      expect(postCount).to.equal(1n);

      const postIds = await forum.getPostsByCommunity(1n);
      expect(postIds.length).to.equal(1);
      expect(postIds[0]).to.equal(1n);

      const post = await forum.getPost(1n);
      expect(post[0]).to.equal(1n); // id
      expect(post[1]).to.equal(1n); // communityId
      expect(post[2]).to.equal(user1.address); // author
      expect(post[3]).to.equal("post-cid-1"); // contentCID
      expect(post[5]).to.equal(true); // exists
    });

    it("should not allow a non-member to create a post", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");

      await expect(
        forum.connect(user1).createPost(1n, "post-cid-1")
      ).to.be.revertedWithCustomError(forum, "OnlyCommunityMembersAllowed");
    });

    it("should not allow creating a post in a non-existing community", async function () {
      const forum = await deployForum();

      await expect(
        forum.createPost(999n, "post-cid-1")
      ).to.be.revertedWithCustomError(forum, "CommunityDoesNotExist");
    });

    it("should not allow empty post CID", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");

      await expect(
        forum.createPost(1n, "")
      ).to.be.revertedWithCustomError(forum, "EmptyContentCID");
    });
  });

  describe("createComment", function () {
    it("should allow a member to comment on a post", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");
      await forum.connect(user1).joinCommunity(1n);
      await forum.connect(user2).joinCommunity(1n);

      await forum.connect(user1).createPost(1n, "post-cid-1");
      await forum.connect(user2).createComment(1n, "comment-cid-1");

      const commentCount = await forum.getCommentCount();
      expect(commentCount).to.equal(1n);

      const commentIds = await forum.getCommentsByPost(1n);
      expect(commentIds.length).to.equal(1);
      expect(commentIds[0]).to.equal(1n);

      const comment = await forum.getComment(1n);
      expect(comment[0]).to.equal(1n); // id
      expect(comment[1]).to.equal(1n); // postId
      expect(comment[2]).to.equal(user2.address); // author
      expect(comment[3]).to.equal("comment-cid-1"); // contentCID
      expect(comment[5]).to.equal(true); // exists
    });

    it("should not allow a non-member to comment", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");
      await forum.connect(user1).joinCommunity(1n);
      await forum.connect(user1).createPost(1n, "post-cid-1");

      await expect(
        forum.connect(user2).createComment(1n, "comment-cid-1")
      ).to.be.revertedWithCustomError(forum, "OnlyCommunityMembersAllowed");
    });

    it("should not allow commenting on a non-existing post", async function () {
      const forum = await deployForum();

      await expect(
        forum.createComment(999n, "comment-cid-1")
      ).to.be.revertedWithCustomError(forum, "PostDoesNotExist");
    });

    it("should not allow empty comment CID", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");
      await forum.createPost(1n, "post-cid-1");

      await expect(
        forum.createComment(1n, "")
      ).to.be.revertedWithCustomError(forum, "EmptyContentCID");
    });
  });

  describe("read functions", function () {
    it("should return the correct community id for a post", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");
      await forum.createPost(1n, "post-cid-1");

      const communityId = await forum.communityOfPost(1n);
      expect(communityId).to.equal(1n);
    });

    it("should return false for a user who is not a member", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");

      const isMember = await forum.isUserMemberOfCommunity(1n, user1.address);
      expect(isMember).to.equal(false);
    });

    it("should keep correct counts across actions", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123");
      await forum.connect(user1).joinCommunity(1n);
      await forum.createPost(1n, "post-cid-1");
      await forum.connect(user1).createComment(1n, "comment-cid-1");

      expect(await forum.getCommunityCount()).to.equal(1n);
      expect(await forum.getPostCount()).to.equal(1n);
      expect(await forum.getCommentCount()).to.equal(1n);
    });
  });
});