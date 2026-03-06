# Media Minimizer

Client-only static app to shrink media files before sharing or uploading.

Equivalent intent of:

```bash
ffmpeg -i "<your-file>" output.mov
```

but with a simple browser UI:

1. Drop/select file
2. Click **Minimize**
3. Click **Download**

## What it does

- Video input (`video/*`) -> outputs `.mov` using `ffmpeg.wasm` in browser.
- Image input (`image/*`) -> outputs optimized image using browser canvas.
- Unsupported file types are rejected inline.
- No backend and no upload: processing is local in your browser tab.
- FFmpeg assets are vendored locally under `vendor/ffmpeg` (no CDN dependency).
- Video minimizes in fast mode by default: one-pass target-bitrate encode plus one fallback attempt only if needed.

## Quick start

Serve as static files:

```bash
cd /Users/mkamar/Non_Work/Projects/media-minimizer
python3 -m http.server 8000
```

Open: `http://127.0.0.1:8000`

## E2E smoke test

```bash
cd /Users/mkamar/Non_Work/Projects/media-minimizer
npm install
npm run test:e2e
```

This test covers: file select -> `Minimize` enabled -> processing -> `Download` enabled.

## Notes

- `Max size (MB)` defaults to `10`.
- For video, the app computes a target bitrate from file duration and max-size target.
- The app runs one encode attempt first, then an optional fallback attempt when output is still significantly above target.
- FFmpeg engine is preloaded at startup. After preload completes, `Minimize` runs without new network requests.
- Engine badge shows runtime mode:
  - `Engine: Ready (ST)` for single-thread core.
  - `Engine: Ready (MT)` for multi-thread core.
- Multi-thread (`MT`) requires cross-origin isolation headers on your host:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`)
- Without those headers, app falls back automatically to `ST`.
