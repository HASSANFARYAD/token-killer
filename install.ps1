$ErrorActionPreference = "Stop"

$prefix = Join-Path $env:LOCALAPPDATA "rtk-node"
New-Item -ItemType Directory -Force -Path $prefix | Out-Null

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm is required to install rtk-node"
}

npm install -g rtk-node --prefix $prefix
Write-Host "Installed rtk-node to $prefix"
Write-Host "Add this to PATH if needed: $prefix"
if ($env:RTK_NODE_NO_INIT -ne "1") {
  $env:PATH = "$prefix;$env:PATH"
  rtk-node init -g --codex
}
