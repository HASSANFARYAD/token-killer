#!/usr/bin/env sh
set -eu

if command -v noisegate >/dev/null 2>&1; then
  noisegate uninstall || true
fi

PREFIX="${PREFIX:-$HOME/.local}"
if command -v npm >/dev/null 2>&1; then
  npm uninstall -g noisegate --prefix "$PREFIX" || npm uninstall -g noisegate || true
fi

echo "Removed noisegate where npm could find it. Remove analytics manually from ~/.local/share/noisegate if desired."
