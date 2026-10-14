import { describe, expect, it } from 'vitest';
import {
  basename,
  dirname,
  extname,
  isAbsolutePathLike,
  isSafePathSegment,
  splitSegments,
  stripExtension
} from './paths';

describe('isAbsolutePathLike', () => {
  it.each([
    ['C:\\Users\\a.mp4', true],
    ['c:/Users/a.mp4', true],
    ['\\\\server\\share\\a.mp4', true],
    ['//server/share/a.mp4', true],
    ['\\\\?\\C:\\long\\a.mp4', true],
    ['/home/a.mp4', true],
    ['relative\\a.mp4', false],
    ['C:relative.mp4', false],
    ['\\\\server', false],
    ['', false],
    ['/tmp/a\0b', false]
  ])('%s → %s', (input, expected) => {
    expect(isAbsolutePathLike(input)).toBe(expected);
  });
});

describe('basename / dirname / extname', () => {
  it('handles both separators', () => {
    expect(basename('C:\\a\\b/c.mp4')).toBe('c.mp4');
    expect(basename('/a/b/')).toBe('b');
    expect(dirname('C:\\a\\b.mp4')).toBe('C:\\a');
    expect(dirname('C:\\b.mp4')).toBe('C:\\');
    expect(dirname('/b.mp4')).toBe('/');
    expect(dirname('b.mp4')).toBe('');
    expect(splitSegments('C:\\a//b\\c')).toEqual(['C:', 'a', 'b', 'c']);
  });

  it('extracts extensions like node:path', () => {
    expect(extname('C:\\v\\clip.final.MP4')).toBe('.MP4');
    expect(extname('/x/.bashrc')).toBe('');
    expect(extname('/x/noext')).toBe('');
    expect(stripExtension('clip.final.mp4')).toBe('clip.final');
    expect(stripExtension('noext')).toBe('noext');
  });
});

describe('isSafePathSegment', () => {
  it.each(['L', 'R', 'CUSTOM', 'md5Purge', 'bkp', 'ruimFolder', 'my folder', 'ação'])(
    'accepts %s',
    (name) => expect(isSafePathSegment(name)).toBe(true)
  );
  it.each(['', '.', '..', 'a/b', 'a\\b', 'a:b', 'a?', 'end.', 'end ', 'CON', 'nul.txt', 'COM1', 'x'.repeat(256)])(
    'rejects %j',
    (name) => expect(isSafePathSegment(name)).toBe(false)
  );
});
