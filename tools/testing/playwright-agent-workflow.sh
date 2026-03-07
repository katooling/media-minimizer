#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

RESULT_JSON="test-results/agent-results.json"
mkdir -p test-results
rm -f "$RESULT_JSON"

echo "[agent-e2e] Running Playwright with agent config..."
echo "[agent-e2e] Command: npx playwright test -c playwright.agent.config.js $*"

set +e
npx playwright test -c playwright.agent.config.js "$@"
TEST_EXIT_CODE=$?
set -e

if [[ -f "$RESULT_JSON" ]]; then
    node tools/testing/summarize-playwright-results.mjs "$RESULT_JSON"
else
    echo "[agent-e2e] JSON report was not generated."
fi

if [[ $TEST_EXIT_CODE -ne 0 ]]; then
    echo "[agent-e2e] Failures detected. Open report with: npm run test:e2e:report"
    exit $TEST_EXIT_CODE
fi

if [[ "${SKIP_REAL_VIDEO:-0}" == "1" ]]; then
    echo "[agent-e2e] Skipping real-video smoke (SKIP_REAL_VIDEO=1)."
    exit 0
fi

if [[ -z "${REAL_VIDEO_PATH:-}" ]]; then
    REAL_VIDEO_CANDIDATE="$(bash ./tools/testing/prepare-debug-video.sh)"
else
    REAL_VIDEO_CANDIDATE="$REAL_VIDEO_PATH"
fi

if [[ -f "$REAL_VIDEO_CANDIDATE" ]]; then
    echo "[agent-e2e] Running real-video smoke with: $REAL_VIDEO_CANDIDATE"
    set +e
    REAL_VIDEO_PATH="$REAL_VIDEO_CANDIDATE" bash ./tools/testing/run-real-video-smoke.sh
    REAL_VIDEO_EXIT=$?
    set -e
    if [[ $REAL_VIDEO_EXIT -ne 0 ]]; then
        echo "[agent-e2e] Real-video smoke failed."
        exit $REAL_VIDEO_EXIT
    fi
else
    echo "[agent-e2e] Real-video smoke skipped (file not found): $REAL_VIDEO_CANDIDATE"
fi

exit $TEST_EXIT_CODE
