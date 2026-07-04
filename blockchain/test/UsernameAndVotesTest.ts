import { expect } from "chai";
import hre from "hardhat";

describe("DecentralizedForum usernames and votes", function () {
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

  describe("username validation", function () {
    it("accepts a valid username", async function () {
      const forum = await deployForum();
      await forum.registerUsername("adi_123");
      expect(await forum.getUsername(owner.address)).to.equal("adi_123");
    });

    it("rejects names that are too short or too long", async function () {
      const forum = await deployForum();
      await expect(forum.registerUsername("ab")).to.be.revertedWithCustomError(forum, "UsernameTooShort");
      await expect(forum.registerUsername("a".repeat(21))).to.be.revertedWithCustomError(forum, "UsernameTooLong");
    });

    it("rejects invalid characters", async function () {
      const forum = await deployForum();
      await expect(forum.registerUsername("with space")).to.be.revertedWithCustomError(forum, "InvalidUsernameCharacter");
      await expect(forum.registerUsername("dash-name")).to.be.revertedWithCustomError(forum, "InvalidUsernameCharacter");
      await expect(forum.registerUsername("עברית_abc")).to.be.revertedWithCustomError(forum, "InvalidUsernameCharacter");
    });

    it("rejects reserved tokens as whole word or with separator boundaries", async function () {
      const forum = await deployForum();
      for (const bad of ["mod", "MOD", "admin", "gm1", "moderator", "mod_dan", "admin123", "x_mod", "gm_2024", "the_admin", "Moderator1"]) {
        await expect(forum.registerUsername(bad), `expected '${bad}' to be rejected`)
          .to.be.revertedWithCustomError(forum, "ReservedUsername");
      }
    });

    it("allows legitimate names containing reserved substrings inside words", async function () {
      const forum = await deployForum();
      await forum.connect(user1).registerUsername("modern");
      expect(await forum.getUsername(user1.address)).to.equal("modern");
      await forum.connect(user2).registerUsername("dogma");
      expect(await forum.getUsername(user2.address)).to.equal("dogma");
    });

    it("rejects duplicate usernames across accounts", async function () {
      const forum = await deployForum();
      await forum.registerUsername("taken_name");
      await expect(forum.connect(user1).registerUsername("taken_name"))
        .to.be.revertedWithCustomError(forum, "UsernameAlreadyTaken");
    });
  });

  describe("changeUsername", function () {
    it("requires an existing username and the fee", async function () {
      const forum = await deployForum();
      const fee = await forum.USERNAME_CHANGE_FEE();

      await expect(forum.changeUsername("new_name", { value: fee }))
        .to.be.revertedWithCustomError(forum, "NoUsernameSet");

      await forum.registerUsername("old_name");
      await expect(forum.changeUsername("new_name"))
        .to.be.revertedWithCustomError(forum, "InsufficientUsernameChangeFee");
      await expect(forum.changeUsername("new_name", { value: fee / 2n }))
        .to.be.revertedWithCustomError(forum, "InsufficientUsernameChangeFee");
    });

    it("changes the name, frees the old one, and emits an event", async function () {
      const forum = await deployForum();
      const fee = await forum.USERNAME_CHANGE_FEE();

      await forum.registerUsername("old_name");
      await expect(forum.changeUsername("new_name", { value: fee }))
        .to.emit(forum, "UsernameChanged");

      expect(await forum.getUsername(owner.address)).to.equal("new_name");
      expect(await forum.isUsernameAvailable("old_name")).to.equal(true);

      await forum.connect(user1).registerUsername("old_name");
      expect(await forum.getUsername(user1.address)).to.equal("old_name");
    });

    it("validates the new name with the same rules", async function () {
      const forum = await deployForum();
      const fee = await forum.USERNAME_CHANGE_FEE();

      await forum.registerUsername("old_name");
      await expect(forum.changeUsername("admin", { value: fee }))
        .to.be.revertedWithCustomError(forum, "ReservedUsername");
    });
  });

  describe("votePost", function () {
    async function forumWithPost() {
      const forum = await deployForum();
      await forum.createCommunity("blockchain", "cid-community", "a community");
      await forum.createPost(1n, "cid-post", "First post", "tag1,tag2");
      return forum;
    }

    it("applies up, down, switch, and removal correctly", async function () {
      const forum = await forumWithPost();

      await forum.connect(user1).votePost(1n, 1);
      expect(await forum.postScore(1n)).to.equal(1n);

      await forum.connect(user2).votePost(1n, -1);
      expect(await forum.postScore(1n)).to.equal(0n);

      await forum.connect(user2).votePost(1n, 1);
      expect(await forum.postScore(1n)).to.equal(2n);

      await forum.connect(user1).votePost(1n, 0);
      expect(await forum.postScore(1n)).to.equal(1n);

      expect(await forum.postVotes(1n, user1.address)).to.equal(0);
      expect(await forum.postVotes(1n, user2.address)).to.equal(1);
    });

    it("emits PostVoted with the new score", async function () {
      const forum = await forumWithPost();
      await expect(forum.connect(user1).votePost(1n, 1))
        .to.emit(forum, "PostVoted");
    });

    it("rejects invalid values, missing posts, and banned users", async function () {
      const forum = await forumWithPost();

      await expect(forum.votePost(1n, 2)).to.be.revertedWithCustomError(forum, "InvalidVoteValue");
      await expect(forum.votePost(99n, 1)).to.be.revertedWithCustomError(forum, "PostDoesNotExist");

      await forum.connect(user1).joinCommunity(1n);
      await forum.banUser(1n, user1.address);
      await expect(forum.connect(user1).votePost(1n, 1))
        .to.be.revertedWithCustomError(forum, "UserBannedFromCommunity");
    });

    it("is idempotent for repeated identical votes", async function () {
      const forum = await forumWithPost();
      await forum.connect(user1).votePost(1n, 1);
      await forum.connect(user1).votePost(1n, 1);
      expect(await forum.postScore(1n)).to.equal(1n);
    });
  });
});
