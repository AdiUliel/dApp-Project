import { expect } from "chai";
import hre from "hardhat";

describe("DecentralizedForum moderation queue", function () {
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

  async function forumWithCommunity() {
    const forum = await deployForum();
    await forum.createCommunity("blockchain", "cid-community", "a community");
    await forum.connect(user1).joinCommunity(1n);
    return forum;
  }

  describe("community name validation", function () {
    it("rejects Hebrew, spaces, and out-of-range lengths", async function () {
      const forum = await deployForum();

      for (const bad of ["קהילה", "with space", "ab", "a".repeat(31), "name!", "שלום123"]) {
        await expect(forum.createCommunity(bad, "cid", "desc"), `expected '${bad}' to be rejected`)
          .to.be.revertedWithCustomError(forum, "InvalidCommunityName");
      }
    });

    it("accepts English names with digits, underscore, and hyphen", async function () {
      const forum = await deployForum();
      await forum.createCommunity("web3-forum_2", "cid", "desc");
      expect(await forum.getCommunityCount()).to.equal(1n);
    });

    it("still rejects empty names with the original error", async function () {
      const forum = await deployForum();
      await expect(forum.createCommunity("", "cid", "desc"))
        .to.be.revertedWithCustomError(forum, "EmptyCommunityName");
    });
  });

  describe("flagged posts", function () {
    it("stores a flagged post as hidden and pending, without activity points", async function () {
      const forum = await forumWithCommunity();

      await forum.connect(user1).createFlaggedPost(1n, "cid-post", "flagged title", "");

      expect(await forum.postPendingReview(1n)).to.equal(true);
      expect(await forum.isPostHidden(1n)).to.equal(true);
      expect(await forum.activityScore(1n, user1.address)).to.equal(0n);
    });

    it("approval publishes the post and grants activity points", async function () {
      const forum = await forumWithCommunity();
      await forum.connect(user1).createFlaggedPost(1n, "cid-post", "flagged title", "");

      await expect(forum.approvePendingPost(1n)).to.emit(forum, "PendingPostApproved");

      expect(await forum.postPendingReview(1n)).to.equal(false);
      expect(await forum.isPostHidden(1n)).to.equal(false);
      expect(await forum.postRejected(1n)).to.equal(false);
      expect(await forum.activityScore(1n, user1.address)).to.equal(await forum.POST_ACTIVITY_POINTS());
    });

    it("rejection keeps the post hidden and marks it rejected", async function () {
      const forum = await forumWithCommunity();
      await forum.connect(user1).createFlaggedPost(1n, "cid-post", "flagged title", "");

      await expect(forum.rejectPendingPost(1n)).to.emit(forum, "PendingPostRejected");

      expect(await forum.postRejected(1n)).to.equal(true);
      expect(await forum.isPostHidden(1n)).to.equal(true);
      expect(await forum.activityScore(1n, user1.address)).to.equal(0n);
    });

    it("only one moderator decision counts, and only moderators can decide", async function () {
      const forum = await forumWithCommunity();
      await forum.connect(user1).createFlaggedPost(1n, "cid-post", "flagged title", "");

      await expect(forum.connect(user1).approvePendingPost(1n))
        .to.be.revertedWithCustomError(forum, "OnlyCommunityModeratorAllowed");

      await forum.approvePendingPost(1n);
      await expect(forum.rejectPendingPost(1n))
        .to.be.revertedWithCustomError(forum, "PostNotPendingReview");
    });

    it("does not treat normal posts as pending", async function () {
      const forum = await forumWithCommunity();
      await forum.connect(user1).createPost(1n, "cid-post", "clean title", "");

      expect(await forum.postPendingReview(1n)).to.equal(false);
      await expect(forum.approvePendingPost(1n))
        .to.be.revertedWithCustomError(forum, "PostNotPendingReview");
    });
  });

  describe("flagged comments", function () {
    // The post is authored by the owner: a member who publishes a post earns
    // activity points and can become an automatic Active Moderator, which
    // would break the "non-moderator" assertions below.
    async function forumWithPost() {
      const forum = await forumWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      return forum;
    }

    it("stores a pending comment and exposes it through views", async function () {
      const forum = await forumWithPost();

      await expect(forum.connect(user1).submitFlaggedComment(1n, "bad words here", "img-cid"))
        .to.emit(forum, "CommentSubmittedForReview");

      const ids = await forum.getPendingCommentsByPost(1n);
      expect(ids.length).to.equal(1);

      const comment = await forum.getPendingComment(ids[0]);
      expect(comment[2]).to.equal(user1.address);
      expect(comment[3]).to.equal("bad words here");
      expect(comment[4]).to.equal("img-cid");
      expect(comment[6]).to.equal(0);
    });

    it("approve and reject update status once, moderators only", async function () {
      const forum = await forumWithPost();
      await forum.connect(user1).submitFlaggedComment(1n, "first", "");
      await forum.connect(user1).submitFlaggedComment(1n, "second", "");

      await expect(forum.connect(user1).approvePendingComment(1n))
        .to.be.revertedWithCustomError(forum, "OnlyCommunityModeratorAllowed");

      await forum.approvePendingComment(1n);
      expect((await forum.getPendingComment(1n))[6]).to.equal(1);

      await forum.rejectPendingComment(2n);
      expect((await forum.getPendingComment(2n))[6]).to.equal(2);

      await expect(forum.approvePendingComment(1n))
        .to.be.revertedWithCustomError(forum, "CommentNotPendingReview");
    });

    it("requires membership, no ban, and non-empty content", async function () {
      const forum = await forumWithPost();

      await expect(forum.connect(user2).submitFlaggedComment(1n, "hello", ""))
        .to.be.revertedWithCustomError(forum, "OnlyCommunityMembersAllowed");

      await expect(forum.connect(user1).submitFlaggedComment(1n, "", ""))
        .to.be.revertedWithCustomError(forum, "EmptyCommentContent");

      await forum.banUser(1n, user1.address, "spam");
      await expect(forum.connect(user1).submitFlaggedComment(1n, "hello", ""))
        .to.be.revertedWithCustomError(forum, "UserBannedFromCommunity");
    });
  });

  describe("clean on-chain comments (addComment)", function () {
    async function forumWithPost() {
      const forum = await forumWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      return forum;
    }

    it("emits CommentCreated for a member's comment", async function () {
      const forum = await forumWithPost();

      const tx = await forum.connect(user1).addComment(1n, "great post!", "img-cid");
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => { try { return forum.interface.parseLog(log); } catch { return null; } })
        .find((parsed: any) => parsed && parsed.name === "CommentCreated");

      expect(event, "CommentCreated not emitted").to.not.equal(undefined);
      expect(event.args[0]).to.equal(1n); // commentId
      expect(event.args[1]).to.equal(1n); // postId
      expect(event.args[2]).to.equal(1n); // communityId
      expect(event.args[3]).to.equal(user1.address);
      expect(event.args[4]).to.equal("great post!");
      expect(event.args[5]).to.equal("img-cid");
    });

    it("assigns incrementing comment ids", async function () {
      const forum = await forumWithPost();
      await forum.connect(user1).addComment(1n, "first", "");
      const tx = await forum.connect(user1).addComment(1n, "second", "");
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => { try { return forum.interface.parseLog(log); } catch { return null; } })
        .find((parsed: any) => parsed && parsed.name === "CommentCreated");
      expect(event.args[0]).to.equal(2n);
    });

    it("requires an existing post, membership, no ban, and non-empty content", async function () {
      const forum = await forumWithPost();

      await expect(forum.connect(user1).addComment(99n, "hello", ""))
        .to.be.revertedWithCustomError(forum, "PostDoesNotExist");

      await expect(forum.connect(user2).addComment(1n, "hello", ""))
        .to.be.revertedWithCustomError(forum, "OnlyCommunityMembersAllowed");

      await expect(forum.connect(user1).addComment(1n, "", ""))
        .to.be.revertedWithCustomError(forum, "EmptyCommentContent");

      await forum.banUser(1n, user1.address, "spam");
      await expect(forum.connect(user1).addComment(1n, "hello", ""))
        .to.be.revertedWithCustomError(forum, "UserBannedFromCommunity");
    });
  });

  describe("post locking", function () {
    async function forumWithPost() {
      const forum = await forumWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      return forum;
    }

    it("lock blocks new clean and flagged comments; unlock restores them", async function () {
      const forum = await forumWithPost();

      await expect(forum.lockPost(1n)).to.emit(forum, "PostLocked");
      expect(await forum.postLocked(1n)).to.equal(true);

      await expect(forum.connect(user1).addComment(1n, "too late", ""))
        .to.be.revertedWithCustomError(forum, "PostIsLocked");
      await expect(forum.connect(user1).submitFlaggedComment(1n, "too late", ""))
        .to.be.revertedWithCustomError(forum, "PostIsLocked");

      await expect(forum.unlockPost(1n)).to.emit(forum, "PostUnlocked");
      await forum.connect(user1).addComment(1n, "open again", "");
    });

    it("only moderators can lock/unlock; double lock and unlock of unlocked revert", async function () {
      const forum = await forumWithPost();

      await expect(forum.connect(user1).lockPost(1n))
        .to.be.revertedWithCustomError(forum, "OnlyCommunityModeratorAllowed");
      await expect(forum.unlockPost(1n))
        .to.be.revertedWithCustomError(forum, "PostNotLocked");

      await forum.lockPost(1n);
      await expect(forum.lockPost(1n))
        .to.be.revertedWithCustomError(forum, "PostAlreadyLocked");
    });
  });

  describe("comment hiding", function () {
    async function forumWithComment() {
      const forum = await forumWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      await forum.connect(user1).addComment(1n, "a comment", "");
      return forum;
    }

    it("a moderator of the comment's community can hide it exactly once", async function () {
      const forum = await forumWithComment();

      await expect(forum.hideComment(1n)).to.emit(forum, "CommentHidden");
      expect(await forum.commentHidden(1n)).to.equal(true);

      await expect(forum.hideComment(1n))
        .to.be.revertedWithCustomError(forum, "CommentAlreadyHidden");
    });

    it("rejects non-moderators and unknown comment ids", async function () {
      const forum = await forumWithComment();

      await expect(forum.connect(user1).hideComment(1n))
        .to.be.revertedWithCustomError(forum, "OnlyCommunityModeratorAllowed");
      await expect(forum.hideComment(99n))
        .to.be.revertedWithCustomError(forum, "CommentDoesNotExist");
    });
  });

  describe("content reports", function () {
    async function forumWithComment() {
      const forum = await forumWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      await forum.connect(user1).addComment(1n, "a comment", "");
      // Reporters must belong to some community (anti-spam gate).
      await forum.connect(user2).joinCommunity(1n);
      return forum;
    }

    it("a member can report a post, emitting ContentReported with kind 0", async function () {
      const forum = await forumWithComment();

      const tx = await forum.connect(user2).reportPost(1n, "spam");
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => { try { return forum.interface.parseLog(log); } catch { return null; } })
        .find((parsed: any) => parsed && parsed.name === "ContentReported");

      expect(event, "ContentReported not emitted").to.not.equal(undefined);
      expect(event.args[0]).to.equal(1n); // refId (postId)
      expect(event.args[1]).to.equal(1n); // communityId
      expect(event.args[2]).to.equal(0n); // kind = post
      expect(event.args[3]).to.equal(user2.address); // reporter
      expect(event.args[4]).to.equal("spam"); // reason
    });

    it("reports a comment with kind 1, and rejects unknown comment ids", async function () {
      const forum = await forumWithComment();

      await expect(forum.connect(user2).reportComment(1n, "offensive"))
        .to.emit(forum, "ContentReported");

      await expect(forum.reportComment(99n, "x"))
        .to.be.revertedWithCustomError(forum, "CommentDoesNotExist");
    });

    it("rejects reporting a non-existent post", async function () {
      const forum = await forumWithComment();
      await expect(forum.reportPost(99n, "x"))
        .to.be.revertedWithCustomError(forum, "PostDoesNotExist");
    });
  });
});
