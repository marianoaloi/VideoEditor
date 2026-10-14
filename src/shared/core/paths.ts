/**
 * Separator-agnostic path helpers for code in `src/shared` (which may not import `node:path`).
 * They accept both `\` and `/`, never touch the file system and never resolve `..`.
 * Main-process code should keep using `node:path`; these exist for the renderer and shared logic.
 *
 * Owner: frozen (lead). Additive changes only.
 */

const TRAILING_SEPARATORS = /[\\/]+$/;
const DRIVE_ROOT = /^[A-Za-z]:$/;

/** True for `C:\x`, `C:/x`, UNC `\\server\share\x` (also `\\?\C:\x`) and POSIX `/x`. */
export function isAbsolutePathLike(p: string): boolean {
  if (p.length === 0 || p.includes('\0')) return false;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  if (/^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(p)) return true;
  return p.startsWith('/');
}

/** Splits on either separator and drops empty segments. */
export function splitSegments(p: string): string[] {
  return p.split(/[\\/]+/).filter((segment) => segment.length > 0);
}

function lastSeparatorIndex(p: string): number {
  return Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
}

/** Last segment: `C:\a\b.mp4` → `b.mp4`. Trailing separators are ignored. */
export function basename(p: string): string {
  const trimmed = p.replace(TRAILING_SEPARATORS, '');
  const index = lastSeparatorIndex(trimmed);
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

/** Parent: `C:\a\b.mp4` → `C:\a`, `C:\b.mp4` → `C:\`, `/b.mp4` → `/`, `b.mp4` → `''`. */
export function dirname(p: string): string {
  const trimmed = p.replace(TRAILING_SEPARATORS, '');
  const index = lastSeparatorIndex(trimmed);
  if (index < 0) return '';
  if (index === 0) return trimmed.charAt(0);
  const head = trimmed.slice(0, index);
  return DRIVE_ROOT.test(head) ? head + trimmed.charAt(index) : head;
}

/** Extension with its dot, original case: `a.MP4` → `.MP4`; `a` → `''`; `.bashrc` → `''`. */
export function extname(p: string): string {
  const name = basename(p);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

/** `clip.final.mp4` → `clip.final`. */
export function stripExtension(name: string): string {
  const ext = extname(name);
  return ext.length > 0 ? name.slice(0, name.length - ext.length) : name;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const FORBIDDEN_SEGMENT_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;

/**
 * A single folder or file name that is valid on Windows and POSIX: no separators, no
 * `:*?"<>|` or control characters, not `.`/`..`, no trailing dot or space, not a Windows
 * device name (`CON`, `NUL`, `COM1`, ...), at most 255 characters.
 */
export function isSafePathSegment(segment: string): boolean {
  if (segment.length === 0 || segment.length > 255) return false;
  if (segment === '.' || segment === '..') return false;
  if (FORBIDDEN_SEGMENT_CHARS.test(segment)) return false;
  if (/[. ]$/.test(segment)) return false;
  return !WINDOWS_RESERVED.test(segment);
}
