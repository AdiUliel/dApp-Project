@echo off
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
echo  - GraphQL (if Docker running): http://localhost:8000/subgraphs/name/reppit
echo.
pause
