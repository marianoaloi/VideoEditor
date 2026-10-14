/**
 * `media://` URLs for `<video>`/`<img>` (ADR-003, ADR-004). Shared by the renderer (build) and
 * the protocol handler in main (parse).
 *
 * `media` is registered as a STANDARD scheme, so Chromium parses these like http URLs: the host is
 * lower-cased, `\` becomes `/`, dot segments collapse, `?`/`#` split the URL. To survive that, the
 * whole absolute path is encoded into ONE path segment with strict RFC 3986 percent-encoding:
 *
 *   media://local/<enc(path)>[?v=<version>]          a file (version only busts caches)
 *   media://transcode/<enc(path)>?start=<seconds>     ADR-004 fragmented-MP4 stream from `start`
 *
 * `parseMediaUrl` only decodes. The protocol handler must still `path.resolve` the result and check
 * it against the allowlist before touching the disk.
 *
 * Owner (wave 2): svc-media.
 */
import { isAbsolutePathLike } from '../core/paths';

export const MEDIA_SCHEME = 'media';
export const MEDIA_HOST_FILE = 'local';
export const MEDIA_HOST_TRANSCODE = 'transcode';

export type ParsedMediaUrl =
  | { readonly kind: 'file'; readonly path: string; readonly version: string | null }
  | { readonly kind: 'transcode'; readonly path: string; readonly startSec: number };

/** encodeURIComponent plus `!'()*`, so every character outside `A-Za-z0-9-_.~` is escaped. */
function encodeStrict(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function assertAbsolute(absPath: string): void {
  if (!isAbsolutePathLike(absPath)) {
    throw new TypeError(`media:// URLs need an absolute path, got "${absPath}"`);
  }
}

export interface MediaUrlOptions {
  /** Appended as `?v=` to defeat the image cache after an in-place edit (e.g. the new mtime). */
  readonly version?: string | number;
}

export function toMediaUrl(absPath: string, options: MediaUrlOptions = {}): string {
  assertAbsolute(absPath);
  const base = `${MEDIA_SCHEME}://${MEDIA_HOST_FILE}/${encodeStrict(absPath)}`;
  return options.version === undefined ? base : `${base}?v=${encodeStrict(String(options.version))}`;
}

/** `startSec` ≥ 0; fractional seconds are kept (millisecond precision). */
export function toTranscodeUrl(absPath: string, startSec: number): string {
  assertAbsolute(absPath);
  if (!Number.isFinite(startSec) || startSec < 0) {
    throw new RangeError(`Transcode start must be a finite number ≥ 0, got ${startSec}`);
  }
  const start = Math.round(startSec * 1000) / 1000;
  return `${MEDIA_SCHEME}://${MEDIA_HOST_TRANSCODE}/${encodeStrict(absPath)}?start=${start}`;
}

/** Returns `null` for anything that is not a well-formed media URL with an absolute path. */
export function parseMediaUrl(url: string): ParsedMediaUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null;
  const encoded = parsed.pathname.replace(/^\/+/, '');
  if (encoded.length === 0) return null;
  let path: string;
  try {
    path = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (!isAbsolutePathLike(path)) return null;

  const host = parsed.hostname.toLowerCase();
  if (host === MEDIA_HOST_FILE) {
    return { kind: 'file', path, version: parsed.searchParams.get('v') };
  }
  if (host === MEDIA_HOST_TRANSCODE) {
    const raw = parsed.searchParams.get('start') ?? '0';
    const startSec = raw.trim() === '' ? Number.NaN : Number(raw);
    if (!Number.isFinite(startSec) || startSec < 0) return null;
    return { kind: 'transcode', path, startSec };
  }
  return null;
}
