# Decentralizing the frontend: hosting the app itself on IPFS

Until now the only centralized piece left in the project was the **web host** that
serves the React app. The contract lives on-chain forever, content lives on IPFS,
and anyone can run a Graph indexer - but if the machine serving `index.html` goes
down, users can't reach the dApp even though all its data is still there.

Pinning the built frontend to IPFS removes that last dependency. The app becomes
content-addressed: given only its CID, anyone can serve the exact same dApp from
any IPFS gateway. Nobody owns the address; nobody can take it down.

## What makes it work

- `reddit-dapp-project/vite.config.ts` sets `base: './'` so assets load with
  **relative** paths (`./assets/...`). With Vite's default absolute `/assets`
  paths the bundle 404s when served from a gateway subpath (`/ipfs/<CID>/`).
- The contract address is already baked into `src/config.ts`, and the app picks
  the network from MetaMask's `chainId` - so the static bundle needs no server
  and no runtime config to reach the live Sepolia forum.

## Build and pin

```
deploy-ipfs.bat
```

This builds `dist/` and pins it to the local IPFS (kubo) node, printing the root
CID. Verified working: the pinned bundle is retrievable by CID alone and, served
statically, connects to the chain and loads the full forum (communities, posts,
votes, search) with no dev server running.

To publish beyond your own machine, pin the same `dist/` folder to an always-on
service - a **Pinata directory pin**, **web3.storage**, or `ipfs pin` on a public
node - and share `https://<gateway>/ipfs/<CID>/`. Point an **ENS** name at the CID
for a stable, human-readable address (`app.reppit.eth`).

## Important: the Pinata JWT and public pins

`npm run build` inlines every `VITE_*` env var into the bundle, including
`VITE_PINATA_JWT`. The **read** path (browsing the whole forum) needs no secret -
it uses public IPFS gateways and public RPC/Graph endpoints, so it is fully safe
to pin publicly. The **write** path (pinning new post/image content) needs a
credential, and you must not ship a write-scoped JWT inside a public bundle -
anyone could extract it.

For a public, decentralized deployment, build with an empty `VITE_PINATA_JWT`:
browsing works everywhere, and writing becomes each user's own concern (their own
pinning key, or a future in-app "bring your own pinning" flow). `deploy-ipfs.bat`
only pins to the local node, so it does not expose the key.

## The decentralization picture, completed

| Layer | Where it lives | Who can run/serve it |
| --- | --- | --- |
| State + rules | `DecentralizedForum` on Sepolia | the chain (permanent) |
| Content (posts, images) | IPFS via CIDs on-chain | any IPFS node/gateway |
| Fast queries + search | The Graph subgraph | anyone (self-hosted or Studio) |
| **The app UI itself** | **IPFS (this doc)** | **any gateway - no host** |
