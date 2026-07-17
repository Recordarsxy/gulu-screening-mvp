@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js 24 或更高版本。
  pause
  exit /b 1
)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 24 (
  echo [错误] 当前 Node.js 版本过低，需要 24 或更高版本。
  pause
  exit /b 1
)
if not exist node_modules (
  echo 首次运行，正在安装项目依赖...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 goto :failed
)
echo 正在构建本机网站...
call npm.cmd run build
if errorlevel 1 goto :failed
if not defined PORT set PORT=4318
echo 正在启动 http://127.0.0.1:%PORT%
node scripts\start.mjs
exit /b %errorlevel%
:failed
echo [错误] 启动失败，请查看上方信息。
pause
exit /b 1
