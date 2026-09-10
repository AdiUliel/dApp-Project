# Reppit — Developer's Guide

## High-level design

Three independent pieces share data only through the blockchain and IPFS — no central backend database:

1. **Solidity contracts**, deployed on the **Sepolia** testnet, hold all canonical state: communities, posts, votes, membership, moderation, usernames.
2. **A React/Vite frontend** reads/writes the chain via ethers.js + MetaMask, and pins content straight to Pinata (IPFS) — the browser is the only client, there is no application server.
3. **A subgraph** (The Graph) indexes chain events for search, trending, notifications, and profile stats — the frontend still works, degraded, without it.

**Nothing runs in the cloud** — the website and, for full functionality, The Graph's Docker stack must be started locally (see `USER_GUIDE.md`).

Data flow for "create a post": browser pins content to Pinata (JWT baked into the build as `VITE_PINATA_JWT`) → gets a CID → sends a tx referencing it to `DecentralizedForum` → the tx emits an event → the subgraph indexes it (if running) → the frontend reads the post back from the subgraph, or falls back to a direct chain read.

> **Known trade-off:** IPFS writes were meant to route through a backend broker so the Pinata JWT never reached the browser; that service was dead code (nothing called it) and was removed. `VITE_PINATA_JWT` now ships in the JS bundle and is readable by anyone using the site — treat it as public.

## Repository layout

```
blockchain/            Solidity contracts, Hardhat 3 config, tests, deploy scripts
reddit-dapp-project/   React + TypeScript + Vite frontend
subgraph/              The Graph subgraph (AssemblyScript mappings)
deployments/           Canonical contract addresses (source of truth)
```

Each is its own npm package. `blockchain/scripts/sync-artifacts.cjs` (auto-run after `npm run compile`) is the one propagation point: it copies each contract's ABI into the frontend/subgraph and mirrors `deployments/*.json` into `reddit-dapp-project/src/deployments.json` — nothing downstream is hand-edited.

## Contracts — `blockchain/contracts/`

Three-contract split, deployed together by `ignition/modules/Forum.ts`:

- **`mainContract.sol` → `DecentralizedForum`** — core state: communities, posts, voting, membership, activity scoring, moderator governance (permanent creator-moderator, two auto-promoted active moderators, recommend/accept nominations, removal by ≥half the moderators). `optimizer.runs: 1` + `viaIR: true` keeps it under the 24,576-byte contract size limit (`scripts/check-size.cjs`).
- **`ForumModeration.sol`** — split out purely for size: the moderation queue, on-chain comments, report/resolve. Talks to the main contract via `IDecentralizedForum`; wired together once, post-deploy.
- **`UsernameRegistry.sol`** — standalone: charset/length/uniqueness on-chain, a rename cooldown (not a fee). Profanity filtering is client-side only.
- **`ForumInterfaces.sol`** — the interfaces the split contracts use to avoid a circular import.

Tests: `blockchain/test/*.ts` (Mocha + Chai + ethers via `hre.network.connect()`), one file per concern.

## Frontend — `reddit-dapp-project/src/`

- `App.tsx` is a thin layout shell; all state lives in `context/useForumState.ts`, wiring ~18 single-purpose hooks under `context/forum/` (e.g. `useCommunities`, `usePosts`, `useVotes`, `useModerationActions`, `useSearch`) around a shared `ForumCore`. Every component reads it via one hook, `useForum()`.
- `components/` — presentational only, grouped by feature (`post/`, `comment/`, `community/`, `moderation/`, `profile/`, `search/`, `modals/`, `feed/`).
- `features/wallet/` — MetaMask connection, independent of forum state.
- `services/ipfs.ts` — pins to Pinata via `VITE_PINATA_JWT`; reads from public IPFS gateways with fallback across several.
- `services/graph.ts` — GraphQL client; a failed/timed-out query returns `null`, and every caller falls back to a direct chain read — this is what lets the app run with Docker/Graph off.
- `lib/config.ts` — the Sepolia contract addresses and Graph endpoint the app connects to once MetaMask is on the Sepolia chain.
- `lib/contracts.ts` / `txErrors.ts` — ABI wiring and revert-reason decoding across all three contracts.
- `lib/i18n.ts` / `usernamePolicy.ts` / `contentSafety.ts` / `format.ts` — translation (en/he), client-side moderation, formatting helpers.

## Subgraph — `subgraph/`

- `schema.graphql` — `User`, `Community`, `Post`, `Comment`/`PendingComment`, `Vote`, `Report`/`ReportThread`, `BannedUser`, `Activity`, `Notification`, plus three `@fulltext` search indexes.
- `src/mapping.ts` — one AssemblyScript handler per contract event, maintaining derived state and fanning notifications out to a community's moderators.
- `subgraph.yaml` — three `dataSources`, one per contract; `make-sepolia-manifest.mjs` generates a Sepolia variant.
- Runs on **Docker** (graph-node + Postgres + IPFS) — no hosted instance. `redeploy-sepolia(.sh|.bat)` builds and deploys it as `reppit-sepolia`, indexing the live Sepolia contracts.

## Tools & libraries needed to build

- Node.js 22, npm (independent `package-lock.json` per package)
- Solidity 0.8.28 via **Hardhat 3**, Mocha/Chai, Hardhat Ignition
- **ethers.js v6** (blockchain scripts and frontend)
- **React 19 + TypeScript + Vite**, `@tanstack/react-query`
- **The Graph**: `graph-cli` + `graph-ts`; **Docker Desktop** to run the indexer locally
- MetaMask (browser extension) — the only supported wallet

## Building / running for development

See `USER_GUIDE.md` for exact commands. In short: `npm install` in `reddit-dapp-project/` (+ `subgraph/` for the Graph indexer) is enough to run against the already-deployed Sepolia contracts — `blockchain/` is only needed to deploy/redeploy. The website (`npm run dev`) and, for full functionality, the Graph stack (Docker) must be started by hand — nothing is deployed to a cloud host. CI (`.github/workflows/ci.yml`) only compiles/tests/typechecks each package; it never deploys or runs the Graph.

## Where to look next

- `ARCHITECTURE.md` — the IPFS/EVM non-atomicity design (stale in places: still describes the removed upload-service broker)
- `DEPLOY_SEPOLIA.md` / `DEPLOY_IPFS.md` — deployment specifics
