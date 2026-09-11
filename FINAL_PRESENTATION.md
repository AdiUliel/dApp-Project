# Reppit — Project Summary

## What went well

- **Team collaboration** — splitting the work along the repo's four
  independent packages (contracts, frontend, subgraph, upload-service) let
  everyone move in parallel without blocking each other.
- **Documentation quality** — every tool we depended on had genuinely good
  documentation — Hardhat, ethers.js, Solidity itself, The Graph — so "how do
  we do X" was usually a docs search, not a dead end.

## Main difficulties

- **Environment and package setup** — four separate npm installs, a local
  Hardhat network, a Dockerized graph-node + Postgres + IPFS stack, and
  MetaMask network switching, all needing to be set up consistently and get
  every teammate's machine into the same working state.
- **Learning to work with the blockchain** — thinking in transactions, gas,
  on-chain vs. off-chain state, and wallet-signed calls was a different
  mental model than anything the degree covered.
- **Picking up tools outside the curriculum** — Solidity, Hardhat,
  ethers.js, IPFS pinning, The Graph's AssemblyScript mappings and Docker — each with
  its own learning curve, on top of the actual feature work.

## Potential extensions

- WalletConnect support, so the app isn't MetaMask-only and works from variety wallets.
- An on-chain reputation/karma score derived from voting history, shown on
  profiles.
- Deploy to alternative blockchaim to cut gas costs on everyday actions like voting and commenting.
- Deploy the App and the SubGraph to Cloud for simplify setup process for the end user. 
