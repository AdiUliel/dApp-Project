@echo off
setlocal
REM Paths are relative to this script, so the launcher works from any clone
REM location on any machine (no hardcoded C:\Users\... paths).
set "ROOT=%~dp0"

echo ============================================
echo   Reppit - decentralized forum launcher
echo ============================================
echo.

if not exist "%ROOT%reddit-dapp-project\node_modules" (
    echo  First run? Install the frontend dependencies once:
    echo    cd reddit-dapp-project ^&^& npm ci
    echo.
)

REM Post/comment content and images are pinned to IPFS with a Pinata token read
REM from the frontend .env (gitignored - share it privately, never commit it).
findstr /b /c:"VITE_PINATA_JWT=" "%ROOT%reddit-dapp-project\.env" >nul 2>&1
if errorlevel 1 (
    echo ============================================================
    echo  WARNING: reddit-dapp-project\.env has no VITE_PINATA_JWT.
    echo  Reading the forum works, but publishing posts, comments and
    echo  images will fail. Copy .env.example to .env and add the token.
    echo ============================================================
    echo.
)

echo Which network do you want to run against?
echo   [1] SEPOLIA (public testnet - shared forum, default)
echo   [2] LOCAL   (Hardhat node - isolated dev chain)
echo.
set NETCHOICE=1
set /p NETCHOICE="Choice [1]: "

if "%NETCHOICE%"=="2" goto local

:sepolia
echo.
echo === SEPOLIA mode ===
echo Contract addresses come from deployments\sepolia.json (kept current by
echo redeploy-contract.bat). No local node needed - just MetaMask on Sepolia.
echo.

echo Starting frontend...
start "Frontend" cmd /k "cd /d "%ROOT%reddit-dapp-project" && npm run dev"

echo Checking for Docker (The Graph + IPFS stack)...
docker info >nul 2>&1
if errorlevel 1 (
    echo ============================================================
    echo  WARNING: Docker is not running. The Graph is REQUIRED for
    echo  comments, notifications, search, trending and profile stats.
    echo  START DOCKER DESKTOP, then run subgraph\redeploy-sepolia.bat
    echo ============================================================
) else (
    echo Docker found. Starting the Sepolia graph stack ^(graph-node + IPFS + Postgres^)...
    start "Graph Stack (Sepolia)" cmd /k "cd /d "%ROOT%subgraph" && redeploy-sepolia.bat"
)

echo.
echo All services started!
echo  - Frontend: http://localhost:5173
echo  - MetaMask: switch to the Sepolia network (use YOUR OWN account, never Hardhat test keys)
echo  - GraphQL (if Docker running): http://localhost:8100/subgraphs/name/reppit-sepolia
echo    (the first run indexes the forum history - give it a few minutes)
echo.
pause
exit /b 0

:local
echo.
echo === LOCAL mode ===
echo Starting Hardhat node...
start "Hardhat Node" cmd /k "cd /d "%ROOT%blockchain" && npx hardhat node"

echo Waiting for node to start...
timeout /t 8 /nobreak

echo Deploying contracts...
REM After the deploy, update-deployment.mjs + sync record the actual addresses in
REM deployments\local.json and propagate them to the frontend and subgraph.yaml.
start "Deploy Contracts" cmd /k "cd /d "%ROOT%blockchain" && npx hardhat ignition deploy ignition/modules/Forum.ts --network localhost --reset && node scripts\update-deployment.mjs local && npm run sync && echo DEPLOY DONE - you can close this window"

echo Waiting for deploy...
timeout /t 12 /nobreak

echo Starting frontend...
start "Frontend" cmd /k "cd /d "%ROOT%reddit-dapp-project" && npm run dev"

echo Checking for Docker (The Graph stack)...
docker info >nul 2>&1
if errorlevel 1 (
    echo Docker is not running - skipping The Graph. Search/trending/profile stats will use fallbacks.
    echo To enable: install/start Docker Desktop, then run subgraph\redeploy.bat
) else (
    echo Docker found. Starting The Graph stack and deploying the subgraph...
    start "Graph Stack" cmd /k "cd /d "%ROOT%subgraph" && redeploy.bat"
)

echo.
echo All services started!
echo  - Hardhat node: http://127.0.0.1:8545
echo  - Frontend: http://localhost:5173
echo  - Reminder: after every local reset, clear MetaMask activity data (Settings, Advanced)
echo  - GraphQL (if Docker running): http://localhost:8000/subgraphs/name/reppit
echo.
pause
exit /b 0
