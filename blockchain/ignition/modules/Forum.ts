import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("ForumModule", (m) => {
  // אנחנו מבקשים לפרוס את החוזה DecentralizedForum שנמצא ב-mainContract.sol
  const forum = m.contract("DecentralizedForum");

  return { forum };
});