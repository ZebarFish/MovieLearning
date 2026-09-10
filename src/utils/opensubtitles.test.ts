/**
 * Tests for the OpenSubtitles hash + language mapping utilities.
 */
import { describe, expect, it } from 'vitest';
import {
  computeOpenSubtitlesHash,
  guessQueryFromFilename,
  httpHint,
  osLangToLang,
} from './opensubtitles';

/** Build a File filled with a deterministic byte pattern. */
function makeFile(size: number): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 251;
  return new File([bytes], 'sample.mkv');
}

/** Independent reference implementation (mirrors the documented algorithm). */
function referenceHash(size: number, bytes: Uint8Array): string {
  let sum = BigInt(size);
  const add = (start: number, end: number): void => {
    const view = new DataView(bytes.buffer, start, end - start);
    for (let off = 0; off + 8 <= view.byteLength; off += 8) {
      sum += view.getBigUint64(off, true);
      sum &= 0xffffffffffffffffn;
    }
  };
  add(0, Math.min(65536, size));
  if (size > 65536) add(size - 65536, size);
  return sum.toString();
}

describe('computeOpenSubtitlesHash', () => {
  it('matches the reference algorithm for a small file', async () => {
    const size = 4096;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 251;
    const file = makeFile(size);
    const hash = await computeOpenSubtitlesHash(file);
    expect(hash).toBe(referenceHash(size, bytes));
  });

  it('sums both head and tail chunks for a large file', async () => {
    const size = 196608; // exactly 3 × 64 KiB
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 251;
    const hash = await computeOpenSubtitlesHash(makeFile(size));
    expect(hash).toBe(referenceHash(size, bytes));
    // Sanity: hash differs from file size alone (content contributed).
    expect(hash).not.toBe(String(size));
  });

  it('handles a file that is not a multiple of 8 bytes', async () => {
    const size = 65537;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 251;
    const hash = await computeOpenSubtitlesHash(makeFile(size));
    expect(hash).toBe(referenceHash(size, bytes));
  });
});

describe('guessQueryFromFilename', () => {
  it('extracts title and season/episode from a TV release name', () => {
    const g = guessQueryFromFilename(
      'Friends.S01E02.1080p.WEB-DL.x264-GROUP.mkv',
    );
    expect(g.season).toBe(1);
    expect(g.episode).toBe(2);
    expect(g.query).not.toContain('1080p');
    expect(g.query).not.toContain('x264');
    expect(g.query.toLowerCase()).toContain('friends');
  });

  it('strips release tags from movie filenames', () => {
    const g = guessQueryFromFilename('Inception.2010.720p.BluRay.x265.mkv');
    expect(g.season).toBeNull();
    expect(g.episode).toBeNull();
    expect(g.query.toLowerCase()).toContain('inception');
    expect(g.query).not.toMatch(/720p|bluray|x265/i);
  });

  it('collapses dot separators into spaces', () => {
    const g = guessQueryFromFilename('The.Office.US.S02E05.720p.mkv');
    expect(g.query).not.toContain('.');
    expect(g.query.toLowerCase()).toContain('the office');
  });
});

describe('httpHint', () => {
  it('explains known status codes', () => {
    expect(httpHint(401)).toContain('Key');
    expect(httpHint(403)).toContain('Key');
    expect(httpHint(404)).toContain('不存在');
    expect(httpHint(406)).toContain('额度');
    expect(httpHint(429)).toContain('频繁');
    expect(httpHint(503)).toContain('服务器');
  });

  it('returns empty string for unknown codes', () => {
    expect(httpHint(418)).toBe('');
  });
});

describe('osLangToLang', () => {
  it('maps Chinese variants to zh', () => {
    expect(osLangToLang('zh-cn')).toBe('zh');
    expect(osLangToLang('zh')).toBe('zh');
    expect(osLangToLang('zht')).toBe('zh');
  });

  it('maps English to en', () => {
    expect(osLangToLang('en')).toBe('en');
    expect(osLangToLang('english')).toBe('en');
  });

  it('maps unknown languages to other', () => {
    expect(osLangToLang('ja')).toBe('other');
    expect(osLangToLang('fr')).toBe('other');
  });
});
