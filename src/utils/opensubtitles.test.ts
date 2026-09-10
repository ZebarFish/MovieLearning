/**
 * Tests for the OpenSubtitles hash + language mapping utilities.
 */
import { describe, expect, it } from 'vitest';
import { computeOpenSubtitlesHash, osLangToLang } from './opensubtitles';

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
