@echo off
rem md2pdf - Markdown to PDF batch converter
rem  - Drag .md files or folders onto this file
rem  - Or: md2pdf.bat <file/folder ...> [options]   (see: md2pdf.bat --help)
rem  - Double-click with no arguments: converts all .md in the current folder
chcp 65001 >nul
setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

if "%~1"=="" (
  node "%~dp0src\index.js" "%CD%"
) else (
  node "%~dp0src\index.js" %*
)
set "RC=%ERRORLEVEL%"

rem Keep the window open when launched by double-click / drag-and-drop
rem (set MD2PDF_NOPAUSE=1 to skip, e.g. in scripts / Task Scheduler)
if not defined MD2PDF_NOPAUSE (
  echo %CMDCMDLINE% | find /i "/c" >nul && pause
)
exit /b %RC%
