@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo [错误] 未找到包内 Node.js 运行时：runtime\node.exe
  echo 请重新解压完整的便携包后再试。
  pause
  exit /b 1
)
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue) { exit 7 }"
if errorlevel 7 (
  echo [提示] 端口 4318 已被占用，可能已有一个演示版正在运行。
  echo 请先关闭已有实例，再双击本文件。
  pause
  exit /b 7
)
set "GULU_DATA_DIR=%CD%\data"
set "PORT=4318"
if not exist "data" mkdir "data"
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:4318/'"
pushd "app"
echo 谷露筛选演示版正在运行：http://127.0.0.1:4318/
echo 请保留此窗口；关闭窗口或按 Ctrl+C 可停止服务。
"..\runtime\node.exe" "dist-server\server\index.js"
set "APP_EXIT=%ERRORLEVEL%"
popd
if not "%APP_EXIT%"=="0" (
  echo.
  echo [可恢复错误] 服务已停止，退出码：%APP_EXIT%
  echo 可检查端口占用、重新解压便携包，或备份 data 后重试。
  pause
)
exit /b %APP_EXIT%
