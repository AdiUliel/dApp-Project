# Deploying Reppit to Sepolia (public testnet)

> **LIVE DEPLOYMENT v2 (2026-07-06):** the contract is deployed and verified working at
> **`0x49eEDCBdd425Df634A3c11405eE139f446d6141a`**
> (https://sepolia.etherscan.io/address/0x49eEDCBdd425Df634A3c11405eE139f446d6141a).
> v2 adds moderator-only recommendations (adaptive threshold), post locking, and
> on-chain comment hiding. The previous v1 forum at `0xddCC...502B` is abandoned.
> This address is baked into `reddit-dapp-project/src/config.ts` as the default, so
> teammates only need `git pull` + `npm run dev` + MetaMask on Sepolia.
> The steps below are for reference / future redeployments.

This makes the dApp the shared, always-on backend so **multiple independent site
instances communicate through the contract** — two people on two machines finally
see each other's forums, posts, and comments (the local-chain "isolated islands"
problem is gone).

The contract compiles to ~22.4 KB (under the 24,576-byte mainnet/testnet limit)
thanks to `viaIR:true` + `optimizer.runs:1` in `blockchain/hardhat.config.ts`.
Trade-off: `runs:1` minimizes deploy size at the cost of somewhat higher per-tx
runtime gas — fine for a testnet demo.

## 1. Prerequisites

- A Sepolia RPC URL — free from Alchemy or Infura (create an app → Sepolia → copy HTTPS URL).
- A deployer private key (a throwaway MetaMask account is fine).
- Sepolia test ETH for that account — from a faucet (e.g. sepoliafaucet.com,
  Alchemy faucet, or Google Cloud's Sepolia faucet).

## 2. Configure secrets (Hardhat 3 keystore — never commit keys)

```
cd blockchain
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```
(`hardhat.config.ts` already reads these via `configVariable(...)`. Alternatively
export them as environment variables of the same names.)

## 3. Deploy the contract

```
cd blockchain
npx hardhat compile
npx hardhat ignition deploy ignition/modules/Forum.ts --network sepolia
```
Copy the printed `ForumModule#DecentralizedForum - 0x...` address.

## 4. Point the frontend at Sepolia

In `reddit-dapp-project/.env` (copy from `.env.example`):
```
VITE_SEPOLIA_CONTRACT_ADDRESS=0x...   # the address from step 3
```
Restart `npm run dev`. Switch MetaMask to the **Sepolia** network — the app
auto-detects the chain and uses the Sepolia contract. Switching back to Localhost
8545 uses the local one. No code change needed.

## 5. The Graph on Sepolia — notifications, full-text search, trending, profile stats

The app works without this (it falls back to reading directly from the contract),
but **notifications only come from the graph**, so run it for the full experience.

**Option A — local graph stack indexing Sepolia (default, one command):**
```
subgraph\redeploy-sepolia.bat
```
(started automatically by `start-dapp.bat` when you pick SEPOLIA and Docker is up).
This generates `subgraph.sepolia.yaml` from `subgraph.yaml`, starts graph-node
against a free Sepolia RPC (dRPC — publicnode's free tier rejects historical
`eth_getLogs`), and deploys the subgraph as `reppit-sepolia`. The frontend
already defaults to `http://localhost:8000/subgraphs/name/reppit-sepolia` on
Sepolia. Unlike the local flow, the index is kept between runs (Sepolia never
resets). Only indexes while your machine + Docker run; each teammate runs their own.

**Option B — Subgraph Studio (always-on, no Docker):**
1. https://thegraph.com/studio → create a subgraph → get `<DEPLOY_KEY>` and `<SLUG>`.
2. Point `subgraph/subgraph.yaml` at Sepolia: set `network: sepolia`,
   `source.address:` to the deployed address, and `source.startBlock:` to the
   deploy block (shown in the Ignition output / Etherscan).
3. ```
   cd subgraph
   npx graph auth <DEPLOY_KEY>
   npx graph codegen && npx graph build
   npx graph deploy <SLUG>
   ```
4. Put the Studio query URL in `reddit-dapp-project/.env`:
   `VITE_SEPOLIA_GRAPH_URL=https://api.studio.thegraph.com/query/<id>/<slug>/<version>`

## Notes
- The same frontend build serves both networks; `src/config.ts` maps chainId →
  contract address + graph URL.
- If MetaMask is on an unsupported network the app shows a clear message instead
  of crashing.
