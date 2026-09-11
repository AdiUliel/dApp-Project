# Reppit — Developer Guide (Presentation Summary)

## What it is

Reppit is a decentralized, Reddit-style forum. There is no application
server or central database — the blockchain is the single source of truth,
and the browser talks to it directly.

## Architecture — three pieces

1. **Smart contracts** (on the Sepolia testnet) hold all state: communities,
   posts, comments, votes, membership, moderation, usernames.
2. **A web frontend** reads and writes the contracts directly from the
   browser (via a connected wallet) and uploads post/image content to IPFS.
3. **A subgraph** (chain indexer) watches contract events and serves fast
   search/trending/notification queries — the app still works, in a degraded
   form, if this piece is offline.

**Data flow for "create a post":** content is uploaded to IPFS → the
resulting content ID is written into a transaction sent to the contract →
the transaction emits an event → the indexer picks it up → the frontend
displays the new post (falling back to reading the chain directly if the
indexer isn't running).

## Repository layout

```
blockchain/            Smart contracts + tests + deploy scripts
reddit-dapp-project/   Web frontend
subgraph/              Chain event indexer
deployments/           Deployed contract addresses (source of truth)
```

Each folder is a separate, independently buildable project. Contract
addresses and ABIs are generated once at compile time and copied
automatically into the frontend and subgraph — they are never hand-edited.

## Contracts

Split into three contracts for size/organization reasons, deployed and
wired together as a set:

- **Main forum contract** — communities, posts, voting, membership, and
  moderator governance (promotion, nomination, removal).
- **Moderation contract** — the moderation queue, comments, and
  report/resolve flow; kept separate to stay under the blockchain's
  per-contract size limit.
- **Username registry** — standalone on-chain username registration.

## Frontend

All application state and chain interaction is centralized behind a single
hook that every screen/component reads from — components themselves are
purely presentational, organized by feature (posts, comments, communities,
moderation, profile, search, notifications). A separate module handles
wallet connection, and separate service modules handle talking to IPFS and
to the indexer (with automatic fallback to direct chain reads).

## Subgraph (indexer)

Defines the data it serves (users, communities, posts, comments, votes,
reports, notifications, search indexes) and a handler per contract event
that keeps that data up to date, including fanning out moderation
notifications to a community's moderators. Runs as a small local service
stack; a live version indexes the deployed Sepolia contracts.

## Running it

See `USER_GUIDE.md` for exact steps. In short: the frontend can run against
the already-deployed Sepolia contracts without touching the contracts or
indexer projects at all; those are only needed to redeploy contracts or run
your own indexer. Nothing here is hosted in the cloud — the frontend and (if
used) the indexer stack are started locally.
