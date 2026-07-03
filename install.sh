#!/usr/bin/env sh
set -eu

PREFIX="${PREFIX:-$HOME/.local}"
mkdir -p "$PREFIX/bin"

if command -v npm >/dev/null 2>&1; then
npm install -g noisegate --prefix "$PREFIX"
echo "Installed noisegate to $PREFIX/bin/noisegate"
echo "Add this to your PATH if needed: export PATH=\"$PREFIX/bin:\$PATH\""
if [ "${NOISEGATE_NO_INIT:-0}" != "1" ]; then
  PATH="$PREFIX/bin:$PATH" noisegate init -g --all-agents || true
fi
else
  echo "npm is required to install noisegate" >&2
  exit 1
fi
