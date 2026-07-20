@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 24 or newer was not found.
  pause
  exit /b 1
)

set "NODE_MAJOR="
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR (
  echo [ERROR] Unable to read the Node.js version.
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 24 (
  echo [ERROR] Node.js 24 or newer is required.
  pause
  exit /b 1
)

if /i "%~1"=="--check" exit /b 0

if not exist node_modules\.bin\vite.cmd (
  echo Installing dependencies for the first launch...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 goto :failed
)

echo Building the local website...
call npm.cmd run build
if errorlevel 1 goto :failed

if not defined PORT set PORT=4318
echo Starting http://127.0.0.1:%PORT%
node scripts\start.mjs
exit /b %errorlevel%

:failed
echo [ERROR] Startup failed. Review the messages above.
pause
exit /b 1
