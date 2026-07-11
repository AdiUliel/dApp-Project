import { expect } from "chai";
import hre from "hardhat";

// Covers fixes #11 (length limits), #12 (vote gate - see UsernameAndVotesTest.ts),
// #13 (unified comment ids + hide/report path for approved-formerly-flagged
// comments), #14 (report lifecycle: membership, duplicate prevention, resolve)
// and #15 (case-insensitive username lookup with preserved display casing).
// Length limits and post/community creation live on DecentralizedForum;
// comments, hide, and report/resolve live on ForumModeration (see
// ModerationQueueTest.ts for the split's wiring); usernames live on the
// standalone UsernameRegistry (see UsernameAndVotesTest.ts for its other
// coverage).
describe("DecentralizedForum limits, reports, comment unification", function () {
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

  async function deployModerationSuite() {
    const forum = await deployForum();
    const moderation = await ethers.deployContract("ForumModeration", [await forum.getAddress()]);
    await moderation.waitForDeployment();
    await forum.setModerationContract(await moderation.getAddress());
    return { forum, moderation };
  }

  // owner creates + moderates community 1; user1 is a member.
  async function forumWithPost() {
    const { forum, moderation } = await deployModerationSuite();
    await forum.createCommunity("blockchain", "cid-community", "a community");
    await forum.connect(user1).joinCommunity(1n);
    await forum.createPost(1n, "cid-post", "a post", "");
    return { forum, moderation };
  }

  describe("#11 input length limits", function () {
    it("rejects an empty or over-long title", async function () {
      const { forum } = await forumWithPost();
      await expect(forum.createPost(1n, "cid", "", ""))
        .to.be.revertedWithCustomError(forum, "EmptyTitle");
      await expect(forum.createPost(1n, "cid", "t".repeat(201), ""))
        .to.be.revertedWithCustomError(forum, "InputTooLong");
    });

    it("rejects over-long tags, contentCID, description, and comment", async function () {
      const { forum, moderation } = await forumWithPost();

      await expect(forum.createPost(1n, "cid", "ok", "t".repeat(501)))
        .to.be.revertedWithCustomError(forum, "InputTooLong");
      await expect(forum.createPost(1n, "c".repeat(201), "ok", ""))
        .to.be.revertedWithCustomError(forum, "InputTooLong");
      await expect(forum.createCommunity("another", "cid", "d".repeat(2001)))
        .to.be.revertedWithCustomError(forum, "InputTooLong");
      await expect(moderation.connect(user1).addComment(1n, "x".repeat(5001), ""))
        .to.be.revertedWithCustomError(moderation, "InputTooLong");
    });

    it("rejects an over-long report reason", async function () {
      const { moderation } = await forumWithPost();
      await expect(moderation.reportPost(1n, "r".repeat(501)))
        .to.be.revertedWithCustomError(moderation, "InputTooLong");
    });

    it("accepts content exactly at the limits", async function () {
      const { forum, moderation } = await forumWithPost();
      await expect(forum.createPost(1n, "cid", "t".repeat(200), "g".repeat(500)))
        .to.emit(forum, "PostCreated");
      await expect(moderation.connect(user1).addComment(1n, "x".repeat(5000), ""))
        .to.emit(moderation, "CommentCreated");
    });
  });

  describe("#13 unified comment id space", function () {
    it("gives clean and flagged comments distinct global ids", async function () {
      const { moderation } = await forumWithPost();

      await moderation.connect(user1).addComment(1n, "clean", "");         // id 1
      await moderation.connect(user1).submitFlaggedComment(1n, "bad", ""); // id 2 (not 1)

      const pendingIds = await moderation.getPendingCommentsByPost(1n);
      expect(pendingIds.length).to.equal(1);
      expect(pendingIds[0]).to.equal(2n);
    });

    it("lets a moderator hide and report an approved formerly-flagged comment", async function () {
      const { moderation } = await forumWithPost();

      await moderation.connect(user1).addComment(1n, "clean", "");         // id 1
      await moderation.connect(user1).submitFlaggedComment(1n, "bad", ""); // id 2
      await moderation.approvePendingComment(2n);

      // The whole point of the fix: an approved flagged comment now travels the
      // same hide/report path as a clean one.
      await expect(moderation.reportComment(2n, "x")).to.emit(moderation, "ContentReported");
      await expect(moderation.hideComment(2n)).to.emit(moderation, "CommentHidden");
      expect(await moderation.commentHidden(2n)).to.equal(true);
    });

    it("cannot hide or report a flagged comment before it is approved", async function () {
      const { moderation } = await forumWithPost();
      await moderation.connect(user1).submitFlaggedComment(1n, "bad", ""); // id 1, still pending

      await expect(moderation.hideComment(1n))
        .to.be.revertedWithCustomError(moderation, "CommentDoesNotExist");
      await expect(moderation.reportComment(1n, "x"))
        .to.be.revertedWithCustomError(moderation, "CommentDoesNotExist");
    });
  });

  describe("#14 report lifecycle", function () {
    it("blocks non-members from reporting", async function () {
      const { moderation } = await forumWithPost();
      await expect(moderation.connect(user2).reportPost(1n, "spam"))
        .to.be.revertedWithCustomError(moderation, "MustJoinCommunityFirst");
    });

    it("blocks the same reporter reporting the same content twice", async function () {
      const { moderation } = await forumWithPost();
      await moderation.connect(user1).reportPost(1n, "spam");
      await expect(moderation.connect(user1).reportPost(1n, "again"))
        .to.be.revertedWithCustomError(moderation, "AlreadyReported");
    });

    it("lets a different member report the same content", async function () {
      const { forum, moderation } = await forumWithPost();
      await forum.connect(user2).joinCommunity(1n);
      await moderation.connect(user1).reportPost(1n, "spam");
      await expect(moderation.connect(user2).reportPost(1n, "me too"))
        .to.emit(moderation, "ContentReported");
    });

    it("only a moderator can resolve reports, emitting ReportResolved", async function () {
      const { moderation } = await forumWithPost();
      await moderation.connect(user1).reportPost(1n, "spam");

      await expect(moderation.connect(user1).resolveReport(0, 1n, 1))
        .to.be.revertedWithCustomError(moderation, "OnlyCommunityModeratorAllowed");

      await expect(moderation.resolveReport(0, 1n, 1))
        .to.emit(moderation, "ReportResolved");
    });

    it("reverts resolving reports on non-existent content", async function () {
      const { forum, moderation } = await forumWithPost();
      await expect(moderation.resolveReport(0, 99n, 1))
        .to.be.revertedWithCustomError(forum, "PostDoesNotExist");
      await expect(moderation.resolveReport(1, 99n, 1))
        .to.be.revertedWithCustomError(moderation, "CommentDoesNotExist");
    });
  });

  describe("#15 case-insensitive username lookup", function () {
    async function deployRegistry() {
      const registry = await ethers.deployContract("UsernameRegistry");
      await registry.waitForDeployment();
      return registry;
    }

    it("resolves any casing to the owner while preserving the display name", async function () {
      const registry = await deployRegistry();
      await registry.registerUsername("Alice");

      expect(await registry.getUsername(owner.address)).to.equal("Alice");
      expect(await registry.getAddressByUsername("alice")).to.equal(owner.address);
      expect(await registry.getAddressByUsername("ALICE")).to.equal(owner.address);
      expect(await registry.isUsernameAvailable("aLiCe")).to.equal(false);
    });
  });
});
