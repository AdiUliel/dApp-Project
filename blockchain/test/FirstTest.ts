import { expect } from "chai";
import hre from "hardhat";

describe("DecentralizedForum", function () {
  let ethers: any;
  let owner: any;
  let user1: any;
  let user2: any;
  let user3: any;

  before(async function () {
    ({ ethers } = await hre.network.connect());
    [owner, user1, user2, user3] = await ethers.getSigners();
  });

  async function deployForum() {
    const forum = await ethers.deployContract("DecentralizedForum");
    await forum.waitForDeployment();
    return forum;
  }

  describe("createCommunity", function () {
    it("should create a community, make creator a member, and make creator moderator", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");

      expect(await forum.getCommunityCount()).to.equal(1n);
      expect(await forum.userCommunityCount(owner.address)).to.equal(1n);

      const ids = await forum.getAllCommunityIds();
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);

      const community = await forum.getCommunity(1n);
      expect(community[0]).to.equal(1n);
      expect(community[1]).to.equal("Solidity");
      expect(community[2]).to.equal(owner.address);
      expect(community[3]).to.equal("cid-123");
      expect(community[5]).to.equal(1n);
      expect(community[6]).to.equal(true);

      expect(await forum.isUserMemberOfCommunity(1n, owner.address)).to.equal(true);
      expect(await forum.isUserModeratorOfCommunity(1n, owner.address)).to.equal(true);
      expect(await forum.getUserJoinedAt(1n, owner.address)).to.be.greaterThan(0n);
    });

    it("should not allow empty community name", async function () {
      const forum = await deployForum();

      await expect(
        forum.createCommunity("", "cid-123", "a community")
      ).to.be.revertedWithCustomError(forum, "EmptyCommunityName");
    });

    it("should not allow empty metadata CID", async function () {
      const forum = await deployForum();

      await expect(
        forum.createCommunity("Solidity", "", "a community")
      ).to.be.revertedWithCustomError(forum, "EmptyMetadataCID");
    });

    it("should not allow duplicate community name", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");

      await expect(
        forum.createCommunity("Solidity", "cid-456", "a community")
      ).to.be.revertedWithCustomError(forum, "CommunityNameAlreadyExists");
    });

    it("should allow only creator to update community metadata", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");
      await forum.updateCommunityMetadata(1n, "cid-456");

      const community = await forum.getCommunity(1n);
      expect(community[3]).to.equal("cid-456");

      await expect(
        forum.connect(user1).updateCommunityMetadata(1n, "cid-789")
      ).to.be.revertedWithCustomError(forum, "OnlyCommunityCreatorAllowed");
    });
  });

  describe("joinCommunity and leaveCommunity", function () {
    it("should allow another user to join a community", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");
      await forum.connect(user1).joinCommunity(1n);

      expect(await forum.isUserMemberOfCommunity(1n, user1.address)).to.equal(true);
      expect(await forum.getUserJoinedAt(1n, user1.address)).to.be.greaterThan(0n);

      const community = await forum.getCommunity(1n);
      expect(community[5]).to.equal(2n);
    });

    it("should not allow a user to join twice", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");
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

    it("should allow a regular member to leave but not the creator", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");
      await forum.connect(user1).joinCommunity(1n);
      await forum.connect(user1).leaveCommunity(1n);

      expect(await forum.isUserMemberOfCommunity(1n, user1.address)).to.equal(false);
      expect(await forum.getUserJoinedAt(1n, user1.address)).to.equal(0n);

      await expect(
        forum.leaveCommunity(1n)
      ).to.be.revertedWithCustomError(forum, "CannotRemoveCreatorModerator");
    });
  });

  describe("moderators and bans", function () {
    it("records a recommendation instead of appointing directly (governance flow)", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");
      await forum.connect(user1).joinCommunity(1n);

      await forum.recommendModerator(1n, user1.address);

      // The creator is the sole moderator, so one recommendation reaches the
      // adaptive threshold and opens an offer - but the role is only granted
      // once the candidate accepts.
      expect(await forum.isUserModeratorOfCommunity(1n, user1.address)).to.equal(false);
      expect(await forum.hasRecommendedModerator(1n, user1.address, owner.address)).to.equal(true);
      expect(await forum.hasPendingModeratorOffer(1n, user1.address)).to.equal(true);
    });

    it("should not allow a non-moderator member to recommend a moderator", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");
      await forum.connect(user1).joinCommunity(1n);
      await forum.connect(user2).joinCommunity(1n);

      await expect(
        forum.connect(user2).recommendModerator(1n, user1.address)
      ).to.be.revertedWithCustomError(forum, "OnlyCommunityModeratorAllowed");
    });

    it("should allow moderator to ban and unban users", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");
      await forum.connect(user1).joinCommunity(1n);

      await forum.banUser(1n, user1.address);

      expect(await forum.isUserBannedFromCommunity(1n, user1.address)).to.equal(true);
      expect(await forum.isUserMemberOfCommunity(1n, user1.address)).to.equal(false);

      await expect(
        forum.connect(user1).joinCommunity(1n)
      ).to.be.revertedWithCustomError(forum, "UserBannedFromCommunity");

      await forum.unbanUser(1n, user1.address);
      expect(await forum.isUserBannedFromCommunity(1n, user1.address)).to.equal(false);
    });

    it("should not allow banning the community creator", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");

      await expect(
        forum.banUser(1n, owner.address)
      ).to.be.revertedWithCustomError(forum, "CannotBanCommunityCreator");
    });
  });

  describe("createPost", function () {
    it("should allow a member to create a post", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");
      await forum.connect(user1).joinCommunity(1n);

      await forum.connect(user1).createPost(1n, "post-cid-1", "a title", "tag1,tag2");

      expect(await forum.getPostCount()).to.equal(1n);
      expect(await forum.userPostCount(user1.address)).to.equal(1n);

      const postIds = await forum.getPostsByCommunity(1n);
      expect(postIds.length).to.equal(1);
      expect(postIds[0]).to.equal(1n);

      const post = await forum.getPost(1n);
      expect(post[0]).to.equal(1n);
      expect(post[1]).to.equal(1n);
      expect(post[2]).to.equal(user1.address);
      expect(post[3]).to.equal("post-cid-1");
      expect(post[5]).to.equal(true);
    });

    it("should not allow a non-member to create a post", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");

      await expect(
        forum.connect(user1).createPost(1n, "post-cid-1", "a title", "tag1,tag2")
      ).to.be.revertedWithCustomError(forum, "OnlyCommunityMembersAllowed");
    });

    it("should not allow creating a post in a non-existing community", async function () {
      const forum = await deployForum();

      await expect(
        forum.createPost(999n, "post-cid-1", "a title", "tag1,tag2")
      ).to.be.revertedWithCustomError(forum, "CommunityDoesNotExist");
    });

    it("should not allow empty post CID", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");

      await expect(
        forum.createPost(1n, "", "a title", "tag1,tag2")
      ).to.be.revertedWithCustomError(forum, "EmptyContentCID");
    });

    it("should allow batch post creation", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");
      await forum.batchCreatePosts(1n, ["post-cid-1", "post-cid-2", "post-cid-3"], ["t1", "t2", "t3"], ["", "", ""]);

      expect(await forum.getPostCount()).to.equal(3n);
      expect(await forum.userPostCount(owner.address)).to.equal(3n);

      const postIds = await forum.getPostsByCommunity(1n);
      expect(postIds.map((id: bigint) => id)).to.deep.equal([1n, 2n, 3n]);
    });

    it("should not allow empty batch", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");

      await expect(
        forum.batchCreatePosts(1n, [], [], [])
      ).to.be.revertedWithCustomError(forum, "EmptyPostBatch");
    });
  });

  // Post hide/restore and the comments Merkle root checkpoint now live on
  // ForumModeration - see ModerationQueueTest.ts.

  describe("read functions", function () {
    it("should return the correct community id for a post", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");
      await forum.createPost(1n, "post-cid-1", "a title", "tag1,tag2");

      const communityId = await forum.communityOfPost(1n);
      expect(communityId).to.equal(1n);
    });

    it("should return false for a user who is not a member", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");

      const isMember = await forum.isUserMemberOfCommunity(1n, user1.address);
      expect(isMember).to.equal(false);
    });

    it("should keep correct counts across actions", async function () {
      const forum = await deployForum();

      await forum.createCommunity("Solidity", "cid-123", "a community");
      await forum.connect(user1).joinCommunity(1n);
      await forum.createPost(1n, "post-cid-1", "a title", "tag1,tag2");
      await forum.batchCreatePosts(1n, ["post-cid-2", "post-cid-3"], ["t2", "t3"], ["", ""]);

      expect(await forum.getCommunityCount()).to.equal(1n);
      expect(await forum.getPostCount()).to.equal(3n);
    });
  });
});
