# Reppit — Developer Guide

## 1. High-level design

Reppit is a decentralized, Reddit-style forum. There is no application server and no
central database — three independent pieces share data only through the blockchain
and IPFS:

1. **Smart contracts**, deployed on the **Sepolia** testnet, are the single source of
   truth: communities, posts, votes, membership, moderation, and usernames all live
   on-chain.
2. **A React/Vite web frontend** is the only client. It talks to the contracts
   directly from the browser via **ethers.js + MetaMask**, and pins post/comment
   content and images straight to **IPFS** (via Pinata) — no backend in between.
3. **A subgraph** (The Graph) indexes contract events off-chain to serve fast
   search, trending, notifications, and profile-stats queries. It is an
   accelerator, not a dependency: every query it serves has a direct-chain-read
   fallback, so the app degrades gracefully (slower, fewer features) if it isn't
   running.

Nothing is hosted in the cloud. The website and, optionally, The Graph's Docker
stack are started locally; the contracts are already deployed and shared by
everyone on Sepolia (see `USER_GUIDE.md`).

**Data flow for "create a post"** (the flow every write follows):

```
browser --pin content/images (Pinata JWT)--> IPFS --CID-->
  browser --tx referencing the CID--> DecentralizedForum contract --emits event-->
    subgraph indexer (if running) --GraphQL--> frontend
                                    \_ (else) frontend falls back to a direct chain read
```

Only the IPFS **content ID (CID)** is written on-chain — never the content itself —
which keeps transactions cheap while content stays addressable and independent of
any single server.

## 2. Repository layout

```
blockchain/            Solidity contracts, Hardhat 3 config, tests, deploy scripts
reddit-dapp-project/   React + TypeScript + Vite frontend (the only client)
subgraph/              The Graph subgraph (AssemblyScript event mappings)
deployments/           Canonical deployed contract addresses (source of truth)
```

Each directory is its own independently-buildable npm package (own
`package.json`/`package-lock.json`). They are wired together by one generated,
one-directional propagation step — nothing downstream is hand-edited:

`blockchain/scripts/sync-artifacts.cjs` (auto-run as the `postcompile` step of
`npm run compile`) copies each contract's compiled ABI into
`reddit-dapp-project/src/*.json` and `subgraph/abis/*.json`, and mirrors
`deployments/*.json` into `reddit-dapp-project/src/deployments.json`. After a
redeploy, only `deployments/*.json` changes by hand (via
`blockchain/scripts/update-deployment.mjs`) — everything else follows automatically.

## 3. Contracts — `blockchain/contracts/`

Deployed as a set by `ignition/modules/Forum.ts` (Hardhat Ignition), split into
three contracts because Ethereum caps a single contract's runtime bytecode at
24,576 bytes (EIP-170):

- **`mainContract.sol` → `DecentralizedForum`** — the core: communities (incl.
  nested sub-communities), posts, voting, membership, an on-chain activity score,
  and moderator governance (a permanent creator-moderator, two auto-promoted
  most-active moderators, member-driven nomination/recommendation, and removal by
  vote of ≥ half the moderators). Compiled with `optimizer.runs: 1` +
  `viaIR: true` to stay under the size limit; `scripts/check-size.cjs` enforces
  this in CI.
- **`ForumModeration.sol`** — split out purely for bytecode size: the moderation
  queue (content the safety filter flags waits here for approval), on-chain
  comments, and the report/resolve flow. Calls back into the main contract through
  the `IDecentralizedForum` interface; the two are wired together once, right
  after deploy (`setModerationContract`).
- **`UsernameRegistry.sol`** — standalone: on-chain charset/length/uniqueness
  checks and a rename cooldown (not a fee). Profanity filtering itself is
  client-side only (`lib/usernamePolicy.ts`).
- **`ForumInterfaces.sol`** — the cross-contract interfaces (`IDecentralizedForum`,
  `IForumModeration`) that let the split contracts call each other without a
  circular import.

Tests live in `blockchain/test/*.ts` (Mocha + Chai, ethers via
`hre.network.connect()`), one file per concern (governance, username/votes,
moderation queue, limits/reports, a general smoke test).

## 4. Frontend — `reddit-dapp-project/src/`

- **`App.tsx`** is a thin composition root/layout shell — it renders the top bar,
  the current view, and modals, and reads everything else from one hook,
  `useForum()`. It holds no state itself.
- **`context/`** — all application state and chain interaction, centralized so
  every component reads it the same way:
  - `useForumState.ts` is the composition root: it wires ~20 single-purpose hooks
    under `context/forum/` (e.g. `useCommunities`, `usePosts`, `useVotes`,
    `useModerationActions`, `useSearch`, `useNotifications`) together in
    topological order around a shared `ForumCore` (translation, contract access,
    status messages). Each hook owns one domain and depends only on hooks
    constructed before it — documented at the top of the file.
  - `ForumProvider.tsx` / `forumContext.ts` / `useForum.ts` expose that state via
    React context and the single `useForum()` hook components call.
- **`components/`** — presentational only, grouped by feature: `post/`,
  `comment/`, `community/`, `feed/`, `moderation/`, `notifications/`, `profile/`,
  `search/`, `modals/`, `media/` (IPFS image loading/fallback + lightbox),
  `layout/` (top bar, sidebars).
- **`features/wallet/`** — MetaMask connection (`WalletProvider`, `useWallet`,
  `WalletConnectButton`), independent of forum state.
- **`services/ipfs.ts`** — pins JSON and files to Pinata using `VITE_PINATA_JWT`
  (a write credential baked into the built bundle, so this app is trusted-client
  only — there is deliberately no backend to keep it off the client). Reads fall
  back across several public IPFS gateways (Pinata, Filebase, dweb.link, w3s.link)
  since no single one is reliably fast for both JSON and fresh images.
- **`services/graph.ts`** — the GraphQL client for the subgraph. A failed or
  timed-out query resolves to `null`, and every caller in `context/forum/` falls
  back to a direct contract read — this is what lets the whole app function with
  the Graph/Docker stack off.
- **`lib/config.ts`** — resolves the active chain's contract addresses and Graph
  endpoint from `deployments.json`/env vars once MetaMask reports its chain id
  (local Hardhat `31337` or Sepolia `11155111`).
- **`lib/contracts.ts`** — wires the three contracts' ABIs (generated JSON
  artifacts, never hand-edited) and combines their custom-error fragments so
  `txErrors.ts` can decode a revert from any of them into a translated message.
- **`lib/i18n.ts`**, `usernamePolicy.ts`, `contentSafety.ts`, `format.ts` — English/
  Hebrew translation, client-side username/profanity rules, a client-side content
  safety pre-check (queues flagged content instead of blocking it — the contract
  is still the final authority), and date/id formatting helpers.
- **`types/forum.ts`** — the normalized domain types (`Community`, `Post`,
  `ModeratorRole`, …) shared by contract reads, subgraph reads, and every
  component.

Path alias: `@/` → `src/` (configured in `vite.config.ts`, mirrored in
`tsconfig.json`). The Vite build uses relative asset paths (`base: './'`) so the
compiled frontend itself is deployable to an IPFS gateway subpath, not just to a
conventional web host.

## 5. Subgraph — `subgraph/`

- **`schema.graphql`** — the indexed entities: `User`, `Community`, `Post`,
  `Comment`/`PendingComment`, `Vote`, `Report`/`ReportThread`, `BannedUser`,
  `Activity`, `Notification`, plus `@fulltext` search indexes.
- **`src/mapping.ts`** — one AssemblyScript handler per contract event (community/
  post/vote/moderation/username events), maintaining derived entities and fanning
  moderation notifications out to a community's moderators.
- **`subgraph.yaml`** — three `dataSources`, one per contract, each listing its
  event handlers; `make-sepolia-manifest.mjs` generates the Sepolia-pointed
  variant (`subgraph.sepolia.yaml`) from it.
- Runs on **Docker** (graph-node + Postgres + IPFS), never hosted. `redeploy.sh/.bat`
  runs the local stack against a local Hardhat chain; `redeploy-sepolia.sh/.bat`
  builds and deploys it (as `reppit-sepolia`, on its own port so both can run
  together) indexing the live Sepolia contracts.

## 6. Tools & libraries needed to build

| Area | Tooling |
|---|---|
| Runtime | Node.js 22+, npm (one lockfile per package) |
| Contracts | Solidity 0.8.28, **Hardhat 3**, Hardhat Ignition (deploy), Mocha + Chai (tests), ethers.js v6 |
| Frontend | **React 19 + TypeScript + Vite**, ethers.js v6, `@tanstack/react-query`, `react-router-dom` |
| Indexer | **The Graph**: `graph-cli` + `graph-ts` (AssemblyScript); **Docker Desktop** to run graph-node + Postgres + IPFS locally |
| Wallet | **MetaMask** browser extension — the only supported wallet |
| CI | GitHub Actions (`.github/workflows/ci.yml`) — compiles/tests each package on every push/PR; never deploys or runs the Graph |

## 7. Building / running for development

Full step-by-step instructions are in `USER_GUIDE.md`. In short:

- Only `reddit-dapp-project/` (+ `subgraph/` if you want the local indexer) needs
  `npm install`/`npm ci` to run against the already-deployed Sepolia contracts.
  `blockchain/` is only needed when redeploying contracts.
- The frontend needs a `.env` (copy `.env.example`) with a `VITE_PINATA_JWT` to
  publish; reading works without one.
- `npm run dev` in `reddit-dapp-project/` starts the site at `http://localhost:5173`.
- The Graph stack (optional, needs Docker Desktop) is started with
  `subgraph/redeploy-sepolia.sh` (or `.bat`); without it the app still works via
  direct chain reads, with search/trending/notifications/profile-stats degraded.
- `start-dapp.bat` (repo root) automates the above on Windows.
- Redeploying contracts: `redeploy-contract.bat` (root) recompiles, deploys via
  Ignition, updates `deployments/*.json`, and re-runs `sync-artifacts.cjs`.
