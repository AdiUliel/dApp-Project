@echo off
REM Builds the frontend and pins it to IPFS, making the app itself decentralized:
REM once pinned, anyone can serve the exact same dApp from any IPFS gateway - no
REM web server, no host that can take it down. It still talks to the same Sepolia
REM contract and The Graph, so it is the whole forum, hosted by nobody.
REM
REM SECURITY: the build inlines VITE_* env vars, including VITE_PINATA_JWT. Do NOT
REM pin a build that contains a real write-scoped JWT to a PUBLIC pinning service -
REM anyone could extract it. For a public deployment, build with an empty
REM VITE_PINATA_JWT (browse/read works via public gateways; writing new content is
REM then the user's own concern). This script pins to the LOCAL IPFS node only.

setlocal
cd /d "%~dp0reddit-dapp-project"

echo Building the production bundle (relative asset paths, see vite.config.ts)...
call npm run build
if errorlevel 1 exit /b 1

echo.
echo Pinning dist\ to the local IPFS node...
docker cp dist subgraph-ipfs-1:/tmp/reppit-dist
for /f %%C in ('docker exec subgraph-ipfs-1 ipfs add -rQ /tmp/reppit-dist') do set ROOT_CID=%%C

echo.
echo ============================================================
echo  Frontend pinned to IPFS.
echo  Root CID: %ROOT_CID%
echo  Retrieve by CID alone:  ipfs cat %ROOT_CID%/index.html
echo.
echo  To publish beyond this machine, pin the same folder to a
echo  service (Pinata directory pin, web3.storage, or `ipfs pin`
echo  on a public node) and share the gateway URL:
echo    https://^<gateway^>/ipfs/%ROOT_CID%/
echo  Optionally point an ENS name at the CID for a stable address.
echo ============================================================
endlocal
