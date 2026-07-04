#!/bin/bash
# Redeploys the subgraph from scratch (macOS/Linux twin of redeploy.bat).
# Run this after every Hardhat node restart: graph-node stores the old chain's
# genesis hash in Postgres and refuses to index a freshly reset chain otherwise.
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

echo "Stopping graph stack and wiping its database..."
docker compose down -v

echo "Starting graph stack..."
docker compose up -d

echo "Waiting for graph-node to come up..."
until curl -s -o /dev/null http://localhost:8020; do
  sleep 3
done

echo "Building and deploying the subgraph..."
npm run codegen
npm run build
npm run create-local || true
npm run deploy-local

echo
echo "Subgraph deployed. GraphQL endpoint:"
echo "  http://localhost:8000/subgraphs/name/reppit"
