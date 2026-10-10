@echo off
setlocal
title Laptop Assistant Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-windows.ps1"
if errorlevel 1 (
  echo.
  echo Setup did not finish. See the error above. Your previous app and chats are retained.
  pause
  exit /b 1
)
echo.
echo Setup complete. Open Laptop Assistant from your Start menu or Desktop.
pause
