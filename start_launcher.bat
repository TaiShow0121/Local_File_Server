@echo off
setlocal
cd /d "%~dp0"

if exist "LAN Drive Pro Launcher.exe" (
  start "" "LAN Drive Pro Launcher.exe"
  exit /b 0
)

if exist "dist\LAN Drive Pro Launcher.exe" (
  start "" "dist\LAN Drive Pro Launcher.exe"
  exit /b 0
)

if not exist ".venv\Scripts\python.exe" (
  call setup_windows.bat
  if errorlevel 1 exit /b 1
)

if not exist files mkdir files

start "" ".venv\Scripts\pythonw.exe" launcher.pyw
