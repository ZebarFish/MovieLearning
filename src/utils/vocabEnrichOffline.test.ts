/**
 * Tests that `enrichVocab` backfills the lexical metadata (`meta`) as well as
 * 单词释义 / 例句释义.
 *
 * `USE_LOCAL_PROXY` is a module-level constant, so — exactly like
 * `dictionaryOffline.test.ts` — this file mocks `./localProxy` to pretend the
 * app is served by the local Vite server, which is what makes the offline
 * ECDICT dictionary reachable. `vocabEnrich.test.ts` covers the online path
 * and therefore needs the proxy disabled, which is why these live apart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./localProxy', () => ({
  IS_TEST: true,
  SERVED_LOCALLY: true,
  USE_LOCAL_PROXY: true,
}));

import type { SubtitleCue, VocabWord } from '../types';
import { clearDictionaryCache } from './dictionary';
import { enrichVocab } from './vocabEnrich';

function word(over: Partial<VocabWord> = {}): VocabWord {
  return {
    word: 'discovered',
    surface: 'discovered',
    sentence: 'I discovered it yesterday.',
    video: 'ep01.mp4',
    time: 5.5,
    addedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

const zhCues: SubtitleCue[] = [
  { index: 1, start: 5, end: 7, text: '我昨天发现了它。' },
];

/** The ECDICT row shape `server/dictionary.mjs` returns. */
const offlineRecord = {
  word: 'discovered',
  phonetic: "dis'kʌvә",
  translation: 'v. 发现, 找到（discover的过去形式）',
  definition: 'v. find unexpectedly\\nv. discover or determine',
  pos: 'v:100',
  collins: '5',
  oxford: '1',
  tag: 'gk cet4',
  bnc: '49',
  frq: '47',
  exchange: '0:discover/1:pd',
  forms: {
    lemma: 'discover',
    past: 'discovered',
    pastParticiple: 'discovered',
    presentParticiple: 'discovering',
    thirdPerson: 'discovers',
  },
};

beforeEach(() => {
  clearDictionaryCache();
});

afterEach(() => {
  clearDictionaryCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('enrichVocab with the offline dictionary', () => {
  it('fills 单词释义 and the lexical metadata from a single offline lookup', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === '/dict/offline?w=discovered') {
        return { ok: true, status: 200, json: async () => offlineRecord };
      }
      throw new Error(`unexpected network call: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const input = [word()];
    const out = await enrichVocab(input, { zhCues });

    expect(out[0]).not.toBe(input[0]);
    // 例句释义 comes from the human-written Chinese track.
    expect(out[0]!.translation).toBe('我昨天发现了它。');
    // 单词释义 comes from ECDICT.
    expect(out[0]!.definition).toBe('v. 发现, 找到（discover的过去形式）');

    const meta = out[0]!.meta;
    expect(meta).toBeDefined();
    expect(meta!.phonetic).toBe("dis'kʌvә");
    expect(meta!.collins).toBe(5);
    expect(meta!.oxford).toBe(true);
    expect(meta!.tags).toEqual(['gk', 'cet4']);
    expect(meta!.bnc).toBe(49);
    expect(meta!.frq).toBe(47);
    expect(meta!.pos).toBe('v:100');
    expect(meta!.forms!.lemma).toBe('discover');
    // The literal `\n` of the ECDICT source becomes a real newline.
    expect(meta!.definition).toBe('v. find unexpectedly\nv. discover or determine');

    // Purely offline — no online dictionary or translation service was used.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('backfills only meta for an entry whose definition and translation are already stored', async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === '/dict/offline?w=discovered') {
        return { ok: true, status: 200, json: async () => offlineRecord };
      }
      throw new Error(`unexpected network call: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const out = await enrichVocab(
      [
        word({
          definition: 'v. 已存释义',
          translation: '已存例句释义。',
        }),
      ],
      { zhCues },
    );

    // The stored values win; only the missing metadata is added.
    expect(out[0]!.definition).toBe('v. 已存释义');
    expect(out[0]!.translation).toBe('已存例句释义。');
    expect(out[0]!.meta!.phonetic).toBe("dis'kʌvә");
  });
});
