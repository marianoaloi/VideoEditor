---
id: ADR-005
title: ffmpeg integration and job engine
status: Accepted
date: 2026-10-13
---

## Context

The legacy suite had two ffmpeg engines: `FFMPEGProcess` (newer) and `ManiopulateVideoFFMPEG` (older; DialogResume and the batch used it). Both cut or concat, cap the output at 640 px and 500 kbit/s, apply crop/transpose/eq, and fall back from GPU to CPU and between encoders.

ffmpeg 8 is on PATH on the target machine, with an NVIDIA RTX 3050 for `h264_nvenc`.

## Decision

- **Binaries:** the ffmpeg/ffprobe paths come from Settings. If they aren't set, the app looks them up on PATH. No ffmpeg binaries are bundled in build 1.
- **Probe:** `ffprobe -v error -print_format json -show_format -show_streams` → a zod-validated `MediaInfo` (duration ms, width/height, fps, bitrate, video/audio codecs, rotation, hasAudio, container).
- **Args builder:** a **pure function** in `src/shared/core/ffmpegArgs.ts`, `(job, mediaInfo, options) → string[][]`, with one argv per ffmpeg step. It is unit-tested against the legacy commands documented in `.swarm/research/ffmpeg-jobs.md`. It ports one coherent engine: `FFMPEGProcess` semantics and output naming `<video>.<i>.mp4`. It also keeps the error-tolerant fallbacks of the older engine that the research marks as needed.
- **Runner:** in main.
  - Encoder chain from Settings. The default is `h264_nvenc → libx264`; the other legacy encoders are optional entries.
  - The GPU attempt uses hwaccel; on failure it retries on CPU.
  - Copy-then-re-encode fallback for corrupt inputs.
  - Outputs under 1000 bytes count as failures.
  - Progress comes from `-progress pipe:1 -nostats`.
  - Cancellation goes through an `AbortSignal`, which kills the process tree.
  - Per-job logs.
- **Queue:** in main, **concurrency 2**. `JobEvent`s (queued / started / progress / log / done / error) are pushed to the renderer. The job definitions are the `CUSTOM/*.json` files, so they persist on disk.
- **Legacy bugs fixed:**
  - eq `brightness` is mapped into ffmpeg's −1..1 range, not `bright*100`;
  - the transpose sign/value is checked correctly;
  - orphan or empty JSON files are reported and moved aside, not silently deleted.

## Consequences

- One engine instead of two. Behaviour differences from the older engine are recorded in the research notes and the tests.
