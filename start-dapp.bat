@echo off
setlocal
echo ============================================
echo   Reppit - decentralized forum launcher
echo ============================================
echo.
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
echo Contract is already deployed at 0xddCC23D3051de84c546f9d8DaA3f25795fb9502B
echo (no local node or deploy needed - just MetaMask on the Sepolia network).
echo.

echo Starting frontend...
start "Frontend" cmd /k "cd /d "C:\Users\whate\Desktop\dApp Project\reddit-dapp-project" && npm run dev"

echo Checking for Docker (The Graph + IPFS stack)...
docker info >nul 2>&1
if errorlevel 1 (
    echo ============================================================
    echo  WARNING: Docker is not running. The Graph is REQUIRED for
    echo  notifications, search, trending and profile stats.
    echo  START DOCKER DESKTOP, then run subgraph\redeploy-sepolia.bat
    echo ============================================================
) else (
    echo Docker found. Starting the Sepolia graph stack ^(graph-node + IPFS + Postgres^)...
    start "Graph Stack (Sepolia)" cmd /k "cd /d "C:\Users\whate\Desktop\dApp Project\subgraph" && redeploy-sepolia.bat"
)

echo.
echo All services started!
echo  - Frontend: http://localhost:5173
echo  - MetaMask: switch to the Sepolia network (use YOUR OWN account, never Hardhat test keys)
echo  - GraphQL (if Docker running): http://localhost:8100/subgraphs/name/reppit-sepolia
echo    (the Sepolia graph stack keeps running in Docker even after local dev/resets)
echo.
pause
exit /b 0

:local
echo.
echo === LOCAL mode ===
echo Starting Hardhat node...
start "Hardhat Node" cmd /k "cd /d "C:\Users\whate\Desktop\dApp Project\blockchain" && npx hardhat node"

echo Waiting for node to start...
timeout /t 8 /nobreak

echo Deploying contract...
start "Deploy Contract" cmd /k "cd /d "C:\Users\whate\Desktop\dApp Project\blockchain" && npx hardhat ignition deploy ignition/modules/Forum.ts --network localhost --reset && echo DEPLOY DONE - you can close this window"

echo Waiting for deploy...
timeout /t 10 /nobreak

echo Starting frontend...
start "Frontend" cmd /k "cd /d "C:\Users\whate\Desktop\dApp Project\reddit-dapp-project" && npm run dev"

echo Checking for Docker (The Graph stack)...
docker info >nul 2>&1
if errorlevel 1 (
    echo Docker is not running - skipping The Graph. Search/trending/profile stats will use fallbacks.
    echo To enable: install/start Docker Desktop, then run subgraph\redeploy.bat
) else (
    echo Docker found. Starting The Graph stack and deploying the subgraph...
    start "Graph Stack" cmd /k "cd /d "C:\Users\whate\Desktop\dApp Project\subgraph" && redeploy.bat"
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
