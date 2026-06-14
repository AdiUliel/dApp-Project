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

    await forum.createCommunity("blockchain", "cid-community");

    expect(await forum.isUserModeratorOfCommunity(1n, owner.address)).to.equal(true);

    const role = await forum.getModeratorRole(1n, owner.address);
    expect(role[0]).to.equal(true);
    expect(role[1]).to.equal(true);
    expect(role[2]).to.equal(false);
    expect(role[3]).to.equal(false);
  });

  it("creates a sub-community with a parent community id", async function () {
    const forum = await deployForum();

    await forum.createCommunity("technion", "cid-parent");
    await forum.createSubCommunity(1n, "cs", "cid-child");

    const child = await forum.getCommunityV2(2n);
    expect(child[1]).to.equal("cs");
    expect(child[7]).to.equal(1n);

    const children = await forum.getSubCommunities(1n);
    expect(children.map((id: bigint) => id)).to.deep.equal([2n]);
  });

  it("automatically promotes the two most active non-creator users", async function () {
    const forum = await deployForum();

    await forum.createCommunity("solidity", "cid");
    await forum.connect(user1).joinCommunity(1n);
    await forum.connect(user2).joinCommunity(1n);
    await forum.connect(user3).joinCommunity(1n);

    await forum.connect(user1).createPost(1n, "post-1");
    await forum.connect(user2).createPost(1n, "post-2");

    expect(await forum.isUserModeratorOfCommunity(1n, user1.address)).to.equal(true);
    expect(await forum.isUserModeratorOfCommunity(1n, user2.address)).to.equal(true);

    await forum.connect(user3).createPost(1n, "post-3");
    await forum.connect(user3).createPost(1n, "post-4");

    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(true);

    const top = await forum.getTopActiveUsers(1n);
    expect(top[0]).to.equal(user3.address);
  });

  it("adds an appointed moderator only after 3 moderator approvals", async function () {
    const forum = await deployForum();

    await forum.createCommunity("react", "cid");
    await forum.connect(user1).joinCommunity(1n);
    await forum.connect(user2).joinCommunity(1n);
    await forum.connect(user3).joinCommunity(1n);
    await forum.connect(user4).joinCommunity(1n);

    await forum.connect(user1).createPost(1n, "post-1");
    await forum.connect(user2).createPost(1n, "post-2");

    await forum.proposeModerator(1n, user3.address);
    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(false);

    await forum.connect(user1).approveModeratorProposal(1n);
    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(false);

    await forum.connect(user2).approveModeratorProposal(1n);
    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(true);

    const role = await forum.getModeratorRole(1n, user3.address);
    expect(role[3]).to.equal(true);
  });

  it("removes an appointed moderator only by removal vote", async function () {
    const forum = await deployForum();

    await forum.createCommunity("security", "cid");
    await forum.connect(user1).joinCommunity(1n);
    await forum.connect(user2).joinCommunity(1n);
    await forum.connect(user3).joinCommunity(1n);
    await forum.connect(user4).joinCommunity(1n);

    await forum.connect(user1).createPost(1n, "post-1");
    await forum.connect(user2).createPost(1n, "post-2");

    await forum.proposeModerator(1n, user3.address);
    await forum.connect(user1).approveModeratorProposal(1n);
    await forum.connect(user2).approveModeratorProposal(1n);
    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(true);

    await forum.proposeRemoveModerator(1n, user3.address);
    await forum.connect(user1).approveRemoveModeratorProposal(1n);

    expect(await forum.isUserModeratorOfCommunity(1n, user3.address)).to.equal(false);
  });
});
