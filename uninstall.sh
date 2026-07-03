#!/usr/bin/env sh
set -eu

if command -v sesshush >/dev/null 2>&1; then
  sesshush uninstall || true
fi

PREFIX="${PREFIX:-$HOME/.local}"
if command -v npm >/dev/null 2>&1; then
  npm uninstall -g sesshush --prefix "$PREFIX" || npm uninstall -g sesshush || true
fi

echo "Removed sesshush where npm could find it. Remove analytics manually from ~/.local/share/sesshush if desired."
