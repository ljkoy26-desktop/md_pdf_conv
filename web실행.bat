@echo off
rem md2pdf web viewer launcher
rem  - Double-click: starts the server and opens the browser
rem  - Close this window (or Ctrl+C) to stop the server
rem  - Other port: set PORT=8080 before running
rem  - Auto restart: the server restarts by itself when src\*.js changes (node --watch)
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title md2pdf web viewer

if not defined PORT set "PORT=3000"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing packages for the first run...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

rem Open the browser shortly after the server starts
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%"

node --watch src\server.js
if errorlevel 1 pause
