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

  // Deploys the forum + moderation pair and wires them exactly like the
  // Ignition module does: ForumModeration takes the forum's address at
  // construction, then the forum is told the moderation address once.
  async function deployModerationSuite() {
    const forum = await deployForum();
    const moderation = await ethers.deployContract("ForumModeration", [await forum.getAddress()]);
    await moderation.waitForDeployment();
    await forum.setModerationContract(await moderation.getAddress());
    return { forum, moderation };
  }

  async function suiteWithCommunity() {
    const { forum, moderation } = await deployModerationSuite();
    await forum.createCommunity("blockchain", "cid-community", "a community");
    await forum.connect(user1).joinCommunity(1n);
    return { forum, moderation };
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

  describe("forum <-> moderation wiring", function () {
    it("rejects a flagged post before the moderation contract is wired", async function () {
      const forum = await deployForum();
      await forum.createCommunity("blockchain", "cid-community", "a community");
      await forum.connect(user1).joinCommunity(1n);

      await expect(forum.connect(user1).createFlaggedPost(1n, "cid-post", "title", ""))
        .to.be.revertedWithCustomError(forum, "ModerationContractNotSet");
    });

    it("only the deployer can wire the moderation contract, and only once", async function () {
      const forum = await deployForum();
      const moderation = await ethers.deployContract("ForumModeration", [await forum.getAddress()]);

      await expect(forum.connect(user1).setModerationContract(await moderation.getAddress()))
        .to.be.revertedWithCustomError(forum, "OnlyDeployerAllowed");

      await forum.setModerationContract(await moderation.getAddress());
      await expect(forum.setModerationContract(await moderation.getAddress()))
        .to.be.revertedWithCustomError(forum, "ModerationContractAlreadySet");
    });

    it("rejects awardPostApprovalActivity from anyone but the wired moderation contract", async function () {
      const { forum } = await deployModerationSuite();
      await forum.createCommunity("blockchain", "cid-community", "a community");

      await expect(forum.connect(user1).awardPostApprovalActivity(1n, user1.address))
        .to.be.revertedWithCustomError(forum, "OnlyModerationContractAllowed");
    });
  });

  describe("flagged posts", function () {
    it("stores a flagged post as hidden and pending, without activity points", async function () {
      const { forum, moderation } = await suiteWithCommunity();

      await forum.connect(user1).createFlaggedPost(1n, "cid-post", "flagged title", "");

      expect(await moderation.postPendingReview(1n)).to.equal(true);
      expect(await moderation.postHidden(1n)).to.equal(false); // pending != hidden-by-moderator anymore
      expect(await forum.activityScore(1n, user1.address)).to.equal(0n);
    });

    it("approval publishes the post and grants activity points", async function () {
      const { forum, moderation } = await suiteWithCommunity();
      await forum.connect(user1).createFlaggedPost(1n, "cid-post", "flagged title", "");

      await expect(moderation.approvePendingPost(1n)).to.emit(moderation, "PendingPostApproved");

      expect(await moderation.postPendingReview(1n)).to.equal(false);
      expect(await moderation.postRejected(1n)).to.equal(false);
      expect(await forum.activityScore(1n, user1.address)).to.equal(await forum.POST_ACTIVITY_POINTS());
    });

    it("rejection marks the post rejected without activity points", async function () {
      const { forum, moderation } = await suiteWithCommunity();
      await forum.connect(user1).createFlaggedPost(1n, "cid-post", "flagged title", "");

      await expect(moderation.rejectPendingPost(1n)).to.emit(moderation, "PendingPostRejected");

      expect(await moderation.postRejected(1n)).to.equal(true);
      expect(await forum.activityScore(1n, user1.address)).to.equal(0n);
    });

    it("only one moderator decision counts, and only moderators can decide", async function () {
      const { forum, moderation } = await suiteWithCommunity();
      await forum.connect(user1).createFlaggedPost(1n, "cid-post", "flagged title", "");

      await expect(moderation.connect(user1).approvePendingPost(1n))
        .to.be.revertedWithCustomError(moderation, "OnlyCommunityModeratorAllowed");

      await moderation.approvePendingPost(1n);
      await expect(moderation.rejectPendingPost(1n))
        .to.be.revertedWithCustomError(moderation, "PostNotPendingReview");
    });

    it("does not treat normal posts as pending", async function () {
      const { forum, moderation } = await suiteWithCommunity();
      await forum.connect(user1).createPost(1n, "cid-post", "clean title", "");

      expect(await moderation.postPendingReview(1n)).to.equal(false);
      await expect(moderation.approvePendingPost(1n))
        .to.be.revertedWithCustomError(moderation, "PostNotPendingReview");
    });
  });

  describe("flagged comments", function () {
    // The post is authored by the owner: a member who publishes a post earns
    // activity points and can become an automatic Active Moderator, which
    // would break the "non-moderator" assertions below.
    async function suiteWithPost() {
      const { forum, moderation } = await suiteWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      return { forum, moderation };
    }

    it("stores a pending comment and exposes it through views", async function () {
      const { moderation } = await suiteWithPost();

      await expect(moderation.connect(user1).submitFlaggedComment(1n, "bad words here", "img-cid"))
        .to.emit(moderation, "CommentSubmittedForReview");

      const ids = await moderation.getPendingCommentsByPost(1n);
      expect(ids.length).to.equal(1);

      const comment = await moderation.getPendingComment(ids[0]);
      expect(comment[2]).to.equal(user1.address);
      expect(comment[3]).to.equal("bad words here");
      expect(comment[4]).to.equal("img-cid");
      expect(comment[6]).to.equal(0);
    });

    it("approve and reject update status once, moderators only", async function () {
      const { moderation } = await suiteWithPost();
      await moderation.connect(user1).submitFlaggedComment(1n, "first", "");
      await moderation.connect(user1).submitFlaggedComment(1n, "second", "");

      await expect(moderation.connect(user1).approvePendingComment(1n))
        .to.be.revertedWithCustomError(moderation, "OnlyCommunityModeratorAllowed");

      await moderation.approvePendingComment(1n);
      expect((await moderation.getPendingComment(1n))[6]).to.equal(1);

      await moderation.rejectPendingComment(2n);
      expect((await moderation.getPendingComment(2n))[6]).to.equal(2);

      await expect(moderation.approvePendingComment(1n))
        .to.be.revertedWithCustomError(moderation, "CommentNotPendingReview");
    });

    it("requires membership, no ban, and non-empty content", async function () {
      const { forum, moderation } = await suiteWithPost();

      await expect(moderation.connect(user2).submitFlaggedComment(1n, "hello", ""))
        .to.be.revertedWithCustomError(moderation, "OnlyCommunityMembersAllowed");

      await expect(moderation.connect(user1).submitFlaggedComment(1n, "", ""))
        .to.be.revertedWithCustomError(moderation, "EmptyCommentContent");

      await forum.banUser(1n, user1.address);
      await expect(moderation.connect(user1).submitFlaggedComment(1n, "hello", ""))
        .to.be.revertedWithCustomError(moderation, "UserBannedFromCommunity");
    });
  });

  describe("clean on-chain comments (addComment)", function () {
    async function suiteWithPost() {
      const { forum, moderation } = await suiteWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      return { forum, moderation };
    }

    it("emits CommentCreated for a member's comment", async function () {
      const { moderation } = await suiteWithPost();

      const tx = await moderation.connect(user1).addComment(1n, "great post!", "img-cid");
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => { try { return moderation.interface.parseLog(log); } catch { return null; } })
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
      const { moderation } = await suiteWithPost();
      await moderation.connect(user1).addComment(1n, "first", "");
      const tx = await moderation.connect(user1).addComment(1n, "second", "");
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => { try { return moderation.interface.parseLog(log); } catch { return null; } })
        .find((parsed: any) => parsed && parsed.name === "CommentCreated");
      expect(event.args[0]).to.equal(2n);
    });

    it("requires an existing post, membership, no ban, and non-empty content", async function () {
      const { forum, moderation } = await suiteWithPost();

      await expect(moderation.connect(user1).addComment(99n, "hello", ""))
        .to.be.revertedWithCustomError(forum, "PostDoesNotExist");

      await expect(moderation.connect(user2).addComment(1n, "hello", ""))
        .to.be.revertedWithCustomError(moderation, "OnlyCommunityMembersAllowed");

      await expect(moderation.connect(user1).addComment(1n, "", ""))
        .to.be.revertedWithCustomError(moderation, "EmptyCommentContent");

      await forum.banUser(1n, user1.address);
      await expect(moderation.connect(user1).addComment(1n, "hello", ""))
        .to.be.revertedWithCustomError(moderation, "UserBannedFromCommunity");
    });
  });

  describe("post hide/restore", function () {
    async function suiteWithPost() {
      const { forum, moderation } = await suiteWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      return { forum, moderation };
    }

    it("a moderator can hide and restore a post", async function () {
      const { moderation } = await suiteWithPost();

      await expect(moderation.hidePost(1n)).to.emit(moderation, "PostHidden");
      expect(await moderation.postHidden(1n)).to.equal(true);

      await expect(moderation.restorePost(1n)).to.emit(moderation, "PostRestored");
      expect(await moderation.postHidden(1n)).to.equal(false);
    });

    it("only moderators can hide; double hide and restore-of-visible revert", async function () {
      const { moderation } = await suiteWithPost();

      await expect(moderation.connect(user1).hidePost(1n))
        .to.be.revertedWithCustomError(moderation, "OnlyCommunityModeratorAllowed");
      await expect(moderation.restorePost(1n))
        .to.be.revertedWithCustomError(moderation, "PostNotHidden");

      await moderation.hidePost(1n);
      await expect(moderation.hidePost(1n))
        .to.be.revertedWithCustomError(moderation, "PostAlreadyHidden");
    });
  });

  describe("post locking", function () {
    async function suiteWithPost() {
      const { forum, moderation } = await suiteWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      return { forum, moderation };
    }

    it("lock blocks new clean and flagged comments; unlock restores them", async function () {
      const { moderation } = await suiteWithPost();

      await expect(moderation.lockPost(1n)).to.emit(moderation, "PostLocked");
      expect(await moderation.postLocked(1n)).to.equal(true);

      await expect(moderation.connect(user1).addComment(1n, "too late", ""))
        .to.be.revertedWithCustomError(moderation, "PostIsLocked");
      await expect(moderation.connect(user1).submitFlaggedComment(1n, "too late", ""))
        .to.be.revertedWithCustomError(moderation, "PostIsLocked");

      await expect(moderation.unlockPost(1n)).to.emit(moderation, "PostUnlocked");
      await moderation.connect(user1).addComment(1n, "open again", "");
    });

    it("only moderators can lock/unlock; double lock and unlock of unlocked revert", async function () {
      const { moderation } = await suiteWithPost();

      await expect(moderation.connect(user1).lockPost(1n))
        .to.be.revertedWithCustomError(moderation, "OnlyCommunityModeratorAllowed");
      await expect(moderation.unlockPost(1n))
        .to.be.revertedWithCustomError(moderation, "PostNotLocked");

      await moderation.lockPost(1n);
      await expect(moderation.lockPost(1n))
        .to.be.revertedWithCustomError(moderation, "PostAlreadyLocked");
    });
  });

  describe("comment hiding", function () {
    async function suiteWithComment() {
      const { forum, moderation } = await suiteWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      await moderation.connect(user1).addComment(1n, "a comment", "");
      return { forum, moderation };
    }

    it("a moderator of the comment's community can hide it exactly once", async function () {
      const { moderation } = await suiteWithComment();

      await expect(moderation.hideComment(1n)).to.emit(moderation, "CommentHidden");
      expect(await moderation.commentHidden(1n)).to.equal(true);

      await expect(moderation.hideComment(1n))
        .to.be.revertedWithCustomError(moderation, "CommentAlreadyHidden");
    });

    it("rejects non-moderators and unknown comment ids", async function () {
      const { moderation } = await suiteWithComment();

      await expect(moderation.connect(user1).hideComment(1n))
        .to.be.revertedWithCustomError(moderation, "OnlyCommunityModeratorAllowed");
      await expect(moderation.hideComment(99n))
        .to.be.revertedWithCustomError(moderation, "CommentDoesNotExist");
    });
  });

  describe("content reports", function () {
    async function suiteWithComment() {
      const { forum, moderation } = await suiteWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      await moderation.connect(user1).addComment(1n, "a comment", "");
      return { forum, moderation };
    }

    it("anyone can report a post, emitting ContentReported with kind 0", async function () {
      const { moderation } = await suiteWithComment();

      const tx = await moderation.connect(user2).reportPost(1n, "spam");
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log: any) => { try { return moderation.interface.parseLog(log); } catch { return null; } })
        .find((parsed: any) => parsed && parsed.name === "ContentReported");

      expect(event, "ContentReported not emitted").to.not.equal(undefined);
      expect(event.args[0]).to.equal(1n); // refId (postId)
      expect(event.args[1]).to.equal(1n); // communityId
      expect(event.args[2]).to.equal(0n); // kind = post
      expect(event.args[3]).to.equal(user2.address); // reporter
      expect(event.args[4]).to.equal("spam"); // reason
    });

    it("reports a comment with kind 1, and rejects unknown comment ids", async function () {
      const { moderation } = await suiteWithComment();

      await expect(moderation.connect(user2).reportComment(1n, "offensive"))
        .to.emit(moderation, "ContentReported");

      await expect(moderation.reportComment(99n, "x"))
        .to.be.revertedWithCustomError(moderation, "CommentDoesNotExist");
    });

    it("rejects reporting a non-existent post", async function () {
      const { forum, moderation } = await suiteWithComment();
      await expect(moderation.reportPost(99n, "x"))
        .to.be.revertedWithCustomError(forum, "PostDoesNotExist");
    });
  });

  describe("comments Merkle root checkpoint", function () {
    async function suiteWithPost() {
      const { forum, moderation } = await suiteWithCommunity();
      await forum.createPost(1n, "cid-post", "a post", "");
      return { forum, moderation };
    }

    it("a moderator can set and read the checkpoint", async function () {
      const { moderation } = await suiteWithPost();

      const root = ethers.keccak256(ethers.toUtf8Bytes("comments batch 1"));
      await moderation.updateCommentsMerkleRoot(1n, root);

      const data = await moderation.getCommentsMerkleRoot(1n);
      expect(data[0]).to.equal(root);
      expect(data[1]).to.be.greaterThan(0n);
    });

    it("rejects non-moderators and an empty root", async function () {
      const { moderation } = await suiteWithPost();

      await expect(moderation.connect(user1).updateCommentsMerkleRoot(1n, ethers.ZeroHash))
        .to.be.revertedWithCustomError(moderation, "OnlyCommunityModeratorAllowed");
      await expect(moderation.updateCommentsMerkleRoot(1n, ethers.ZeroHash))
        .to.be.revertedWithCustomError(moderation, "EmptyCommentsMerkleRoot");
    });
  });
});
