/**
 * Tests for vocabulary enrichment (utils/vocabEnrich.ts) — filling
 * 单词释义 from the dictionary and 例句释义 from the ZH subtitles / MT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubtitleCue, VocabWord } from '../types';
import { clearDictionaryCache } from './dictionary';
import { clearTranslationCache } from './translate';
import {
  chineseCueTextAt,
  countPendingEnrichment,
  enrichVocab,
  findCueAt,
} from './vocabEnrich';

const fetchMock = vi.fn();

beforeEach(() => {
  clearDictionaryCache();
  clearTranslationCache();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const zhCues: SubtitleCue[] = [
  { index: 1, start: 5, end: 7, text: '我得做家务。' },
  { index: 2, start: 10, end: 12, text: '别烦我。' },
];

function word(over: Partial<VocabWord> = {}): VocabWord {
  return {
    word: 'chores',
    surface: 'chores',
    sentence: 'I have to do the chores.',
    video: 'ep01.mp4',
    time: 5.5,
    addedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

/** Mocked dictionaryapi.dev payload. */
function apiEntry(w: string): unknown {
  return [
    {
      word: w,
      phonetics: [],
      meanings: [
        { partOfSpeech: 'noun', definitions: [{ definition: `meaning of ${w}` }] },
      ],
    },
  ];
}

describe('findCueAt', () => {
  it('returns the cue that contains the timestamp', () => {
    expect(findCueAt(zhCues, 6)?.text).toBe('我得做家务。');
  });

  it('falls back to the nearest cue within the tolerance', () => {
    expect(findCueAt(zhCues, 7.4)?.index).toBe(1);
  });

  it('returns null when the nearest cue is too far away', () => {
    expect(findCueAt(zhCues, 60)).toBeNull();
  });

  it('handles missing or empty cue lists', () => {
    expect(findCueAt(undefined, 1)).toBeNull();
    expect(findCueAt([], 1)).toBeNull();
  });
});

describe('chineseCueTextAt', () => {
  it('returns the Chinese line at a timestamp', () => {
    expect(chineseCueTextAt(zhCues, 6)).toBe('我得做家务。');
  });

  it('ignores an untranslated (English) line in the Chinese track', () => {
    const untranslated: SubtitleCue[] = [
      { index: 1, start: 0, end: 2, text: 'I have to do the chores.' },
    ];
    expect(chineseCueTextAt(untranslated, 1)).toBeNull();
  });
});

describe('countPendingEnrichment', () => {
  const complete = word({
    definition: 'n. 家务',
    translation: '我得做家务。',
    meta: { oxford: true },
  });

  it('counts entries missing a definition, a translation or metadata', () => {
    expect(countPendingEnrichment([word(), complete])).toBe(1);
    expect(countPendingEnrichment([complete])).toBe(0);
  });

  it('counts an entry whose definition and translation are filled but whose metadata is not', () => {
    // Entries collected before the lexical metadata existed must still be
    // picked up, otherwise the new Anki fields would stay empty forever.
    expect(
      countPendingEnrichment([
        word({ definition: 'n. 家务', translation: '我得做家务。' }),
      ]),
    ).toBe(1);
  });
});

describe('enrichVocab', () => {
  it('fills 例句释义 from the Chinese subtitle track', async () => {
    // Dictionary unavailable — only the subtitle translation is expected.
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    const input = [word()];
    const out = await enrichVocab(input, { zhCues });

    expect(out[0]!.translation).toBe('我得做家务。');
    expect(out[0]).not.toBe(input[0]);
    expect(out[0]!.sentence).toBe('I have to do the chores.');
  });

  it('falls back to machine translation and fills the definition', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes('dictionaryapi.dev')) {
        return { ok: true, status: 200, json: () => Promise.resolve(apiEntry('chore')) };
      }
      if (u.includes('mymemory')) {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({ responseData: { translatedText: '我得做家务。' } }),
        };
      }
      return { ok: false, status: 404 };
    });

    const out = await enrichVocab([word()], {});
    expect(out[0]!.translation).toBe('我得做家务。');
    expect(out[0]!.definition).toContain('meaning of chore');
  });

  it('prefers the subtitle over machine translation', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes('mymemory')) {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({ responseData: { translatedText: '机翻结果' } }),
        };
      }
      return { ok: false, status: 404 };
    });

    const out = await enrichVocab([word()], { zhCues });
    expect(out[0]!.translation).toBe('我得做家务。');
    const usedMt = fetchMock.mock.calls.some((c) => String(c[0]).includes('mymemory'));
    expect(usedMt).toBe(false);
  });

  it('leaves complete entries untouched (same object identity)', async () => {
    const complete = word({
      definition: 'n. 家务',
      translation: '我得做家务。',
      meta: { oxford: true },
    });
    const out = await enrichVocab([complete], { zhCues });
    expect(out[0]).toBe(complete);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports progress for each pending entry', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const onProgress = vi.fn();

    await enrichVocab([word({ word: 'a', time: 5.5 }), word({ word: 'b', time: 10.5 })], {
      zhCues,
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });
});
