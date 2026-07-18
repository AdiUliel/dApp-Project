@echo off
setlocal enabledelayedexpansion
REM Redeploys the DecentralizedForum contract end to end:
REM   compile -> size gate -> Ignition deploy (--reset) -> record the new
REM   address+startBlock in deployments\<network>.json (single source of truth)
REM   -> sync ABI/addresses to frontend+subgraph -> re-index the graph stack.
REM
REM A redeploy creates a NEW contract at a NEW address: all forum data on the
REM old contract stays there, orphaned. On Sepolia that wipes the SHARED forum
REM for everyone - the script asks before doing it.

cd /d "%~dp0"

echo ============================================
echo  Reppit contract redeploy
echo ============================================
echo   1. Local Hardhat chain (localhost:8545)
echo   2. Public Sepolia testnet  [wipes the shared forum]
echo.
choice /c 12 /n /m "Deploy where? [1,2] "
if errorlevel 2 (set NETWORK=sepolia) else (set NETWORK=local)

REM --- compile + size gate (postcompile auto-syncs ABI + deployments mirror) ---
cd blockchain
echo.
echo === Compiling...
call npm run compile
if errorlevel 1 exit /b 1
call npm run check-size
if errorlevel 1 exit /b 1

if "%NETWORK%"=="sepolia" goto :sepolia

REM ================= LOCAL =================
echo.
echo === Checking the local node on http://localhost:8545 ...
curl -s -m 3 -X POST http://localhost:8545 -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" >nul 2>&1
if errorlevel 1 (
  echo No node is listening on 8545. Start it first:  cd blockchain ^&^& npx hardhat node
  exit /b 1
)

echo.
echo === Deploying to localhost ^(--reset^)...
(echo y& echo y)| npx hardhat ignition deploy ignition/modules/Forum.ts --network localhost --reset
if errorlevel 1 exit /b 1

echo.
echo === Recording the new deployment...
node scripts\update-deployment.mjs local
if errorlevel 1 exit /b 1
call npm run sync
if errorlevel 1 exit /b 1

echo.
echo === Re-indexing the local graph stack...
cd ..
call subgraph\redeploy.bat
goto :done

REM ================= SEPOLIA =================
:sepolia
echo.
echo  *** WARNING ***********************************************
echo  A new Sepolia deployment gets a NEW address. The shared
echo  forum (all communities/posts/users) on the current contract
echo  will no longer be reachable from the app. Everyone starts
echo  from an empty forum.
echo  ***********************************************************
echo.
choice /c YN /n /m "Really redeploy to Sepolia? [Y,N] "
if errorlevel 2 (
  echo Cancelled.
  exit /b 0
)

REM The deployer key stays in the gitignored .sepolia-deployer.json and is only
REM exported into this process's environment - never echoed, never committed.
if not defined SEPOLIA_PRIVATE_KEY (
  if not exist .sepolia-deployer.json (
    echo .sepolia-deployer.json not found and SEPOLIA_PRIVATE_KEY is not set.
    exit /b 1
  )
  for /f "usebackq delims=" %%K in (`node -p "require('./.sepolia-deployer.json').privateKey"`) do set "SEPOLIA_PRIVATE_KEY=%%K"
)

echo.
echo === Deploying to Sepolia ^(--reset^)... this can take a minute or two.
(echo y& echo y)| npx hardhat ignition deploy ignition/modules/Forum.ts --network sepolia --reset
if errorlevel 1 exit /b 1

echo.
echo === Recording the new deployment...
node scripts\update-deployment.mjs sepolia
if errorlevel 1 exit /b 1
call npm run sync
if errorlevel 1 exit /b 1

echo.
echo === Re-indexing the Sepolia graph stack from the new address...
cd ..
call subgraph\redeploy-sepolia.bat

:done
cd /d "%~dp0"

REM A leftover VITE_ override in the frontend .env would shadow the new address.
if exist reddit-dapp-project\.env (
  findstr /b "VITE_LOCAL_CONTRACT_ADDRESS= VITE_SEPOLIA_CONTRACT_ADDRESS=" reddit-dapp-project\.env >nul 2>&1
  if not errorlevel 1 (
    echo.
    echo  NOTE: reddit-dapp-project\.env sets a VITE_*_CONTRACT_ADDRESS override,
    echo  which takes precedence over the freshly recorded address. Remove or
    echo  update that line, then restart the dev server.
  )
)

echo.
echo ============================================
echo  Redeploy complete (%NETWORK%).
echo  - deployments\%NETWORK%.json now holds the new address+startBlock
echo  - frontend + subgraph ABI/addresses are synced
echo  - remember to commit deployments\ and reddit-dapp-project\src\deployments.json
echo ============================================
endlocal
