---
id: ADR-004
title: Video playback and fallback for unsupported formats
status: Accepted
date: 2026-10-13
---

## Context

QtMultimedia couldn't play some containers, so the legacy suite had a separate VLC player, MainForceFriend. VLC isn't installed on the target machine. Chromium plays H.264/VP8/VP9/AV1 in MP4/WebM/Ogg. It doesn't play AVI, WMV, FLV, most 3GP, or some MKV codecs.

## Decision

- Use the **HTML5 `<video>`** element, served from `media://`. `playbackRate` covers 1×–10× (keys 1–5 and Ctrl+1–5).
- **Fallback:** when the probe says the container or codec isn't playable, or `<video>` raises a decode or "src not supported" error, the player switches to a **transcode stream**: `media://transcode/...?start=<sec>`. Main spawns ffmpeg to produce a **fragmented MP4** (H.264 ultrafast + AAC, `-movflags frag_keyframe+empty_moov+default_base_moof`) and pipes it as the response.
  - Seeking re-requests the stream with a new start offset.
  - The player maps `positionMs = startOffsetMs + currentTime*1000`, so the range handles and the job times keep working in the original timeline.
  - The ffmpeg process is killed when the request is aborted.
- "Open in external player" (F8 / `+`) is a configurable hook (ADR-008). There is no VLC dependency.

## Consequences

- MainForceFriend isn't ported as a separate window. The same player, RangeSlider and keys work in fallback mode.
- Fallback seeking is coarser and slower. That is acceptable for choosing ranges.
