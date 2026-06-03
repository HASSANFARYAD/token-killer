#!/usr/bin/env sh
set -eu

if command -v rtk-node >/dev/null 2>&1; then
  rtk-node uninstall || true
fi

PREFIX="${PREFIX:-$HOME/.local}"
if command -v npm >/dev/null 2>&1; then
  npm uninstall -g rtk-node --prefix "$PREFIX" || npm uninstall -g rtk-node || true
fi

echo "Removed rtk-node where npm could find it. Remove analytics manually from ~/.local/share/rtk-node if desired."
