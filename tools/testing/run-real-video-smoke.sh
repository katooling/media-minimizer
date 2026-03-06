#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1:4173}"
DEFAULT_REAL_VIDEO="$HOME/Downloads/Screen Recording 2025-12-11 at 3.04.37 PM.mov"
REAL_VIDEO_CANDIDATE="${REAL_VIDEO_PATH:-$DEFAULT_REAL_VIDEO}"

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
