@echo off
setlocal
cd /d "%~dp0"
python -m PyInstaller --onefile --noconsole --name "LAN Drive Pro Launcher" launcher.pyw
echo.
echo Built: dist\LAN Drive Pro Launcher.exe
pause
