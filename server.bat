@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  call setup_windows.bat
  if errorlevel 1 exit /b 1
)
if not exist files mkdir files
start http://localhost:5000/
".venv\Scripts\python.exe" app.py
pause
