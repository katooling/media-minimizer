#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS_DIR="$ROOT_DIR/tools/ffmpeg-core"
PROFILE="${1:-}"

if [[ -z "$PROFILE" ]]; then
  echo "Usage: $0 <st-lite|st-large|mt-fast>"
  exit 1
fi

FLAGS_FILE="$TOOLS_DIR/profiles/$PROFILE.flags"
if [[ ! -f "$FLAGS_FILE" ]]; then
  echo "Unknown profile: $PROFILE"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required"
  exit 1
fi

TMP_BASE="$TOOLS_DIR/.tmp"
SRC_DIR="$TMP_BASE/ffmpeg.wasm"
OUT_DIR="$TOOLS_DIR/out/$PROFILE"
PINNED_FFMPEG_WASM_COMMIT="f876f907c7e9b9bf51d4ed0b913a855a63ae63fc"

mkdir -p "$TMP_BASE"
rm -rf "$SRC_DIR" "$OUT_DIR"

git clone https://github.com/ffmpegwasm/ffmpeg.wasm.git "$SRC_DIR"
git -C "$SRC_DIR" checkout "$PINNED_FFMPEG_WASM_COMMIT"

# Allow custom profile flags to pass into ffmpeg configure.
perl -0pi -e 's/emconfigure \.\/configure "\$\{CONF_FLAGS\[@\]\}" \$@/emconfigure .\/configure "\$\{CONF_FLAGS\[@\]\}" \$\{CUSTOM_FFMPEG_FLAGS:-\} \$@/g' "$SRC_DIR/build/ffmpeg.sh"
perl -0pi -e 's/ARG FFMPEG_MT\n/ARG FFMPEG_MT\nARG CUSTOM_FFMPEG_FLAGS\n/g' "$SRC_DIR/Dockerfile"
perl -0pi -e 's/ENV FFMPEG_MT=\$FFMPEG_MT\n/ENV FFMPEG_MT=\$FFMPEG_MT\nENV CUSTOM_FFMPEG_FLAGS=\$CUSTOM_FFMPEG_FLAGS\n/g' "$SRC_DIR/Dockerfile"

CUSTOM_FLAGS="$(grep -v '^#' "$FLAGS_FILE" | tr '\n' ' ')"
EXTRA_CFLAGS='-O3 -msimd128'
FFMPEG_ST='yes'
FFMPEG_MT=''

if [[ "$PROFILE" == "mt-fast" ]]; then
  EXTRA_CFLAGS='-O3 -msimd128 -sUSE_PTHREADS -pthread'
  FFMPEG_ST=''
  FFMPEG_MT='yes'
fi

(
  cd "$SRC_DIR"
  docker buildx build \
    --build-arg EXTRA_CFLAGS="$EXTRA_CFLAGS" \
    --build-arg EXTRA_LDFLAGS='' \
    --build-arg FFMPEG_ST="$FFMPEG_ST" \
    --build-arg FFMPEG_MT="$FFMPEG_MT" \
    --build-arg CUSTOM_FFMPEG_FLAGS="$CUSTOM_FLAGS" \
    -o "$OUT_DIR" \
    .
)

echo "Built profile '$PROFILE' to $OUT_DIR"
echo "Run: $TOOLS_DIR/sync-vendor.sh $PROFILE"
