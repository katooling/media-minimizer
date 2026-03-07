#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE_DIR="$ROOT_DIR/tests/e2e/fixtures/web"
mkdir -p "$FIXTURE_DIR"

download() {
    local url="$1"
    local out="$2"
    echo "[fixtures] downloading: $url"
    curl -L --fail --retry 3 --connect-timeout 20 -o "$out" "$url"
}

download "https://filesamples.com/samples/video/mp4/sample_640x360.mp4" "$FIXTURE_DIR/sample_640x360.mp4"
download "https://filesamples.com/samples/video/webm/sample_640x360.webm" "$FIXTURE_DIR/sample_640x360.webm"
download "https://filesamples.com/samples/video/mov/sample_640x360.mov" "$FIXTURE_DIR/sample_640x360.mov"

echo "[fixtures] checksums"
shasum -a 256 \
    "$FIXTURE_DIR/sample_640x360.mp4" \
    "$FIXTURE_DIR/sample_640x360.webm" \
    "$FIXTURE_DIR/sample_640x360.mov"
