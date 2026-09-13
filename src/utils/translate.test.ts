/**
 * Tests for sentence translation (utils/translate.ts). fetch is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTranslationCache, hasChinese, translateToChinese } from './translate';

const fetchMock = vi.fn();

beforeEach(() => {
  clearTranslationCache();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function respond(payload: unknown, ok = true): void {
  fetchMock.mockResolvedValue({ ok, json: () => Promise.resolve(payload) });
}

describe('hasChinese', () => {
  it('detects CJK text', () => {
    expect(hasChinese('我得做家务')).toBe(true);
    expect(hasChinese('I have to do the chores')).toBe(false);
  });
});

describe('translateToChinese', () => {
  it('returns the translated text', async () => {
    respond({ responseData: { translatedText: '我得做家务' } });
    await expect(translateToChinese('I have to do the chores')).resolves.toBe(
      '我得做家务',
    );
  });

  it('decodes HTML entities from the service', async () => {
    respond({ responseData: { translatedText: 'It&#39;s fine &amp; dandy' } });
    await expect(translateToChinese("It's fine & dandy")).resolves.toBe(
      "It's fine & dandy",
    );
  });

  it('treats a quota warning as no translation', async () => {
    respond({
      responseData: {
        translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY',
      },
    });
    await expect(translateToChinese('anything')).resolves.toBeNull();
  });

  it('returns null when the request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('network unreachable'));
    await expect(translateToChinese('hello')).resolves.toBeNull();
  });

  it('returns null for empty input and passes Chinese through unchanged', async () => {
    await expect(translateToChinese('   ')).resolves.toBeNull();
    await expect(translateToChinese('已经中文了')).resolves.toBe('已经中文了');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches repeated lookups', async () => {
    respond({ responseData: { translatedText: '你好' } });
    await translateToChinese('hello');
    await translateToChinese('hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
