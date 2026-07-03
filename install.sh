#!/usr/bin/env sh
set -eu

PREFIX="${PREFIX:-$HOME/.local}"
mkdir -p "$PREFIX/bin"

if command -v npm >/dev/null 2>&1; then
npm install -g sesshush --prefix "$PREFIX"
echo "Installed sesshush to $PREFIX/bin/sesshush"
echo "Add this to your PATH if needed: export PATH=\"$PREFIX/bin:\$PATH\""
if [ "${SESSHUSH_NO_INIT:-0}" != "1" ]; then
  PATH="$PREFIX/bin:$PATH" sesshush init -g --all-agents || true
fi
else
  echo "npm is required to install sesshush" >&2
  exit 1
fi
