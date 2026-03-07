#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1:4173}"
DEFAULT_REAL_VIDEO="$ROOT_DIR/tests/e2e/fixtures/local-debug-video.mov"
if [[ -z "${REAL_VIDEO_PATH:-}" ]]; then
    REAL_VIDEO_CANDIDATE="$(bash ./tools/testing/prepare-debug-video.sh)"
else
    REAL_VIDEO_CANDIDATE="$REAL_VIDEO_PATH"
fi

if [[ ! -f "$REAL_VIDEO_CANDIDATE" ]]; then
    echo "[real-video-smoke] Skipped. File not found: $REAL_VIDEO_CANDIDATE"
    exit 0
fi

python3 -m http.server 4173 --bind 127.0.0.1 >/tmp/media-minimizer-http.log 2>&1 &
SERVER_PID=$!
cleanup() {
    kill "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in $(seq 1 30); do
    if curl -sSf "$BASE_URL/" >/dev/null; then
        break
    fi
    sleep 1
done

echo "[real-video-smoke] Running with: $REAL_VIDEO_CANDIDATE"
REAL_VIDEO_PATH="$REAL_VIDEO_CANDIDATE" BASE_URL="$BASE_URL" node tests/e2e/bench/real-video-smoke.js
