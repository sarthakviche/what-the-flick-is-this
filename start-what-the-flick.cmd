@echo off
rem One click launcher for "what the flick is this?".
rem First run: installs dependencies and puts a shortcut on your Desktop. After that it just starts the app.
title what the flick is this?
cd /d "%~dp0windows-local"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Opening the download page...
  echo  Install the LTS version, then double click this file again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo  First run: installing stuff. This takes a minute or two...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  npm install failed. Check your internet and try again.
    pause
    exit /b 1
  )
)

if not exist "%USERPROFILE%\Desktop\what the flick is this.lnk" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\create-desktop-shortcut.ps1" >nul 2>nul
)

start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
