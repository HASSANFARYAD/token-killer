$ErrorActionPreference = "Continue"

if (Get-Command rtk-node -ErrorAction SilentlyContinue) {
  rtk-node uninstall
}

$prefix = Join-Path $env:LOCALAPPDATA "rtk-node"
if (Get-Command npm -ErrorAction SilentlyContinue) {
  npm uninstall -g rtk-node --prefix $prefix
}

Write-Host "Removed rtk-node where npm could find it. Remove analytics manually from LOCALAPPDATA data paths if desired."
