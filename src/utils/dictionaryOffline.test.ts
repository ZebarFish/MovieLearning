/**
 * Tests for the offline-first path of `lookupWord()` — the local ECDICT
 * dictionary served at `/dict/offline`.
 *
 * `USE_LOCAL_PROXY` is a module-level constant, so this file mocks
 * `./localProxy` to pretend the app is being served by the local Vite
 * server. That is why these live apart from `dictionary.test.ts`, which
 * exercises the online chain and therefore needs the proxy disabled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./localProxy', () => ({
  IS_TEST: true,
  SERVED_LOCALLY: true,
  USE_LOCAL_PROXY: true,
}));

import { clearDictionaryCache, lookupWord } from './dictionary';

/** One ECDICT record, shaped exactly as `server/dictionary.mjs` returns it. */
function offlineEntry(overrides: Record<string, unknown> = {}): unknown {
  return {
    word: 'furniture',
    phonetic: '英 [ˈfɜːnɪtʃə] 美 [ˈfɜːrnɪtʃər]',
    // ECDICT separates lines with a LITERAL backslash-n, not U+000A.
    translation: 'n. 家具；设备\\nvt. 提供家具',
    definition: '',
    pos: 'n:100',
    collins: '2',
    oxford: '1',
    tag: 'cet4 cet6 ky',
    bnc: '2135',
    frq: '1928',
    exchange: 's:furnitures',
    ...overrides,
  };
}

/** A minimal dictionaryapi.dev entry payload, for the online fallback. */
function apiEntry(word: string): unknown {
  return [
    {
      word,
      phonetic: '/tɛst/',
      phonetics: [],
      meanings: [
        {
          partOfSpeech: 'noun',
          definitions: [{ definition: `meaning of ${word}` }],
        },
      ],
    },
  ];
}

function ok(body: unknown): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => body };
}

function notFound(): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return { ok: false, status: 404, json: async () => ({ found: false }) };
}

/** URLs passed to the stubbed `fetch`, in call order. */
function urlsOf(mock: { mock: { calls: unknown[][] } }): string[] {
  return mock.mock.calls.map((call) => String(call[0]));
}

describe('offline-first lookup', () => {
  beforeEach(() => {
    clearDictionaryCache();
  });

  afterEach(() => {
    clearDictionaryCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('answers from the local dictionary without touching the network', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === '/dict/offline?w=furniture') return ok(offlineEntry());
      throw new Error(`unexpected network call: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await lookupWord('furniture');

    expect(result).not.toBeNull();
    // "英 [ˈfɜːnɪtʃə] 美 [ˈfɜːrnɪtʃər]" is reduced to the IPA alone.
    expect(result!.phonetic).toBe('ˈfɜːnɪtʃə');
    // A direct hit is not an inflection, so no "变形" hint.
    expect(result!.queried).toBeUndefined();
    expect(result!.meanings).toEqual([
      { partOfSpeech: 'n.', definitions: ['家具', '设备'] },
      { partOfSpeech: 'vt.', definitions: ['提供家具'] },
    ]);
    // The offline hit ended the lookup — nothing else was even attempted.
    expect(urlsOf(fetchMock)).toEqual(['/dict/offline?w=furniture']);
  });

  it('resolves inflected forms offline (chores → chore)', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === '/dict/offline?w=chore') {
        return ok(
          offlineEntry({
            word: 'chore',
            phonetic: '[tʃɔː]',
            translation: 'n. 日常杂务，家务活；苦差事',
          }),
        );
      }
      if (u.startsWith('/dict/offline')) return notFound();
      throw new Error(`unexpected network call: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await lookupWord('chores');

    expect(result!.word).toBe('chore');
    expect(result!.queried).toBe('chores');
    expect(result!.phonetic).toBe('tʃɔː');
    expect(result!.meanings).toEqual([
      { partOfSpeech: 'n.', definitions: ['日常杂务，家务活', '苦差事'] },
    ]);
    // Still purely offline — the online sources were never consulted.
    expect(urlsOf(fetchMock).every((u) => u.startsWith('/dict/offline'))).toBe(true);
  });

  it('merges repeated parts of speech into one group', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('/dict/offline')) {
        return ok(
          offlineEntry({
            word: 'abandon',
            phonetic: '',
            translation: 'n. 放任\\nn. 狂热\\nvt. 放弃，抛弃；离弃',
          }),
        );
      }
      throw new Error(`unexpected network call: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await lookupWord('abandon');

    // Two "n." lines fold into one meaning, so the UI has one card per
    // part of speech (and no duplicate React keys).
    expect(result!.meanings).toEqual([
      { partOfSpeech: 'n.', definitions: ['放任', '狂热'] },
      { partOfSpeech: 'vt.', definitions: ['放弃，抛弃', '离弃'] },
    ]);
    expect(result!.phonetic).toBeUndefined();
  });

  it('falls back to the online chain when the local dictionary misses', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('/dict/offline')) return notFound();
      if (u.endsWith('/en/unusual')) return ok(apiEntry('unusual'));
      return notFound();
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await lookupWord('unusual');

    expect(result!.word).toBe('unusual');
    expect(result!.meanings[0]!.partOfSpeech).toBe('noun');
    const urls = urlsOf(fetchMock);
    expect(urls[0]).toBe('/dict/offline?w=unusual');
    expect(urls.some((u) => u.endsWith('/en/unusual'))).toBe(true);
  });

  it('ignores an unbuilt index (503) instead of failing', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('/dict/offline')) {
        return { ok: false, status: 503, json: async () => ({ error: 'index-not-built' }) };
      }
      if (u.endsWith('/en/run')) return ok(apiEntry('run'));
      return notFound();
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await lookupWord('run');

    expect(result).not.toBeNull();
    expect(result!.word).toBe('run');
  });

  it('uses the English definition when ECDICT has no Chinese translation', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('/dict/offline')) {
        return ok(
          offlineEntry({
            word: 'quay',
            phonetic: '',
            translation: '',
            definition: 'n. a platform lying alongside water\\nvt. to dock a vessel',
          }),
        );
      }
      throw new Error(`unexpected network call: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await lookupWord('quay');

    expect(result!.meanings).toEqual([
      { partOfSpeech: 'n.', definitions: ['a platform lying alongside water'] },
      { partOfSpeech: 'vt.', definitions: ['to dock a vessel'] },
    ]);
  });

  it('treats a blank record as a miss', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('/dict/offline')) {
        return ok(offlineEntry({ translation: '   ', definition: '' }));
      }
      if (u.endsWith('/en/furniture')) return ok(apiEntry('furniture'));
      return notFound();
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await lookupWord('furniture');

    // The online shape leaks through, proving the blank record was skipped.
    expect(result!.meanings[0]!.partOfSpeech).toBe('noun');
    expect(result!.meanings[0]!.definitions[0]).toBe('meaning of furniture');
  });

  it('caches an offline hit', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('/dict/offline')) return ok(offlineEntry());
      throw new Error(`unexpected network call: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await lookupWord('furniture');
    await lookupWord('Furniture');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
