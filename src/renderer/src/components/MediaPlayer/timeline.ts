/**
 * Timeline mapping of the player (ADR-004). In transcode mode the `<video>` element plays a stream
 * that starts at `offsetMs` of the original file, so its `currentTime` restarts at 0 after every
 * seek. Everything the app stores (range handles, job times, positions) is in ORIGINAL time.
 */

/** `positionMs = offsetMs + currentTime * 1000` (offset is 0 in direct mode). */
export function toOriginalMs(offsetMs: number, currentTimeSec: number): number {
  const t = Number.isFinite(currentTimeSec) && currentTimeSec > 0 ? currentTimeSec : 0
  return Math.max(0, Math.round(offsetMs + t * 1000))
}

/** Inverse for direct mode: where to put `video.currentTime` for an original position. */
export function toElementSec(offsetMs: number, positionMs: number): number {
  return Math.max(0, (positionMs - offsetMs) / 1000)
}

/**
 * Seek inside a transcode stream. Already-buffered target (within the current stream and not
 * before its start): set `currentTime`. Otherwise re-request the stream from `targetMs`.
 */
export type TranscodeSeek =
  | { readonly kind: 'in-stream'; readonly currentTimeSec: number }
  | { readonly kind: 'restart'; readonly offsetMs: number }

export function planTranscodeSeek(
  offsetMs: number,
  targetMs: number,
  bufferedEndSec: number
): TranscodeSeek {
  const target = Math.max(0, Math.round(targetMs))
  const relativeSec = (target - offsetMs) / 1000
  if (relativeSec >= 0 && relativeSec <= bufferedEndSec) {
    return { kind: 'in-stream', currentTimeSec: relativeSec }
  }
  return { kind: 'restart', offsetMs: target }
}
