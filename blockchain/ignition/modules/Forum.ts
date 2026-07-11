import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Deploys the three-contract split: the main forum (communities/posts/votes/
// governance), the standalone username registry, and the moderation contract
// (which needs the forum's address at construction). The forum is then told
// the moderation contract's address via a one-time setter call so it can
// authorize the awardPostApprovalActivity callback.
export default buildModule("ForumModule", (m) => {
  const forum = m.contract("DecentralizedForum");
  const usernameRegistry = m.contract("UsernameRegistry");
  const moderation = m.contract("ForumModeration", [forum]);

  m.call(forum, "setModerationContract", [moderation]);

  return { forum, usernameRegistry, moderation };
});
