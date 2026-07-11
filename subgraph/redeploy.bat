@echo off
REM Redeploys the subgraph from scratch. Run this after every Hardhat node
REM restart: graph-node stores the old chain's genesis hash in Postgres and
REM refuses to index a freshly reset chain otherwise.

cd /d "%~dp0"

echo Stopping graph stack and wiping its database...
docker compose down -v

echo Starting graph stack...
docker compose up -d

echo Waiting for graph-node to come up...
:wait_loop
timeout /t 3 /nobreak >nul
curl -s -o nul http://localhost:8020 2>nul
if errorlevel 1 goto wait_loop

echo Building and deploying the subgraph...
call npm run codegen
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
call npm run create-local
call npm run deploy-local
if errorlevel 1 exit /b 1

echo.
echo Subgraph deployed. GraphQL endpoint:
echo   http://localhost:8000/subgraphs/name/reppit
