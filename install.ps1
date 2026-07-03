$ErrorActionPreference = "Stop"

$prefix = Join-Path $env:LOCALAPPDATA "sesshush"
New-Item -ItemType Directory -Force -Path $prefix | Out-Null

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm is required to install sesshush"
}

npm install -g sesshush --prefix $prefix
Write-Host "Installed sesshush to $prefix"
Write-Host "Add this to PATH if needed: $prefix"
if ($env:SESSHUSH_NO_INIT -ne "1") {
  $env:PATH = "$prefix;$env:PATH"
  sesshush init -g --all-agents
}
