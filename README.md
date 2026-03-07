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
- Browser video dimensions are used to avoid unnecessary scale filters.
- One-pass target-bitrate encode, optional bounded fallback only if needed.
- `ultrafast` preset.
- `zerolatency` tune.
- Progress updates throttled to reduce UI overhead.
- Audio strategy adapts: copy when likely safe, otherwise AAC re-encode.
- Auto caps fps/resolution at low bitrates.
- Short-circuits:
  - passthrough when already `.mov` and under target
  - broader remux-only attempt window before full transcode
- Runtime hardening:
  - if MT runtime crashes (for example function-signature mismatch), app auto-retries once in ST mode
  - FFmpeg core asset URLs are versioned to avoid mixed-cache core files after deploy

The app also records stage timings (`load`, `input`, `metadata`, `encode`, `output-read`, total) and exposes them via `window.__mediaMinimizerDebug.getLastRunMetrics()`.

## Local Debug / Stall Investigation

Use `?debug=1` to enable structured console traces and local-only diagnostics.

Debug helpers:

- `window.__mediaMinimizerDebug.getLastRunMetrics()`
- `window.__mediaMinimizerDebug.getLastTrace()`
- `window.__mediaMinimizerDebug.getLastFfmpegLogs()`
- `window.__mediaMinimizerDebug.getAppEvents()`
- `window.__mediaMinimizerDebug.getLastRunSummary()`
- `window.__mediaMinimizerDebug.getLiveState()`

Stall handling defaults:

- Encode watchdog: soft warning after `25s` without progress/log activity.
- Hard stall cutoff is adaptive from clip duration + runtime mode:
  - ST clamp: `120s`-`420s`
  - MT clamp: `35s`-`180s`
- MT adds a first-progress grace window before stall fallback (`55s`-`150s` based on duration).
- Encode timeout: `12 min`.
- MT stall/failure retries once in ST mode, then fails explicitly.

Optional URL overrides for local testing:

- `?debug=1&stallMs=2500`
- `?debug=1&encodeTimeoutMs=20000`
- `?debug=1&ffmpegMock=no-progress-complete|stall|mt-stall-fallback|filter-graph-retry`

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
npm run test:e2e:real-video
npm run test:e2e:real-video:mt
npm run bench:video
```

`test:e2e:real-video` uses:

- `REAL_VIDEO_PATH` (optional absolute path)
- default: `tests/e2e/fixtures/local-debug-video.mov`
- if local debug video is missing, helper script attempts to copy from:
  - `~/Desktop/Screen Recording 2025-12-11 at 3.04.37 PM.mov`
  - `~/Downloads/Screen Recording 2025-12-11 at 3.04.37 PM.mov`
- starts a local static server automatically for the smoke run
- `test:e2e:real-video:mt` additionally asserts that MT was attempted

## Agent E2E Workflow

Use this deterministic workflow after every code change:

```bash
cd /Users/mkamar/Non_Work/Projects/media-minimizer
npm run test:e2e:agent
```

Useful variants:

```bash
# rerun only previously failing tests
npm run test:e2e:agent:last-failed

# run one focused test from CLI arguments
npm run test:e2e:agent -- --grep "video flow converts to mov"
```

What it does:

- runs tests in single-worker mode for reproducibility
- retains trace, screenshot, and video on failures
- writes JSON report to `test-results/agent-results.json`
- prints failed test summary + artifact paths
- generates HTML report (`npm run test:e2e:report`)
- runs real-video smoke automatically when `REAL_VIDEO_PATH` (or default Downloads path) exists

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

## Custom FFmpeg Core Modifications

This project uses custom `ffmpeg.wasm` core profiles instead of pulling remote defaults at runtime.

Implemented customizations:

- Local vendored runtime assets under `vendor/ffmpeg` for privacy and deterministic versions.
- Three runtime profiles:
  - `st-lite` (smaller single-thread core)
  - `st-large` (single-thread core for larger files)
  - `mt-fast` (multi-thread core when isolation is available)
- Pruned codec/container scope for this app's use case (video minimize + image handling paths).
- Explicit filter set enabled for real-world MOV compatibility:
  - `null,setpts,scale,fps,format,aresample,anull`
- Asset URL cache-busting/version pinning from app code to avoid mixed old/new core artifacts after deploy.
- Runtime fallback policy in app:
  - MT failure/stall -> auto retry in ST once.

When changing any profile flags, rebuild and sync all cores so `ffmpeg-core.js` and `ffmpeg-core.wasm` remain matched per profile.
