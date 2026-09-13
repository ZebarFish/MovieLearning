@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Learn English Through TV

echo ==================================================
echo    Learn English Through TV   -   Quick Start
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist "node_modules" goto installdeps
if not exist "dist\index.html" goto dobld
goto run

:installdeps
echo [1/3] Installing dependencies - the first run can take a few minutes ...
call npm install
if errorlevel 1 goto failed

:dobld
if exist "dist\index.html" goto run
echo [2/3] Building the project ...
call npm run build
if errorlevel 1 goto failed
goto run

:run
echo [3/3] Starting the local server at http://localhost:5180
echo        Your browser will open automatically.
echo.
echo        Keep this window open while you use the app.
echo        Close this window to stop the server.
echo.
call npm run start
echo.
echo Server stopped.
pause
exit /b 0

:nonode
echo [ERROR] Node.js was not found on this computer.
echo         Install Node.js 18 or newer from https://nodejs.org
echo         then double-click this file again.
echo.
pause
exit /b 1

:failed
echo.
echo [ERROR] The previous step failed. See the messages above.
echo.
pause
exit /b 1
