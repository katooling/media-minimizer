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
- For video, the app runs a balanced encode profile and retries with stronger compression if still above target.
- First video run is slower because ffmpeg core assets are loaded.
- Internet is required to fetch ffmpeg WASM assets from CDN unless you vendor them locally.
