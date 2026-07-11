@echo off
REM Starts the graph stack against PUBLIC SEPOLIA and deploys the subgraph as
REM "reppit-sepolia". This stack is fully independent of the local one: its own
REM compose project, ports (GraphQL 8100, admin 8120, IPFS 5101, Postgres 5442)
REM and database volume - running local redeploy.bat does NOT affect it.
REM The database is KEPT between runs (Sepolia never resets) and all containers
REM auto-restart with Docker Desktop, so the graph stays on.

cd /d "%~dp0"

echo Generating the Sepolia manifest from subgraph.yaml...
node make-sepolia-manifest.mjs
if errorlevel 1 exit /b 1

echo Starting the Sepolia graph stack...
docker compose -f docker-compose.sepolia.yml up -d
if errorlevel 1 exit /b 1

echo Waiting for graph-node to come up...
:wait_loop
timeout /t 3 /nobreak >nul
curl -s -o nul http://localhost:8120 2>nul
if errorlevel 1 goto wait_loop

echo Building and deploying the subgraph (sepolia manifest)...
call npm run codegen
if errorlevel 1 exit /b 1
call npx graph build subgraph.sepolia.yaml
if errorlevel 1 exit /b 1
call npx graph create --node http://localhost:8120/ reppit-sepolia
call npx graph deploy --node http://localhost:8120/ --ipfs http://localhost:5101 --version-label v1 reppit-sepolia subgraph.sepolia.yaml
if errorlevel 1 exit /b 1

echo.
echo Sepolia subgraph deployed. GraphQL endpoint:
echo   http://localhost:8100/subgraphs/name/reppit-sepolia
echo Indexing starts from the contract's deploy block and may take a minute to catch up.
