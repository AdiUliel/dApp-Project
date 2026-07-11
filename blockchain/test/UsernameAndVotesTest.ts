import { expect } from "chai";
import hre from "hardhat";

describe("UsernameRegistry", function () {
  let ethers: any;
  let owner: any;
  let user1: any;
  let user2: any;

  before(async function () {
    ({ ethers } = await hre.network.connect());
    [owner, user1, user2] = await ethers.getSigners();
  });

  async function deployRegistry() {
    const registry = await ethers.deployContract("UsernameRegistry");
    await registry.waitForDeployment();
    return registry;
  }

  async function increaseTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  describe("username validation", function () {
    it("accepts a valid username", async function () {
      const registry = await deployRegistry();
      await registry.registerUsername("adi_123");
      expect(await registry.getUsername(owner.address)).to.equal("adi_123");
    });

    it("rejects names that are too short or too long", async function () {
      const registry = await deployRegistry();
      await expect(registry.registerUsername("ab")).to.be.revertedWithCustomError(registry, "UsernameTooShort");
      await expect(registry.registerUsername("a".repeat(21))).to.be.revertedWithCustomError(registry, "UsernameTooLong");
    });

    it("rejects invalid characters", async function () {
      const registry = await deployRegistry();
      await expect(registry.registerUsername("with space")).to.be.revertedWithCustomError(registry, "InvalidUsernameCharacter");
      await expect(registry.registerUsername("dash-name")).to.be.revertedWithCustomError(registry, "InvalidUsernameCharacter");
      await expect(registry.registerUsername("עברית_abc")).to.be.revertedWithCustomError(registry, "InvalidUsernameCharacter");
    });

    // On-chain rules are objective only (length, charset, uniqueness); the
    // reserved-word/anti-impersonation check now lives client-side in
    // usernamePolicy.ts, so names like "mod"/"admin" are chain-legal here.
    it("allows previously-reserved words - that filtering moved client-side", async function () {
      const registry = await deployRegistry();
      await registry.registerUsername("mod");
      expect(await registry.getUsername(owner.address)).to.equal("mod");
      await registry.connect(user1).registerUsername("admin");
      expect(await registry.getUsername(user1.address)).to.equal("admin");
    });

    it("rejects duplicate usernames across accounts", async function () {
      const registry = await deployRegistry();
      await registry.registerUsername("taken_name");
      await expect(registry.connect(user1).registerUsername("taken_name"))
        .to.be.revertedWithCustomError(registry, "UsernameAlreadyTaken");
    });
  });

  describe("changeUsername", function () {
    it("requires an existing username", async function () {
      const registry = await deployRegistry();

      await expect(registry.changeUsername("new_name"))
        .to.be.revertedWithCustomError(registry, "NoUsernameSet");
    });

    it("changes the name, frees the old one, and emits an event", async function () {
      const registry = await deployRegistry();

      await registry.registerUsername("old_name");
      await expect(registry.changeUsername("new_name"))
        .to.emit(registry, "UsernameChanged");

      expect(await registry.getUsername(owner.address)).to.equal("new_name");
      expect(await registry.isUsernameAvailable("old_name")).to.equal(true);

      await registry.connect(user1).registerUsername("old_name");
      expect(await registry.getUsername(user1.address)).to.equal("old_name");
    });

    it("enforces a cooldown between changes instead of a fee", async function () {
      const registry = await deployRegistry();
      await registry.registerUsername("first_name");

      await registry.changeUsername("second_name");
      await expect(registry.changeUsername("third_name"))
        .to.be.revertedWithCustomError(registry, "UsernameChangeOnCooldown");

      const cooldown = await registry.USERNAME_CHANGE_COOLDOWN();
      expect(await registry.getCooldownRemaining(owner.address)).to.be.greaterThan(0n);

      await increaseTime(Number(cooldown) + 1);

      await expect(registry.changeUsername("third_name")).to.emit(registry, "UsernameChanged");
      expect(await registry.getUsername(owner.address)).to.equal("third_name");

      // The cooldown restarts from this new change - a fourth change is
      // blocked again immediately.
      expect(await registry.getCooldownRemaining(owner.address)).to.be.greaterThan(0n);
      await expect(registry.changeUsername("fourth_name"))
        .to.be.revertedWithCustomError(registry, "UsernameChangeOnCooldown");
    });

    it("validates the new name with the same rules", async function () {
      const registry = await deployRegistry();

      await registry.registerUsername("old_name");
      await expect(registry.changeUsername("bad name"))
        .to.be.revertedWithCustomError(registry, "InvalidUsernameCharacter");
    });
  });

  describe("getAddressByUsername", function () {
    it("resolves a registered username and returns the zero address for unknown names", async function () {
      const registry = await deployRegistry();
      await registry.connect(user2).registerUsername("satoshi_99");

      expect(await registry.getAddressByUsername("satoshi_99")).to.equal(user2.address);
      expect(await registry.getAddressByUsername("nobody")).to.equal(ethers.ZeroAddress);
    });
  });
});

describe("DecentralizedForum votes", function () {
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
