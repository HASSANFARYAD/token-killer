$ErrorActionPreference = "Continue"

if (Get-Command sesshush -ErrorAction SilentlyContinue) {
  sesshush uninstall
}

$prefix = Join-Path $env:LOCALAPPDATA "sesshush"
if (Get-Command npm -ErrorAction SilentlyContinue) {
  npm uninstall -g sesshush --prefix $prefix
}

Write-Host "Removed sesshush where npm could find it. Remove analytics manually from LOCALAPPDATA data paths if desired."
