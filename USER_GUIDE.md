# Reppit - User Guide

Reppit is a decentralized Reddit-style forum: the contracts on Ethereum hold
all state, content lives on IPFS, and the website talks to both through
MetaMask. **Nothing here is hosted in the cloud for you** - running the app
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
- Nothing else - publishing posts/communities/images works out of the box
  using a shared Pinata pinning key already checked into `.env`. No account
  to create.
  > **Security note:** the website pins content to IPFS directly from the
  > browser, so this key ends up inside the JS the browser downloads and can
  > be read by anyone using the site (e.g. via devtools). It's a key scoped
  > only to pinning, on an account treated as semi-public by design.

## 2. Install

```bash
git clone <repo-url>
cd dApp-Project
cd reddit-dapp-project && npm install && cd ..
```

Only need the `subgraph/` package too if you want the optional Graph
indexer (step 4 below):
```bash
cd subgraph && npm install && cd ..
```

## 3. Run

1. ```bash
   cd reddit-dapp-project
   npm run dev      # http://localhost:5173
   ```
2. In MetaMask, switch to the **Sepolia** network.
3. Open http://localhost:5173 and click **Connect with MetaMask**.

## 4. (Optional) Run the Graph indexer

Without this the app still works, using direct blockchain reads - but
notifications, search, trending, and profile stats need it. Requires
Docker Desktop running:
```bash
cd subgraph
./redeploy-sepolia.sh      # Windows: redeploy-sepolia.bat
```

> **Windows shortcut:** `start-dapp.bat` (repo root) automates steps 3–4 —
> pick option 1 (Sepolia) at the prompt. It predates the removal of the
> separate upload service, so it still tries to start it; skip that step
> manually or edit the script before using it.

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

