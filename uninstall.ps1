$ErrorActionPreference = "Continue"

if (Get-Command noisegate -ErrorAction SilentlyContinue) {
  noisegate uninstall
}

$prefix = Join-Path $env:LOCALAPPDATA "noisegate"
if (Get-Command npm -ErrorAction SilentlyContinue) {
  npm uninstall -g noisegate --prefix $prefix
}

Write-Host "Removed noisegate where npm could find it. Remove analytics manually from LOCALAPPDATA data paths if desired."
