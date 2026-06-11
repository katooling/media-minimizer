#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

BASE_URL="${BASE_URL:-http://127.0.0.1:4173}"

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

BASE_URL="$BASE_URL" node tests/e2e/bench/real-video-matrix.js
