#!/bin/bash
# Сборка engine.mjs из исходников HSR Optimizer + моста
set -e
SRC=${1:-/data/ext/hsr-optimizer}; OUT=${2:-$SRC/.bridge-build}; HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$SRC/src/hsrbridge" && cp "$HERE/bridge/bridge.ts" "$SRC/src/hsrbridge/bridge.ts" && cp "$HERE/vite.bridge.config.ts" "$SRC/"
cd "$SRC" && HSRPACK_STUBS="$HERE/stubs" HSRPACK_OUT="$OUT" HSRPACK_MINIFY=${MINIFY-1} npx vite build --config vite.bridge.config.ts --configLoader native --logLevel warn
