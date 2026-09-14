# Reppit - User Guide

Reppit is a decentralized Reddit-style forum: the contracts on Ethereum hold
all state, content lives on IPFS, and the website talks to both through
MetaMask.
Running the app
means running the website (and, for full functionality, its Graph indexer
in Docker) on your own machine. It connects to the **public Sepolia
testnet**, where the forum's contracts are already deployed and shared by
everyone - no local blockchain to run.

## 1. Prerequisites

- Node.js 22+ and npm
- The [MetaMask](https://metamask.io) browser extension, with an account
  holding some Sepolia test ETH (any faucet, e.g. sepoliafaucet.com)
- **Docker Desktop** (optional but recommended) runs The Graph indexer,
  which powers notifications, search, trending, and profile stats. Without
  it the app still works, falling back to slower direct blockchain reads
  with those features reduced.
- A **Pinata token** to publish. It is *not* in the repo (secrets are never
  committed) - get it from a teammate privately. Without it you can still
  read the forum, but publishing posts/comments/images fails.

## 2. Install

```bash
git clone <repo-url>
cd dApp-Project
cd reddit-dapp-project && npm ci && cd ..
cd subgraph && npm ci && cd ..        # for the Graph indexer (step 4)
```

Then create the frontend's `.env` and paste the Pinata token into it:
```bash
cd reddit-dapp-project
cp .env.example .env                  # Windows: copy .env.example .env
# edit .env:  VITE_PINATA_JWT=<token>
```
Leave `VITE_*_CONTRACT_ADDRESS` unset - the addresses come from
`deployments/*.json`, and a leftover override points the app at an old
contract (the forum then looks empty).

## 3. Run

1. ```bash
   cd reddit-dapp-project
   npm run dev      # http://localhost:5173
   ```
2. In MetaMask, switch to the **Sepolia** network (enable "Show test networks"
   if it isn't listed).
3. Open http://localhost:5173 and click **Connect with MetaMask**.

## 4. (Optional) Run the Graph indexer

Without this the app still works, using direct blockchain reads - but
comments, notifications, search, trending, and profile stats need it.
Requires Docker Desktop running:
```bash
cd subgraph
./redeploy-sepolia.sh      # Windows: redeploy-sepolia.bat
```
The first run indexes the forum's history from the contracts' deploy block;
give it a few minutes. It uses Tenderly's free public Sepolia RPC by default.
If that rate-limits you, set `SEPOLIA_RPC_URL` to a personal Alchemy/Infura
Sepolia URL before running the script.

> **Windows shortcut:** `start-dapp.bat` (repo root) automates steps 3–4 from
> any folder - pick option 1 (Sepolia) at the prompt. It warns you if the
> frontend dependencies or the Pinata token are missing.

## 5. Using the app

- First connection prompts you to pick a username (English letters/digits/
  underscore, 3–20 characters).
- Create or join a community (`r/name`), then write a post — content and
  images are pinned to IPFS; only the reference (CID) is written on-chain.
- Vote, comment, search, and view your profile from the top bar.
- The community creator is a permanent moderator; the two most-active
  members become moderators automatically; members can also nominate
  additional moderators by vote (see **Moderator actions** inside a
  community you moderate).
- Content the safety filter flags is queued for a moderator's approval
  instead of publishing immediately.

