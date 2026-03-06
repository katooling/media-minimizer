#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS_DIR="$ROOT_DIR/tools/ffmpeg-core"
PROFILE="${1:-}"

if [[ -z "$PROFILE" ]]; then
  echo "Usage: $0 <st-lite|st-large|mt-fast>"
  exit 1
fi

OUT_DIR="$TOOLS_DIR/out/$PROFILE/dist"
if [[ ! -d "$OUT_DIR" ]]; then
  echo "Missing build output: $OUT_DIR"
  echo "Run: $TOOLS_DIR/build-core.sh $PROFILE"
  exit 1
fi

ESM_DIR="$OUT_DIR/esm"
if [[ ! -d "$ESM_DIR" ]]; then
  echo "Missing ESM output: $ESM_DIR"
  echo "Run: $TOOLS_DIR/build-core.sh $PROFILE"
  exit 1
fi

case "$PROFILE" in
  st-lite)
    TARGET_DIR="$ROOT_DIR/vendor/ffmpeg/core-st-lite"
    mkdir -p "$TARGET_DIR"
    cp "$ESM_DIR/ffmpeg-core.js" "$TARGET_DIR/ffmpeg-core.js"
    cp "$ESM_DIR/ffmpeg-core.wasm" "$TARGET_DIR/ffmpeg-core.wasm"
    ;;
  st-large)
    TARGET_DIR="$ROOT_DIR/vendor/ffmpeg/core-st-large"
    mkdir -p "$TARGET_DIR"
    cp "$ESM_DIR/ffmpeg-core.js" "$TARGET_DIR/ffmpeg-core.js"
    cp "$ESM_DIR/ffmpeg-core.wasm" "$TARGET_DIR/ffmpeg-core.wasm"
    ;;
  mt-fast)
    TARGET_DIR="$ROOT_DIR/vendor/ffmpeg/core-mt-fast"
    mkdir -p "$TARGET_DIR"
    cp "$ESM_DIR/ffmpeg-core.js" "$TARGET_DIR/ffmpeg-core.js"
    cp "$ESM_DIR/ffmpeg-core.wasm" "$TARGET_DIR/ffmpeg-core.wasm"
    cp "$ESM_DIR/ffmpeg-core.worker.js" "$TARGET_DIR/ffmpeg-core.worker.js"
    ;;
  *)
    echo "Unknown profile: $PROFILE"
    exit 1
    ;;
esac

(
  cd "$ROOT_DIR"
  shasum -a 256 \
    vendor/ffmpeg/core-st-lite/ffmpeg-core.js \
    vendor/ffmpeg/core-st-lite/ffmpeg-core.wasm \
    vendor/ffmpeg/core-st-large/ffmpeg-core.js \
    vendor/ffmpeg/core-st-large/ffmpeg-core.wasm \
    vendor/ffmpeg/core-mt-fast/ffmpeg-core.js \
    vendor/ffmpeg/core-mt-fast/ffmpeg-core.wasm \
    vendor/ffmpeg/core-mt-fast/ffmpeg-core.worker.js \
    > vendor/ffmpeg/CHECKSUMS.sha256
)

echo "Synced profile '$PROFILE' and refreshed vendor/ffmpeg/CHECKSUMS.sha256"
