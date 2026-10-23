@echo off
setlocal EnableExtensions DisableDelayedExpansion
title SMALLTABLE 0.7.2 - Server
cd /d "%~dp0"
if errorlevel 1 goto :bad_directory
if not exist "package.json" goto :missing_project
where node.exe >nul 2>&1
if errorlevel 1 goto :missing_node
where npm.cmd >nul 2>&1
if errorlevel 1 goto :missing_npm
if not exist "node_modules\tsx\package.json" goto :missing_deps
if not exist "dist\index.html" goto :missing_build

echo ==============================================
echo    SMALLTABLE 0.7.2 - Local server
echo ==============================================
echo Working directory: %CD%
echo Host and port: use your .env or environment settings.
echo Default local address: http://127.0.0.1:3000/
echo Public address: use your own tunnel or reverse proxy.
echo See README.md and the setup help before the first start.
echo Keep this window open. Press Ctrl+C to stop the server.
echo.
call npm.cmd start
set "START_EXIT_CODE=%errorlevel%"
echo.
echo SMALLTABLE stopped. Exit code: %START_EXIT_CODE%
pause
exit /b %START_EXIT_CODE%

:bad_directory
echo ERROR: Cannot enter the script directory.
goto :failed
:missing_project
echo ERROR: Place this CMD next to package.json.
goto :failed
:missing_node
echo ERROR: Install Node.js 22 or newer and reopen this window.
goto :failed
:missing_npm
echo ERROR: npm.cmd not found in PATH.
goto :failed
:missing_deps
echo ERROR: Dependencies missing. Run: npm.cmd ci
goto :failed
:missing_build
echo ERROR: Build missing. Run: npm.cmd run build
goto :failed
:failed
pause
exit /b 1
