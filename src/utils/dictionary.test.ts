/**
 * Tests for dictionary lookup — especially morphological fallback
 * (chores → chore, errands → errand, running → run …).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDictionaryCache,
  lookupWord,
  morphologicalVariants,
} from './dictionary';

afterEach(() => {
  clearDictionaryCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('morphologicalVariants', () => {
  it('reverses regular plurals', () => {
    expect(morphologicalVariants('errands')).toContain('errand');
    expect(morphologicalVariants('chores')).toContain('chore');
  });

  it('reverses -es and -ies plurals', () => {
    expect(morphologicalVariants('watches')).toContain('watch');
    expect(morphologicalVariants('studies')).toContain('study');
  });

  it('reverses -ing forms (incl. doubling)', () => {
    expect(morphologicalVariants('making')).toContain('make');
    expect(morphologicalVariants('running')).toContain('run');
  });

  it('reverses -ed forms', () => {
    expect(morphologicalVariants('baked')).toContain('bake');
    expect(morphologicalVariants('stopped')).toContain('stop');
    expect(morphologicalVariants('carried')).toContain('carry');
  });
});

/** A minimal dictionaryapi.dev entry payload. */
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

describe('lookupWord with morphological fallback', () => {
  it('finds chores via the chore entry', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/en/chores')) return { ok: false, status: 404 };
      if (u.endsWith('/en/chore'))
        return { ok: true, status: 200, json: async () => apiEntry('chore') };
      return { ok: false, status: 404 };
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await lookupWord('chores');
    expect(result).not.toBeNull();
    expect(result!.word).toBe('chore');
    expect(result!.queried).toBe('chores');
    expect(result!.meanings[0]!.definitions[0]).toBe('meaning of chore');
  });

  it('returns the direct entry untouched when the base form exists', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => apiEntry('run'),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await lookupWord('run');
    expect(result!.word).toBe('run');
    expect(result!.queried).toBeUndefined();
  });

  it('returns null only when nothing matches', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await lookupWord('chores');
    expect(result).toBeNull();
    // Original + several variants attempted.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
  });

  it('falls back to Datamuse when the main source is unreachable', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('dictionaryapi.dev')) {
        throw new TypeError('network unreachable');
      }
      if (u.includes('datamuse.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              word: 'chores',
              defHeadword: 'chore',
              defs: [
                'n\tA task, especially a regularly needed task.',
                'n\tA tedious routine task.',
              ],
            },
          ],
        };
      }
      return { ok: false, status: 404 };
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await lookupWord('chores');
    expect(result).not.toBeNull();
    expect(result!.word).toBe('chore');
    expect(result!.queried).toBe('chores');
    expect(result!.meanings[0]!.partOfSpeech).toBe('noun');
    expect(result!.meanings[0]!.definitions[0]).toContain('A task');
  });
});
