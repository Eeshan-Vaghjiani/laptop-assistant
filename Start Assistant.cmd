@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer from https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\@github\copilot-sdk" (
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
if exist "dist\Laptop Assistant-win32-x64\Laptop Assistant.exe" (
  start "" "%~dp0dist\Laptop Assistant-win32-x64\Laptop Assistant.exe"
) else (
  start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
)
