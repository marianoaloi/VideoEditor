/**
 * Can Chromium play this file directly (ADR-004)? When not, the player starts on the transcode
 * stream at once instead of waiting for a decode error. A wrong "yes" is still caught by the
 * `<video>` error event, which switches to the fallback; a wrong "no" only costs CPU.
 *
 * Rules: container family × video codec × audio codec × pixel format. Containers come from
 * ffprobe `format_name` (`mov,mp4,m4a,3gp,3g2,mj2`, `matroska,webm`, `ogg`, `avi`, ...).
 */
import type { MediaInfo } from '../domain/media'

const MP4_FAMILY_VIDEO: ReadonlySet<string> = new Set(['h264', 'vp9', 'av1'])
/** Matroska and WebM (same ffprobe format name). */
const MKV_VIDEO: ReadonlySet<string> = new Set(['h264', 'vp8', 'vp9', 'av1'])
const OGG_VIDEO: ReadonlySet<string> = new Set(['theora', 'vp8'])

const MP4_AUDIO: ReadonlySet<string> = new Set(['aac', 'mp3', 'opus', 'flac'])
const MKV_AUDIO: ReadonlySet<string> = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const OGG_AUDIO: ReadonlySet<string> = new Set(['vorbis', 'opus', 'flac'])

/** 8-bit 4:2:0 is what Chromium's software H.264/VP9/AV1 paths accept everywhere. */
const SAFE_PIX_FMTS: ReadonlySet<string> = new Set(['yuv420p', 'yuvj420p'])

export type PlaybackVerdict =
  { readonly direct: true } | { readonly direct: false; readonly reason: string }

function formats(container: string): ReadonlySet<string> {
  return new Set(container.split(',').map((name) => name.trim().toLowerCase()))
}

export function checkPlayback(info: MediaInfo): PlaybackVerdict {
  if (!info.hasVideo) return { direct: false, reason: 'no video stream' }
  const names = formats(info.container)
  const video = (info.videoCodec ?? '').toLowerCase()
  const audio = (info.audioCodec ?? '').toLowerCase()

  let videoOk: ReadonlySet<string>
  let audioOk: ReadonlySet<string>
  if (names.has('mp4') || names.has('mov')) {
    // `mov,mp4,m4a,3gp,3g2,mj2` also covers 3GP files, which mostly carry H.263 / AMR: the codec
    // check below rejects those.
    videoOk = MP4_FAMILY_VIDEO
    audioOk = MP4_AUDIO
  } else if (names.has('matroska') || names.has('webm')) {
    // ffprobe reports `matroska,webm` for both .mkv and .webm, so they share one rule.
    videoOk = MKV_VIDEO
    audioOk = MKV_AUDIO
  } else if (names.has('ogg')) {
    videoOk = OGG_VIDEO
    audioOk = OGG_AUDIO
  } else {
    return { direct: false, reason: `container "${info.container}"` }
  }

  if (!videoOk.has(video)) return { direct: false, reason: `video codec "${video || 'unknown'}"` }
  if (info.hasAudio && !audioOk.has(audio)) {
    return { direct: false, reason: `audio codec "${audio || 'unknown'}"` }
  }
  if (video === 'h264' && info.pixFmt !== null && !SAFE_PIX_FMTS.has(info.pixFmt)) {
    return { direct: false, reason: `pixel format "${info.pixFmt}"` }
  }
  return { direct: true }
}

export function isDirectlyPlayable(info: MediaInfo): boolean {
  return checkPlayback(info).direct
}
