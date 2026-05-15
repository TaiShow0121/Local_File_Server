@echo off
setlocal
cd /d "%~dp0"

echo.
echo [LAN Drive Pro] Setting up local Python environment...

if exist ".venv\Scripts\python.exe" goto install

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m venv .venv
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    python -m venv .venv
  ) else (
    echo.
    echo Python was not found.
    echo Install Python 3.10 or later from https://www.python.org/downloads/windows/
    echo Make sure "Add python.exe to PATH" is enabled, then run this file again.
    pause
    exit /b 1
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo.
  echo Failed to create .venv.
  pause
  exit /b 1
)

:install
".venv\Scripts\python.exe" -m pip install --upgrade pip
if exist requirements.txt (
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
) else (
  ".venv\Scripts\python.exe" -m pip install flask flask-socketio markdown markupsafe
)

if not exist files mkdir files

echo.
echo Setup complete.
pause
