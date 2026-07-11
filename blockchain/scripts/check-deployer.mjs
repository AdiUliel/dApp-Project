import { network } from "hardhat";

const { ethers } = await network.connect({ network: "sepolia" });
const [signer] = await ethers.getSigners();
const balance = await ethers.provider.getBalance(signer.address);
console.log("Deployer address:", signer.address);
console.log("Balance (SepoliaETH):", ethers.formatEther(balance));
