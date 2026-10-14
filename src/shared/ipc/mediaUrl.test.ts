import { describe, expect, it } from 'vitest';
import { parseMediaUrl, toMediaUrl, toTranscodeUrl } from './mediaUrl';

const PATHS = [
  'C:\\Users\\maria\\Videos\\clip.mp4',
  'C:\\Users\\maria\\My Videos\\a b  c.mp4',
  'D:/mixed\\separators/file.mkv',
  'C:\\x\\#1 %20 50% ?query=1&b=2 #frag.mp4',
  "C:\\odd\\it's (copy) [1] {2} !*~+,;=@$.avi",
  'C:\\unicode\\vídeo çãõ\\日本語\\ファイル 😀.mp4',
  'C:\\dots\\..\\.\\still one segment.mp4',
  '\\\\server\\share\\dir\\a.mp4',
  '\\\\?\\C:\\very\\long\\path.mp4',
  '/home/maloi/Videos/tutu/a.mp4',
  '/tmp/a#b?c%d&e=f/g h.webm',
  '/tmp/%2F%5C already-encoded %41.mp4',
  '/back\\slash/in posix name.mp4'
];

/**
 * Chromium treats a standard scheme like http: lower-cased host, `\` → `/`, dot segments resolved.
 * Re-parsing the URL as http reproduces that canonicalisation in Node.
 */
function canonicaliseAsStandardScheme(mediaUrl: string): string {
  const asHttp = new URL(mediaUrl.replace(/^media:/, 'http:'));
  return `media:${asHttp.href.slice('http:'.length)}`;
}

describe('toMediaUrl / parseMediaUrl', () => {
  it.each(PATHS)('round-trips %s', (path) => {
    const url = toMediaUrl(path);
    expect(parseMediaUrl(url)).toEqual({ kind: 'file', path, version: null });
    expect(parseMediaUrl(canonicaliseAsStandardScheme(url))).toEqual({ kind: 'file', path, version: null });
  });

  it('encodes the whole path into one segment with no raw separators or delimiters', () => {
    const url = toMediaUrl('C:\\a b\\c#d?e.mp4');
    expect(url.startsWith('media://local/')).toBe(true);
    const encoded = url.slice('media://local/'.length);
    expect(encoded).not.toMatch(/[\\/#? !'()*]/);
  });

  it('accepts an upper-case host, as Chromium would lower-case it anyway', () => {
    const url = toMediaUrl('/tmp/a.mp4').replace('//local/', '//LOCAL/');
    expect(parseMediaUrl(url)).toEqual({ kind: 'file', path: '/tmp/a.mp4', version: null });
  });

  it('keeps the cache-busting version', () => {
    const url = toMediaUrl('C:\\img\\a.jpg', { version: 1712345678901.5 });
    expect(parseMediaUrl(url)).toEqual({ kind: 'file', path: 'C:\\img\\a.jpg', version: '1712345678901.5' });
    expect(parseMediaUrl(canonicaliseAsStandardScheme(url))).toMatchObject({ version: '1712345678901.5' });
  });

  it('refuses relative paths when building', () => {
    expect(() => toMediaUrl('relative\\a.mp4')).toThrow(TypeError);
    expect(() => toMediaUrl('')).toThrow(TypeError);
  });
});

describe('toTranscodeUrl', () => {
  it.each(PATHS)('round-trips %s with a start offset', (path) => {
    const url = toTranscodeUrl(path, 12.3456);
    const expected = { kind: 'transcode', path, startSec: 12.346 };
    expect(parseMediaUrl(url)).toEqual(expected);
    expect(parseMediaUrl(canonicaliseAsStandardScheme(url))).toEqual(expected);
  });

  it('defaults a missing start to 0', () => {
    const url = toTranscodeUrl('/tmp/a.avi', 0).replace('?start=0', '');
    expect(parseMediaUrl(url)).toEqual({ kind: 'transcode', path: '/tmp/a.avi', startSec: 0 });
  });

  it('rejects negative or non-finite starts', () => {
    expect(() => toTranscodeUrl('/tmp/a.avi', -1)).toThrow(RangeError);
    expect(() => toTranscodeUrl('/tmp/a.avi', Number.NaN)).toThrow(RangeError);
    expect(() => toTranscodeUrl('/tmp/a.avi', Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('parseMediaUrl rejects', () => {
  const good = toMediaUrl('/tmp/a.mp4');
  it.each([
    ['another scheme', good.replace(/^media:/, 'http:')],
    ['file scheme', 'file:///tmp/a.mp4'],
    ['an unknown host', good.replace('//local/', '//other/')],
    ['an empty path', 'media://local/'],
    ['a relative path', `media://local/${encodeURIComponent('relative/a.mp4')}`],
    ['a NUL byte', `media://local/${encodeURIComponent('/tmp/a\0.mp4')}`],
    ['broken percent-encoding', 'media://local/%E0%A4%A'],
    ['a negative start', `media://transcode/${encodeURIComponent('/tmp/a.mp4')}?start=-5`],
    ['a non-numeric start', `media://transcode/${encodeURIComponent('/tmp/a.mp4')}?start=abc`],
    ['an empty start', `media://transcode/${encodeURIComponent('/tmp/a.mp4')}?start=`],
    ['garbage', 'not a url']
  ])('%s', (_label, url) => {
    expect(parseMediaUrl(url)).toBeNull();
  });
});
