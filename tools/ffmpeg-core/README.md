# Custom FFmpeg Core Pipeline

This directory contains the in-repo build pipeline for custom browser FFmpeg cores used by Media Minimizer.

## Profiles

- `st-lite`: single-thread, minimal profile for smaller files.
- `st-large`: single-thread, broader compatibility profile.
- `mt-fast`: multi-thread profile for cross-origin isolated hosts.

Profile flags are stored in `profiles/*.flags`.

## Build

Requires Docker Buildx.

```bash
cd /Users/mkamar/Non_Work/Projects/media-minimizer
./tools/ffmpeg-core/build-core.sh st-lite
./tools/ffmpeg-core/build-core.sh st-large
./tools/ffmpeg-core/build-core.sh mt-fast
```

This uses pinned source:

- `ffmpeg.wasm` commit: `f876f907c7e9b9bf51d4ed0b913a855a63ae63fc`

## Sync to runtime vendor assets

```bash
cd /Users/mkamar/Non_Work/Projects/media-minimizer
./tools/ffmpeg-core/sync-vendor.sh st-lite
./tools/ffmpeg-core/sync-vendor.sh st-large
./tools/ffmpeg-core/sync-vendor.sh mt-fast
```

`sync-vendor.sh` updates:

- `vendor/ffmpeg/core-st-lite/*`
- `vendor/ffmpeg/core-st-large/*`
- `vendor/ffmpeg/core-mt-fast/*`
- `vendor/ffmpeg/CHECKSUMS.sha256`

## Notes

- All runtime assets remain local under `vendor/ffmpeg`.
- Multi-thread mode still requires cross-origin isolation (`COOP` + `COEP`), either via response headers or `coi-serviceworker` fallback.
