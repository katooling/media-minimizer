#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT_DIR/tests/e2e/fixtures/generated"
DOC_PATH="$ROOT_DIR/tests/e2e/fixtures/GENERATED_FIXTURES.md"

require_tool() {
    local tool="$1"
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "[fixtures] Required tool not found: $tool" >&2
        exit 1
    fi
}

make_h264_mp4() {
    local out="$1"
    local size="$2"
    local rate="$3"
    local duration="$4"
    local audio="$5"
    shift 5
    local args=(
        -y
        -f lavfi -i "testsrc2=size=${size}:rate=${rate}:duration=${duration}"
    )
    if [[ "$audio" == "aac" ]]; then
        args+=(-f lavfi -i "sine=frequency=880:sample_rate=44100:duration=${duration}")
    fi
    args+=(
        -map 0:v:0
    )
    if [[ "$audio" == "aac" ]]; then
        args+=(-map 1:a:0)
    fi
    args+=(
        -c:v libx264
        -preset ultrafast
        -crf 28
        -pix_fmt yuv420p
    )
    if [[ "$audio" == "aac" ]]; then
        args+=(-c:a aac -b:a 64k)
    fi
    if (($# > 0)); then
        args+=("$@")
    fi
    args+=(-movflags +faststart "$out")
    ffmpeg "${args[@]}" >/dev/null 2>&1
}

make_h264_mov() {
    local out="$1"
    local size="$2"
    local rate="$3"
    local duration="$4"
    local audio="$5"
    shift 5
    make_h264_mp4 "$out" "$size" "$rate" "$duration" "$audio" "$@" -f mov
}

require_tool ffmpeg
require_tool ffprobe

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*

ffmpeg -y \
    -i "$ROOT_DIR/tests/e2e/fixtures/sample.mp4" \
    -f lavfi -i "sine=frequency=880:sample_rate=44100:duration=1.0" \
    -map 0:v:0 -map 1:a:0 \
    -c:v copy -c:a aac -b:a 64k \
    -shortest -movflags +faststart "$OUT_DIR/tiny-h264-aac.mp4" >/dev/null 2>&1
make_h264_mp4 "$OUT_DIR/tiny-h264-no-audio.mp4" "320x180" 24 1.2 none
ffmpeg -y \
    -i "$ROOT_DIR/tests/e2e/fixtures/sample.mp4" \
    -f lavfi -i "sine=frequency=880:sample_rate=44100:duration=1.0" \
    -map 0:v:0 -map 1:a:0 \
    -c:v copy -c:a aac -b:a 64k \
    -shortest -f mov "$OUT_DIR/tiny-h264-aac.mov" >/dev/null 2>&1
make_h264_mov "$OUT_DIR/under-target.mov" "160x90" 12 0.6 none
make_h264_mp4 "$OUT_DIR/near-target-remux.mp4" "160x90" 12 0.6 none
ffmpeg -y \
    -f lavfi -i "testsrc=size=320x180:rate=24:duration=1.2" \
    -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=1.2" \
    -map 0:v:0 -map 1:a:0 \
    -c:v libvpx -deadline realtime -cpu-used 8 -b:v 256k \
    -c:a libopus -b:a 48k \
    "$OUT_DIR/webm-vp8-opus.webm" >/dev/null 2>&1
make_h264_mp4 "$OUT_DIR/portrait-1080x1920.mp4" "1080x1920" 12 0.6 none
make_h264_mp4 "$OUT_DIR/square-720.mp4" "720x720" 12 0.7 none
ffmpeg -y \
    -f lavfi -i "testsrc=size=321x241:rate=12:duration=0.7" \
    -map 0:v:0 -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv444p \
    -movflags +faststart "$OUT_DIR/odd-dimensions-321x241.mp4" >/dev/null 2>&1
make_h264_mp4 "$OUT_DIR/fps-60.mp4" "320x180" 60 1.0 none
make_h264_mp4 "$OUT_DIR/rotated-metadata.mp4" "320x180" 24 0.8 none -metadata:s:v:0 rotate=90
make_h264_mov "$OUT_DIR/silent-screen-recording.mov" "640x360" 15 1.0 none
ffmpeg -y \
    -f lavfi -i "testsrc2=size=320x180:rate=24:duration=1.0" \
    -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=1.0" \
    -map 0:v:0 -map 1:a:0 \
    -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p \
    -c:a pcm_s16le -f mov "$OUT_DIR/pcm-audio.mov" >/dev/null 2>&1
printf "not a valid mp4 fixture\n" > "$OUT_DIR/corrupt-video.mp4"
: > "$OUT_DIR/empty-file.mp4"

ffmpeg -y \
    -f lavfi -i "color=color=red@0.35:size=96x96:duration=0.1" \
    -frames:v 1 -pix_fmt rgba "$OUT_DIR/alpha.png" >/dev/null 2>&1
printf "not a valid image fixture\n" > "$OUT_DIR/corrupt-image.png"

{
    echo "# Generated Fixtures"
    echo
    echo "Generated with \`tools/testing/generate-media-fixtures.sh\`."
    echo
    echo "## Files"
    echo
    for file in "$OUT_DIR"/*; do
        name="$(basename "$file")"
        size="$(wc -c < "$file" | tr -d ' ')"
        sha="$(shasum -a 256 "$file" | awk '{print $1}')"
        echo "- \`generated/${name}\`"
        echo "  - Bytes: \`${size}\`"
        echo "  - SHA256: \`${sha}\`"
    done
} > "$DOC_PATH"

echo "[fixtures] wrote: $OUT_DIR"
echo "[fixtures] wrote: $DOC_PATH"
