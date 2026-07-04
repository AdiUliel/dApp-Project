# Reppit Subgraph

Indexes the DecentralizedForum contract on the local Hardhat chain and powers
search, the trending feed, profile stats (including gas spend), and
notifications in the frontend.

## Prerequisites

- **Docker Desktop** (with WSL2 backend) — runs graph-node, Postgres, and IPFS.
- Node.js — the `@graphprotocol/graph-cli` toolchain is a dev dependency
  (`npm install` in this directory).

## First run

```
cd subgraph
npm install
redeploy.bat
```

`redeploy.bat` starts the Docker stack, builds the subgraph, and deploys it as
`reppit`. GraphQL endpoint: `http://localhost:8000/subgraphs/name/reppit`.

## After every Hardhat node restart

The Hardhat chain resets on every restart, but graph-node remembers the old
chain in Postgres and will refuse to index the new one (genesis mismatch).
Always run `redeploy.bat` again after restarting the node — it wipes the
database volume (`docker compose down -v`) and redeploys.

## Notes

- The contract address is pinned in `subgraph.yaml`
  (`0x5FbDB2315678afecb367f032d93F642f64180aa3`) — the deterministic first
  deployment address on a fresh Hardhat node. If it ever changes, update it
  there.
- Post titles/tags and community descriptions are emitted in events, so the
  subgraph never needs to fetch content from IPFS.
- The frontend degrades gracefully when the graph stack is offline (limited
  client-side search, chain-read trending fallback).
