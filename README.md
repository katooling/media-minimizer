# Media Minimizer

Client-only static app to shrink media files before sharing or uploading.

Equivalent intent of:

```bash
ffmpeg -i "<your-file>" output.mov
```

with a minimal UI:

1. Drop/select file
2. Click **Minimize**
3. Click **Download**

## What it does

- Video input (`video/*`) -> outputs `.mov` using local `ffmpeg.wasm`.
- Image input (`image/*`) -> outputs optimized image using browser canvas.
- Unsupported file types are rejected inline.
- No backend and no upload: processing stays in-browser.
- FFmpeg assets are vendored locally under `vendor/ffmpeg`.

## Runtime Modes

Engine badge values:

- `Engine: Ready (ST-lite)`
- `Engine: Ready (ST-large)`
- `Engine: Ready (MT-sw)`
- `Engine: Ready (MT-header)`

Selection policy:

- If isolated: prefer `MT` (`mt-fast`) with `ST` fallback.
- If not isolated: choose `ST-large` for bigger files, `ST-lite` for smaller files.

## Speed Strategy

Video path uses fast defaults:

- Browser metadata duration first (`ffprobe` only fallback).
- One-pass target-bitrate encode, optional bounded fallback only if needed.
- `ultrafast` preset.
- Progress updates throttled to reduce UI overhead.
- Audio strategy adapts: copy when likely safe, otherwise AAC re-encode.
- Auto caps fps/resolution at low bitrates.
- Short-circuits:
  - passthrough when already `.mov` and under target
  - remux-only attempt near target before full transcode

The app also records stage timings (`load`, `input`, `metadata`, `encode`, `output-read`, total) and exposes them via `window.__mediaMinimizerDebug.getLastRunMetrics()`.

## Cross-Origin Isolation on GitHub Pages

`coi-serviceworker.js` is included locally and auto-registered to attempt cross-origin isolation on hosts without configurable response headers.

- Baseline always works: `github.io` + `ST`.
- If service worker isolation succeeds, `MT-sw` is used.
- If your host sets real headers (`COOP` + `COEP`), `MT-header` is used.

For guaranteed MT on public hosting, use a custom domain with an edge proxy (for example Cloudflare) that injects:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`)

## Quick start

```bash
cd /Users/mkamar/Non_Work/Projects/media-minimizer
python3 -m http.server 8000
```

Open: `http://127.0.0.1:8000`

## Test + Benchmark

```bash
cd /Users/mkamar/Non_Work/Projects/media-minimizer
npm install
npm run test:e2e
npm run bench:video
```

## Custom Core Pipeline

Build/sync scripts are in `tools/ffmpeg-core`:

```bash
npm run core:build:st-lite
npm run core:build:st-large
npm run core:build:mt-fast
npm run core:sync:st-lite
npm run core:sync:st-large
npm run core:sync:mt-fast
```

Checksums are tracked in `vendor/ffmpeg/CHECKSUMS.sha256`.
