# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Reppit — a decentralized Reddit-style forum. Solidity contracts on Ethereum
(local Hardhat or Sepolia testnet) hold all state; a React/Vite frontend reads
and writes to them via ethers.js and MetaMask; a Graph subgraph indexes chain
events for search/trending/notifications; a small Express service brokers IPFS
pinning so the Pinata write credential never reaches the browser. See
`ARCHITECTURE.md` for the IPFS/EVM non-atomicity design and `DEPLOY_SEPOLIA.md`
/ `DEPLOY_IPFS.md` for deployment specifics.

## Repo layout — four independent npm packages

```
blockchain/            Solidity contracts, Hardhat 3 config, tests, deploy scripts
reddit-dapp-project/   React + TypeScript + Vite frontend
subgraph/               The Graph subgraph (AssemblyScript mappings)
upload-service/        Express service that holds the Pinata JWT, pins to IPFS
deployments/           Canonical per-network contract addresses (source of truth)
```

Each has its own `package.json`/`package-lock.json` — `npm install` separately
in each directory you touch. The root `package.json` only holds Hardhat-example
leftovers and is not the real blockchain package (that's `blockchain/`).

## The "sync" data flow — read this before touching contracts

`blockchain/scripts/sync-artifacts.cjs` is the **single source of truth
propagation** step, run automatically via `postcompile` after `npm run compile`
in `blockchain/`:

- Copies each compiled contract's ABI artifact into
  `reddit-dapp-project/src/{Name}.json` (frontend gets the full artifact) and
  `subgraph/abis/{Name}.json` (subgraph gets just the ABI array).
- Mirrors `deployments/local.json` + `deployments/sepolia.json` into
  `reddit-dapp-project/src/deployments.json` (chainId-keyed).

Never hand-edit the `.json` artifact/ABI files in `reddit-dapp-project/src/` or
`subgraph/abis/`, and never hand-edit `reddit-dapp-project/src/deployments.json`
— they're generated. To change an address, edit `deployments/*.json` and run
`npm run sync` in `blockchain/` (or recompile). Contract address for Hardhat's
deterministic local first-deploy is pinned by hand in `subgraph/subgraph.yaml`
and must be updated there too if it ever changes.

`reddit-dapp-project/src/lib/config.ts` picks contract addresses and Graph
endpoints per-chain (`31337` local / `11155111` Sepolia) based on whatever
network MetaMask is connected to — the same build serves both networks with no
code change.

## Common commands

### blockchain/ (Hardhat 3, Solidity 0.8.28)
```bash
npm run compile       # hardhat compile; auto-runs sync-artifacts.cjs after
npm test              # all tests (solidity + mocha/ethers)
npx hardhat test solidity   # solidity-only tests
npx hardhat test mocha      # mocha/ethers-only tests
npm run check-size    # fails if any contract's runtime bytecode > 24,576B (EIP-170)
```
Run a single test file: `npx hardhat test mocha test/FirstTest.ts`. Test files
live in `blockchain/test/*.ts` (mocha + chai + ethers via `hre.network.connect()`).
Contracts compile with `viaIR: true` and `optimizer.runs: 1` (deploy-size
optimized over runtime gas — see the size comment in `hardhat.config.ts`).

Deploy locally: `npx hardhat ignition deploy ignition/modules/Forum.ts --network localhost --reset`,
then `node scripts/update-deployment.mjs local && npm run sync` (this is what
`start-dapp.bat` automates). Deploy to Sepolia: same with `--network sepolia`
after `npx hardhat keystore set SEPOLIA_RPC_URL` / `SEPOLIA_PRIVATE_KEY` — see
`DEPLOY_SEPOLIA.md`.

### reddit-dapp-project/ (React 19 + Vite + TypeScript)
```bash
npm run dev        # vite dev server, http://localhost:5173
npm run build      # tsc -b && vite build
npm run lint       # eslint .
npx tsc -b         # typecheck only (what CI runs)
```
No frontend test runner is configured — CI only typechecks.

### subgraph/ (The Graph, AssemblyScript)
```bash
npm run codegen      # graph codegen
npm run build        # graph build
npm run deploy-local  # deploy as `reppit` to a local graph-node (requires create-local first)
```
Requires Docker (graph-node + Postgres + IPFS). `redeploy.bat`/`redeploy.sh`
wipe and rebuild the whole local stack — necessary after every Hardhat node
restart, because graph-node persists chain state in Postgres and refuses to
index a chain whose genesis changed. `redeploy-sepolia.bat`/`.sh` run the
equivalent flow against Sepolia (separate stack, port 8100 vs 8000, deployed as
`reppit-sepolia`); see `subgraph/README.md` and `DEPLOY_SEPOLIA.md`.

### upload-service/ (Express)
```bash
npm start    # http://localhost:8787
npm run cleanup           # unpin stale `pending` IPFS content past TTL
npm run cleanup -- --dry-run
```
Needs `PINATA_JWT` in `.env` (copy from `.env.example`).

### Full stack
`start-dapp.bat` (Windows) launches everything for one network choice (Sepolia
or local): frontend, upload-service, and — for local — a Hardhat node + deploy
+ sync, or — for Sepolia — the Sepolia graph stack, each in its own terminal.
It has machine-specific absolute paths (`C:\Users\...`) that need editing per
checkout. `redeploy-contract.bat` redeploys the contract to whichever network
and re-syncs.

CI (`.github/workflows/ci.yml`) runs three independent jobs: blockchain
(compile + size gate + test), frontend (typecheck only), subgraph (codegen +
build) — each `working-directory`-scoped to its package.

## Contracts — three-contract split

`blockchain/contracts/`:
- **`mainContract.sol`** → `DecentralizedForum` — the core contract: communities,
  posts, comments, voting, membership, moderator proposals/governance. This is
  the main state-holder and the largest contract by far (deployed size is
  actively gated by `check-size.cjs`, hence `runs:1`).
- **`ForumModeration.sol`** → `ForumModeration` — split out from the main
  contract to keep it under the EIP-170 size limit. Handles moderation-queue
  logic; calls back into `DecentralizedForum` (`onlyModerationContract` guards
  on the main contract; `onlyForumContract` guards here) and must be wired via
  `DecentralizedForum.setModerationContract(...)` after deploy.
- **`UsernameRegistry.sol`** → `UsernameRegistry` — standalone username
  registration, independent of the other two.
- **`ForumInterfaces.sol`** — the `IDecentralizedForum`/`IForumModeration`
  interfaces the two main contracts use to call each other without circular
  imports.

Deploying (`ignition/modules/Forum.ts`) requires wiring the moderation contract
address into the main contract post-deploy; `update-deployment.mjs` /
`redeploy-contract.bat` handle that ordering.

## Frontend structure

`reddit-dapp-project/src/App.tsx` is a large (~4k line) single-file component
holding most of the app's UI and chain-interaction logic — not yet split into
routes/pages (react-router-dom is a dependency but unused so far). Supporting
modules:
- `services/ipfs.ts` — talks to `upload-service` for writes (no token in the
  browser), reads directly from public IPFS gateways with fallback.
- `services/graph.ts` — GraphQL queries against the subgraph, with chain-read
  fallbacks when the graph stack is offline.
- `lib/config.ts` — per-chain contract addresses/Graph URLs (see sync flow
  above). **Never destructure/alias `import.meta.env` as a whole object** —
  Vite inlines every `VITE_*`-prefixed var it can statically see referenced,
  so only ever access specific `import.meta.env.VITE_X` properties by name (a
  stray whole-object alias would leak `VITE_PINATA_JWT` if one is ever set).
- `lib/usernamePolicy.ts`, `lib/contentSafety.ts`, `lib/i18n.ts` — validation
  and translation helpers used by `App.tsx`.
- `features/wallet/` — MetaMask connection provider/hook/button.

## Security-sensitive invariant

The Pinata JWT (IPFS write credential) must never be reachable from the
browser bundle — that's the entire reason `upload-service/` exists instead of
calling Pinata directly from the frontend. When touching IPFS upload code,
keep writes routed through `upload-service`'s `/api/upload` /
`/api/upload-json`, and keep the `import.meta.env` access pattern above intact.
