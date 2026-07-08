import { expect } from "chai";
import hre from "hardhat";

// Covers fixes #11 (length limits), #12 (vote gate), #13 (unified comment ids +
// hide/report path for approved-formerly-flagged comments), #14 (report
// lifecycle: membership, duplicate prevention, resolve) and #15 (case-insensitive
// username lookup with preserved display casing).
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

  // owner creates + moderates community 1; user1 is a member.
  async function forumWithPost() {
    const forum = await deployForum();
    await forum.createCommunity("blockchain", "cid-community", "a community");
    await forum.connect(user1).joinCommunity(1n);
    await forum.createPost(1n, "cid-post", "a post", "");
    return forum;
  }

  describe("#11 input length limits", function () {
    it("rejects an empty or over-long title", async function () {
      const forum = await forumWithPost();
      await expect(forum.createPost(1n, "cid", "", ""))
        .to.be.revertedWithCustomError(forum, "EmptyTitle");
      await expect(forum.createPost(1n, "cid", "t".repeat(201), ""))
        .to.be.revertedWithCustomError(forum, "InputTooLong");
    });

    it("rejects over-long tags, contentCID, description, and comment", async function () {
      const forum = await forumWithPost();

      await expect(forum.createPost(1n, "cid", "ok", "t".repeat(501)))
        .to.be.revertedWithCustomError(forum, "InputTooLong");
      await expect(forum.createPost(1n, "c".repeat(201), "ok", ""))
        .to.be.revertedWithCustomError(forum, "InputTooLong");
      await expect(forum.createCommunity("another", "cid", "d".repeat(2001)))
        .to.be.revertedWithCustomError(forum, "InputTooLong");
      await expect(forum.connect(user1).addComment(1n, "x".repeat(5001), ""))
        .to.be.revertedWithCustomError(forum, "InputTooLong");
    });

    it("rejects an over-long report reason", async function () {
      const forum = await forumWithPost();
      await expect(forum.reportPost(1n, "r".repeat(501)))
        .to.be.revertedWithCustomError(forum, "InputTooLong");
    });

    it("accepts content exactly at the limits", async function () {
      const forum = await forumWithPost();
      await expect(forum.createPost(1n, "cid", "t".repeat(200), "g".repeat(500)))
        .to.emit(forum, "PostCreated");
      await expect(forum.connect(user1).addComment(1n, "x".repeat(5000), ""))
        .to.emit(forum, "CommentCreated");
    });
  });

  describe("#13 unified comment id space", function () {
    it("gives clean and flagged comments distinct global ids", async function () {
      const forum = await forumWithPost();

      await forum.connect(user1).addComment(1n, "clean", "");         // id 1
      await forum.connect(user1).submitFlaggedComment(1n, "bad", ""); // id 2 (not 1)

      const pendingIds = await forum.getPendingCommentsByPost(1n);
      expect(pendingIds.length).to.equal(1);
      expect(pendingIds[0]).to.equal(2n);
    });

    it("lets a moderator hide and report an approved formerly-flagged comment", async function () {
      const forum = await forumWithPost();

      await forum.connect(user1).addComment(1n, "clean", "");         // id 1
      await forum.connect(user1).submitFlaggedComment(1n, "bad", ""); // id 2
      await forum.approvePendingComment(2n);

      // The whole point of the fix: an approved flagged comment now travels the
      // same hide/report path as a clean one.
      await expect(forum.reportComment(2n, "x")).to.emit(forum, "ContentReported");
      await expect(forum.hideComment(2n)).to.emit(forum, "CommentHidden");
      expect(await forum.commentHidden(2n)).to.equal(true);
    });

    it("cannot hide or report a flagged comment before it is approved", async function () {
      const forum = await forumWithPost();
      await forum.connect(user1).submitFlaggedComment(1n, "bad", ""); // id 1, still pending

      await expect(forum.hideComment(1n))
        .to.be.revertedWithCustomError(forum, "CommentDoesNotExist");
      await expect(forum.reportComment(1n, "x"))
        .to.be.revertedWithCustomError(forum, "CommentDoesNotExist");
    });
  });

  describe("#14 report lifecycle", function () {
    it("blocks non-members from reporting", async function () {
      const forum = await forumWithPost();
      await expect(forum.connect(user2).reportPost(1n, "spam"))
        .to.be.revertedWithCustomError(forum, "MustJoinCommunityFirst");
    });

    it("blocks the same reporter reporting the same content twice", async function () {
      const forum = await forumWithPost();
      await forum.connect(user1).reportPost(1n, "spam");
      await expect(forum.connect(user1).reportPost(1n, "again"))
        .to.be.revertedWithCustomError(forum, "AlreadyReported");
    });

    it("lets a different member report the same content", async function () {
      const forum = await forumWithPost();
      await forum.connect(user2).joinCommunity(1n);
      await forum.connect(user1).reportPost(1n, "spam");
      await expect(forum.connect(user2).reportPost(1n, "me too"))
        .to.emit(forum, "ContentReported");
    });

    it("only a moderator can resolve reports, emitting ReportResolved", async function () {
      const forum = await forumWithPost();
      await forum.connect(user1).reportPost(1n, "spam");

      await expect(forum.connect(user1).resolveReport(0, 1n, 1))
        .to.be.revertedWithCustomError(forum, "OnlyCommunityModeratorAllowed");

      await expect(forum.resolveReport(0, 1n, 1))
        .to.emit(forum, "ReportResolved");
    });

    it("reverts resolving reports on non-existent content", async function () {
      const forum = await forumWithPost();
      await expect(forum.resolveReport(0, 99n, 1))
        .to.be.revertedWithCustomError(forum, "PostDoesNotExist");
      await expect(forum.resolveReport(1, 99n, 1))
        .to.be.revertedWithCustomError(forum, "CommentDoesNotExist");
    });
  });

  describe("#15 case-insensitive username lookup", function () {
    it("resolves any casing to the owner while preserving the display name", async function () {
      const forum = await deployForum();
      await forum.registerUsername("Alice");

      expect(await forum.getUsername(owner.address)).to.equal("Alice");
      expect(await forum.getAddressByUsername("alice")).to.equal(owner.address);
      expect(await forum.getAddressByUsername("ALICE")).to.equal(owner.address);
      expect(await forum.isUsernameAvailable("aLiCe")).to.equal(false);
    });
  });
});
