$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageName = "LAN_Drive_Pro_Portable"
$stamp = Get-Date -Format "yyyyMMdd"
$stageRoot = Join-Path $root "dist\package"
$stage = Join-Path $stageRoot $packageName
$zip = Join-Path $root ("dist\{0}_{1}.zip" -f $packageName, $stamp)

if (Test-Path $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$files = @(
  "app.py",
  "launcher.pyw",
  "server.bat",
  "setup_windows.bat",
  "start_lan_drive_pro.bat",
  "start_launcher.bat",
  "build_launcher.bat",
  "requirements.txt",
  "README.md",
  "README_PORTABLE.txt",
  "PRO_UI_NOTES.md"
)

foreach ($file in $files) {
  $src = Join-Path $root $file
  if (Test-Path $src) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $stage $file) -Force
  }
}

foreach ($dir in @("static", "templates")) {
  Copy-Item -LiteralPath (Join-Path $root $dir) -Destination (Join-Path $stage $dir) -Recurse -Force
}

New-Item -ItemType Directory -Force -Path (Join-Path $stage "files") | Out-Null

if (Test-Path (Join-Path $root "dist\LAN Drive Pro Server.exe")) {
  Copy-Item -LiteralPath (Join-Path $root "dist\LAN Drive Pro Server.exe") -Destination (Join-Path $stage "LAN Drive Pro Server.exe") -Force
}

if (Test-Path (Join-Path $root "dist\LAN Drive Pro Launcher.exe")) {
  Copy-Item -LiteralPath (Join-Path $root "dist\LAN Drive Pro Launcher.exe") -Destination (Join-Path $stage "LAN Drive Pro Launcher.exe") -Force
}

if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}
Compress-Archive -LiteralPath $stage -DestinationPath $zip -Force

Write-Host "Created: $zip"
