import { expect } from "chai";
import hre from "hardhat";

describe("DecentralizedForum governance upgrade", function () {
  let ethers: any;
  let owner: any;
  let user1: any;
  let user2: any;
  let user3: any;
  let user4: any;

  before(async function () {
    ({ ethers } = await hre.network.connect());
    [owner, user1, user2, user3, user4] = await ethers.getSigners();
  });

  async function deployForum() {
    const forum = await ethers.deployContract("DecentralizedForum");
    await forum.waitForDeployment();
    return forum;
  }

  it("makes the creator the first permanent moderator", async function () {
    const forum = await deployForum();

    await forum.createCommunity("blockchain", "cid-community", "a community");

    expect(await forum.isUserModeratorOfCommunity(1n, owner.address)).to.equal(true);

    const role = await forum.getModeratorRole(1n, owner.address);
    expect(role[0]).to.equal(true);
    expect(role[1]).to.equal(true);
    expect(role[2]).to.equal(false);
    expect(role[3]).to.equal(false);
  });

  it("creates a sub-community with a parent community id", async function () {
    const forum = await deployForum();

    await forum.createCommunity("technion", "cid-parent", "a community");
    await forum.createSubCommunity(1n, "cs101", "cid-child", "a sub community");

    const child = await forum.getCommunityV2(2n);
    expect(child[1]).to.equal("cs101");
    expect(child[7]).to.equal(1n);

    const children = await forum.getSubCommunities(1n);
    expect(children.map((id: bigint) => id)).to.deep.equal([2n]);
  });

  it("automatically promotes the two most active non-creator users", async function () {
    const forum = await deployForum();

    await forum.createCommunity("solidity", "cid", "a community");
    await forum.connect(user1).joinCommunity(1n);
    await forum.connect(user2).joinCommunity(1n);
    await forum.connect(user3).joinCommunity(1n);

    await forum.connect(user1).createPost(1n, "post-1", "a title", "tag1,tag2");
    await forum.connect(user2).createPost(1n, "post-2", "a title", "tag1,tag2");

    expect(await forum.isUserModeratorOfCommunity(1n, user1.address)).to.equal(true);
    expect(await forum.isUserModeratorOfCommunity(1n, user2.address)).to.equal(true);

    await forum.connect(user3).createPost(1n, "post-3", "a title", "tag1,tag2");
    await forum.connect(user3).createPost(1n, "post-4", "a title", "tag1,tag2");

    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(true);

    const top = await forum.getTopActiveUsers(1n);
    expect(top[0]).to.equal(user3.address);
  });

  // Joins users 1-4 and returns a community where nobody but the creator is
  // a moderator yet (no posts, so no activity-based promotion).
  async function deployCommunityWithMembers() {
    const forum = await deployForum();
    await forum.createCommunity("react", "cid", "a community");
    await forum.connect(user1).joinCommunity(1n);
    await forum.connect(user2).joinCommunity(1n);
    await forum.connect(user3).joinCommunity(1n);
    await forum.connect(user4).joinCommunity(1n);
    return forum;
  }

  it("only moderators can recommend; the threshold adapts to the moderator count", async function () {
    const forum = await deployCommunityWithMembers();

    // Plain members cannot recommend anymore.
    await expect(
      forum.connect(user1).recommendModerator(1n, user3.address)
    ).to.be.revertedWithCustomError(forum, "OnlyCommunityModeratorAllowed");

    // Creator is the sole moderator -> threshold is min(3, 1) = 1, so a single
    // recommendation opens an offer.
    const status = await forum.getModeratorRecommendationStatus(1n, user3.address);
    expect(status[1]).to.equal(1n);

    await forum.recommendModerator(1n, user3.address);
    expect(await forum.hasPendingModeratorOffer(1n, user3.address)).to.equal(true);

    // The offer alone does not grant the role - the candidate must accept.
    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(false);

    await forum.connect(user3).acceptModeratorRole(1n);
    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(true);

    const role = await forum.getModeratorRole(1n, user3.address);
    expect(role[3]).to.equal(true);

    // Two moderators now -> the next candidate needs both of them.
    await forum.recommendModerator(1n, user4.address);
    expect(await forum.hasPendingModeratorOffer(1n, user4.address)).to.equal(false);

    await forum.connect(user3).recommendModerator(1n, user4.address);
    expect(await forum.hasPendingModeratorOffer(1n, user4.address)).to.equal(true);
  });

  it("rejects double recommendations from the same moderator", async function () {
    const forum = await deployCommunityWithMembers();

    // Appoint user3 so there are two moderators (threshold 2) - otherwise the
    // first recommendation immediately opens an offer.
    await forum.recommendModerator(1n, user3.address);
    await forum.connect(user3).acceptModeratorRole(1n);

    await forum.recommendModerator(1n, user4.address);

    await expect(
      forum.recommendModerator(1n, user4.address)
    ).to.be.revertedWithCustomError(forum, "AlreadyRecommended");

    const status = await forum.getModeratorRecommendationStatus(1n, user4.address);
    expect(status[0]).to.equal(1n);
    expect(status[1]).to.equal(2n);
  });

  it("rejects self-recommendations", async function () {
    const forum = await deployCommunityWithMembers();

    await expect(
      forum.recommendModerator(1n, owner.address)
    ).to.be.revertedWithCustomError(forum, "CannotRecommendSelf");
  });

  it("rejects recommending a sitting moderator", async function () {
    const forum = await deployCommunityWithMembers();

    await forum.recommendModerator(1n, user3.address);
    await forum.connect(user3).acceptModeratorRole(1n);

    await expect(
      forum.recommendModerator(1n, user3.address)
    ).to.be.revertedWithCustomError(forum, "AlreadyModerator");
  });

  it("lets a candidate decline, which restarts the recommendation round", async function () {
    const forum = await deployCommunityWithMembers();

    await forum.recommendModerator(1n, user3.address);

    await forum.connect(user3).declineModeratorRole(1n);
    expect(await forum.hasPendingModeratorOffer(1n, user3.address)).to.equal(false);
    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(false);

    // Previous votes no longer count, but the same moderators may vote again.
    const status = await forum.getModeratorRecommendationStatus(1n, user3.address);
    expect(status[0]).to.equal(0n);
    await forum.recommendModerator(1n, user3.address);
    expect(await forum.hasPendingModeratorOffer(1n, user3.address)).to.equal(true);
  });

  it("lets an appointed moderator resign", async function () {
    const forum = await deployCommunityWithMembers();

    await forum.recommendModerator(1n, user3.address);
    await forum.connect(user3).acceptModeratorRole(1n);
    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(true);

    await forum.connect(user3).resignModerator(1n);
    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(false);

    // The creator cannot resign.
    await expect(forum.resignModerator(1n)).to.be.revertedWithCustomError(
      forum,
      "CannotRemoveCreatorModerator"
    );
  });

  it("removes an appointed moderator once at least half of the moderators approve", async function () {
    const forum = await deployCommunityWithMembers();

    // Appoint user3 (sole-moderator threshold 1), then user4 (threshold 2)
    // -> moderators are: creator, user3, user4.
    await forum.recommendModerator(1n, user3.address);
    await forum.connect(user3).acceptModeratorRole(1n);

    await forum.recommendModerator(1n, user4.address);
    await forum.connect(user3).recommendModerator(1n, user4.address);
    await forum.connect(user4).acceptModeratorRole(1n);

    expect(await forum.getModeratorCount(1n)).to.equal(3n);
    expect(await forum.getRequiredRemovalApprovals(1n)).to.equal(2n);

    await forum.proposeRemoveModerator(1n, user3.address);
    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(true);

    await forum.connect(user4).approveRemoveModeratorProposal(1n);
    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(false);

    const proposals = await forum.getRemovalProposalsByCommunity(1n);
    expect(proposals.map((id: bigint) => id)).to.deep.equal([1n]);
  });

  // Username registration/lookup now lives on the standalone UsernameRegistry
  // contract - see UsernameAndVotesTest.ts.
});
