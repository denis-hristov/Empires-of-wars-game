#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${EMSDK:-$ROOT/.tools/emsdk}"
if [ ! -f "$SDK/emsdk_env.sh" ]; then
  echo "Emscripten 4.0.15 is required. Set EMSDK or run scripts/setup-wasm.sh." >&2
  exit 1
fi
source "$SDK/emsdk_env.sh"
emcmake "${CMAKE:-cmake}" -S "$ROOT" -B "$ROOT/build-wasm" -DCMAKE_BUILD_TYPE=Release
"${CMAKE:-cmake}" --build "$ROOT/build-wasm" --parallel 6
