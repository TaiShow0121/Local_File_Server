@echo off
setlocal
cd /d "%~dp0"

if exist "LAN Drive Pro Server.exe" (
  if not exist files mkdir files
  echo.
  echo [LAN Drive Pro] Starting bundled server...
  echo Open: http://127.0.0.1:5000/
  echo Press Ctrl+C in this window to stop.
  echo.
  start "" "http://127.0.0.1:5000/"
  "LAN Drive Pro Server.exe"
  pause
  exit /b 0
)

if exist "dist\LAN Drive Pro Server.exe" (
  if not exist files mkdir files
  echo.
  echo [LAN Drive Pro] Starting bundled server...
  echo Open: http://127.0.0.1:5000/
  echo Press Ctrl+C in this window to stop.
  echo.
  start "" "http://127.0.0.1:5000/"
  "dist\LAN Drive Pro Server.exe"
  pause
  exit /b 0
)

if not exist ".venv\Scripts\python.exe" (
  call setup_windows.bat
  if errorlevel 1 exit /b 1
)

if not exist files mkdir files

echo.
echo [LAN Drive Pro] Starting server...
echo Open: http://127.0.0.1:5000/
echo Press Ctrl+C in this window to stop.
echo.
start "" "http://127.0.0.1:5000/"
".venv\Scripts\python.exe" app.py
pause
