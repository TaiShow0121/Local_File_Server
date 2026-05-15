@echo off
setlocal
cd /d "%~dp0"
python -m PyInstaller --onefile --name "LAN Drive Pro Server" --add-data "templates;templates" --add-data "static;static" --hidden-import engineio.async_drivers.threading app.py
python -m PyInstaller --onefile --noconsole --name "LAN Drive Pro Launcher" launcher.pyw
echo.
echo Built: dist\LAN Drive Pro Server.exe
echo Built: dist\LAN Drive Pro Launcher.exe
pause
