#!/usr/bin/env sh
set -eu

PREFIX="${PREFIX:-$HOME/.local}"
mkdir -p "$PREFIX/bin"

if command -v npm >/dev/null 2>&1; then
npm install -g rtk-node --prefix "$PREFIX"
echo "Installed rtk-node to $PREFIX/bin/rtk-node"
echo "Add this to your PATH if needed: export PATH=\"$PREFIX/bin:\$PATH\""
if [ "${RTK_NODE_NO_INIT:-0}" != "1" ]; then
  PATH="$PREFIX/bin:$PATH" rtk-node init -g || true
fi
else
  echo "npm is required to install rtk-node" >&2
  exit 1
fi
