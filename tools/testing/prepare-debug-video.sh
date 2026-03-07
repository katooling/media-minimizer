#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_VIDEO="$ROOT_DIR/tests/e2e/fixtures/local-debug-video.mov"

if [[ -f "$TARGET_VIDEO" ]]; then
    echo "$TARGET_VIDEO"
    exit 0
fi

SOURCE_CANDIDATES=(
    "$HOME/Desktop/Screen Recording 2025-12-11 at 3.04.37 PM.mov"
    "$HOME/Downloads/Screen Recording 2025-12-11 at 3.04.37 PM.mov"
)

for source in "${SOURCE_CANDIDATES[@]}"; do
    if [[ -f "$source" ]]; then
        mkdir -p "$(dirname "$TARGET_VIDEO")"
        cp "$source" "$TARGET_VIDEO"
        echo "$TARGET_VIDEO"
        exit 0
    fi
done

echo "$TARGET_VIDEO"
exit 0
