#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${EMSDK:-$ROOT/.tools/emsdk}"
if [ ! -f "$SDK/emsdk" ]; then git clone https://github.com/emscripten-core/emsdk.git "$SDK"; fi
"$SDK/emsdk" install 4.0.15
"$SDK/emsdk" activate 4.0.15
