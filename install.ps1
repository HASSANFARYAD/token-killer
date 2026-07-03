$ErrorActionPreference = "Stop"

$prefix = Join-Path $env:LOCALAPPDATA "noisegate"
New-Item -ItemType Directory -Force -Path $prefix | Out-Null

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm is required to install noisegate"
}

npm install -g noisegate --prefix $prefix
Write-Host "Installed noisegate to $prefix"
Write-Host "Add this to PATH if needed: $prefix"
if ($env:NOISEGATE_NO_INIT -ne "1") {
  $env:PATH = "$prefix;$env:PATH"
  noisegate init -g --all-agents
}
