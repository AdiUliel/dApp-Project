#!/bin/bash
# Starts the graph stack against PUBLIC SEPOLIA and deploys the subgraph as
# "reppit-sepolia" (macOS/Linux twin of redeploy-sepolia.bat - keep both in
# sync, teammates on Windows still use the .bat). This stack is fully
# independent of the local one: its own compose project, ports (GraphQL 8100,
# admin 8120, IPFS 5101, Postgres 5442) and database volume - running
# redeploy.sh for local dev does NOT affect it.
# The database is KEPT between runs (Sepolia never resets) and all containers
# auto-restart with Docker Desktop, so the graph stays on.
set -e
cd "$(dirname "$0")"

# Docker Desktop does not always add its CLI to PATH; fall back to the app bundle.
if ! command -v docker >/dev/null 2>&1; then
  export PATH="$PATH:/Applications/Docker.app/Contents/Resources/bin"
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker engine is not running. Open Docker Desktop, wait for 'Engine running', then re-run this script."
  exit 1
fi

echo "Generating the Sepolia manifest from subgraph.yaml..."
node make-sepolia-manifest.mjs

echo "Starting the Sepolia graph stack..."
docker compose -f docker-compose.sepolia.yml up -d

echo "Waiting for graph-node to come up..."
until curl -s -o /dev/null http://localhost:8120; do
  sleep 3
done

echo "Building and deploying the subgraph (sepolia manifest)..."
npm run codegen
npx graph build subgraph.sepolia.yaml
npx graph create --node http://localhost:8120/ reppit-sepolia || true
npx graph deploy --node http://localhost:8120/ --ipfs http://localhost:5101 --version-label v1 reppit-sepolia subgraph.sepolia.yaml

echo
echo "Sepolia subgraph deployed. GraphQL endpoint:"
echo "  http://localhost:8100/subgraphs/name/reppit-sepolia"
echo "Indexing starts from the contract's deploy block and may take a minute to catch up."
