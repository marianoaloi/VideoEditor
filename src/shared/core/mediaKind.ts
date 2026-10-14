/**
 * Media kind by file extension (legacy ValidateFile used Python `mimetypes`, i.e. extensions;
 * `.3gp` always counts as video). Main may refine with magic bytes (`file-type`).
 * Owner (wave 2): svc-files. Also used by svc-hash, svc-media (Content-Type) and ui-shell (drops).
 */
import type { MediaKind } from '../domain/media';
import type { SessionKindFilter } from '../domain/session';
import { extname } from './paths';

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  // video
  '3g2': 'video/3gpp2',
  '3gp': 'video/3gpp',
  asf: 'video/x-ms-asf',
  avi: 'video/x-msvideo',
  divx: 'video/x-msvideo',
  dv: 'video/x-dv',
  f4v: 'video/mp4',
  flv: 'video/x-flv',
  m2t: 'video/mp2t',
  m2ts: 'video/mp2t',
  m2v: 'video/mpeg',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  mpe: 'video/mpeg',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  mts: 'video/mp2t',
  mxf: 'application/mxf',
  ogm: 'video/ogg',
  ogv: 'video/ogg',
  qt: 'video/quicktime',
  rm: 'application/vnd.rn-realmedia',
  rmvb: 'application/vnd.rn-realmedia-vbr',
  ts: 'video/mp2t',
  vob: 'video/mpeg',
  webm: 'video/webm',
  wmv: 'video/x-ms-wmv',
  // image
  avif: 'image/avif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  ico: 'image/x-icon',
  jfif: 'image/jpeg',
  jpe: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
  // gif
  gif: 'image/gif'
};

function extensionKey(fileName: string): string {
  return extname(fileName).slice(1).toLowerCase();
}

/** `video` | `image` | `gif` for media files, `null` for everything else. */
export function mediaKindOf(fileName: string): MediaKind | null {
  const ext = extensionKey(fileName);
  if (ext === 'gif') return 'gif';
  const mime = MIME_BY_EXTENSION[ext];
  if (mime === undefined) return null;
  return mime.startsWith('image/') ? 'image' : 'video';
}

/** Session filter semantics: `image` includes GIFs (legacy `validateFileIMG`). */
export function matchesKindFilter(kind: MediaKind, filter: SessionKindFilter): boolean {
  switch (filter) {
    case 'any':
      return true;
    case 'image':
      return kind === 'image' || kind === 'gif';
    default:
      return kind === filter;
  }
}

/** Content-Type for the `media://` protocol. */
export function mimeTypeOf(fileName: string): string {
  return MIME_BY_EXTENSION[extensionKey(fileName)] ?? 'application/octet-stream';
}
