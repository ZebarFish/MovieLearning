/**
 * Tests for the AnkiConnect integration (utils/ankiConnect.ts).
 * fetch is mocked — no real Anki instance needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkAnkiConnection,
  syncVocabToAnki,
} from './ankiConnect';
import type { VocabWord } from '../types';

const entry = (word: string): VocabWord => ({
  word,
  surface: word,
  sentence: `This is ${word}.`,
  video: 'demo.mp4',
  time: 12.5,
  addedAt: new Date().toISOString(),
});

const fetchMock = vi.fn();

/** Route a mocked AnkiConnect request based on its action. */
function respondByAction(handler: (action: string) => unknown): void {
  fetchMock.mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init.body));
    // Metadata actions needed by the up-front validation in syncVocabToAnki.
    const defaults: Record<string, unknown> = {
      deckNames: ['Default', '绝望主妇'],
      modelNames: ['Basic', '问答题'],
      modelFieldNames: ['Front', 'Back'],
    };
    const result =
      body.action in defaults ? defaults[body.action] : handler(body.action);
    return {
      ok: true,
      json: () => Promise.resolve({ result, error: null }),
    };
  });
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });
  fetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkAnkiConnection', () => {
  it('returns ok with version when AnkiConnect responds', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 6, error: null }),
    });
    const status = await checkAnkiConnection();
    expect(status.ok).toBe(true);
    expect(status.version).toBe('6');
  });

  it('returns ok=false with guidance when fetch throws (Anki not running)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const status = await checkAnkiConnection();
    expect(status.ok).toBe(false);
    expect(status.error).toContain('AnkiConnect');
  });

  it('returns ok=false when AnkiConnect reports an error payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: null, error: 'unsupported version' }),
    });
    const status = await checkAnkiConnection();
    expect(status.ok).toBe(false);
  });
});

describe('syncVocabToAnki', () => {
  it('adds words missing from the target deck, tag-based dedupe style', async () => {
    // findNotes → [] (no previously tagged notes); addNotes → note ids.
    respondByAction((action) => (action === 'addNotes' ? [101, 102] : []));

    const result = await syncVocabToAnki(
      [entry('apple'), entry('banana')],
      '绝望主妇',
      'Basic',
    );

    expect(result.added).toBe(2);
    expect(result.duplicates).toEqual([]);

    // Verify the addNotes payload: allowDuplicate must be true (bypasses
    // global per-note-type dedupe) and deck scoping correct.
    const addCall = fetchMock.mock.calls.find(
      (c) => JSON.parse(String(c[1]?.body)).action === 'addNotes',
    );
    const body = JSON.parse(String(addCall![1].body));
    expect(body.params.notes).toHaveLength(2);
    expect(body.params.notes[0].deckName).toBe('绝望主妇');
    expect(body.params.notes[0].fields.Front).toBe('apple');
    expect(body.params.notes[0].options.allowDuplicate).toBe(true);

    // Dedupe must NOT rely on findCards (unreliable in some Anki versions).
    const usedFindCards = fetchMock.mock.calls.some(
      (c) => JSON.parse(String(c[1]?.body)).action === 'findCards',
    );
    expect(usedFindCards).toBe(false);
  });

  it('skips words already synced (found via the app tag)', async () => {
    // 'apple' exists among tagged notes; 'banana' does not.
    respondByAction((action) => {
      if (action === 'findNotes') return [5001];
      if (action === 'notesInfo') {
        return [
          { fields: { Front: { value: 'APPLE' } }, cards: [1] },
        ];
      }
      return [201];
    });

    const result = await syncVocabToAnki(
      [entry('apple'), entry('banana')],
      '绝望主妇',
      'Basic',
    );

    expect(result.added).toBe(1);
    expect(result.duplicates).toEqual([
      { word: 'apple', deck: '绝望主妇' },
    ]);
  });

  it('remembers synced words locally even if Anki search is down', async () => {
    // First sync: succeeds.
    respondByAction((action) => (action === 'addNotes' ? [301] : []));
    const first = await syncVocabToAnki([entry('apple')], '绝望主妇', 'Basic');
    expect(first.added).toBe(1);

    // Second sync: Anki search returns garbage/empty, but the local record
    // must still prevent a duplicate.
    fetchMock.mockReset();
    respondByAction((action) => (action === 'addNotes' ? [302] : []));
    const second = await syncVocabToAnki([entry('apple')], '绝望主妇', 'Basic');
    expect(second.added).toBe(0);
    expect(second.duplicates).toEqual([{ word: 'apple', deck: '绝望主妇' }]);
  });

  it('short-circuits on empty vocabulary', async () => {
    const result = await syncVocabToAnki([], 'Default', 'Basic');
    expect(result.added).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates AnkiConnect errors from addNotes', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      if (body.action === 'findNotes') {
        return { ok: true, json: () => Promise.resolve({ result: [], error: null }) };
      }
      return { ok: true, json: () => Promise.resolve({ result: null, error: 'deck was not found' }) };
    });

    await expect(
      syncVocabToAnki([entry('apple')], 'Missing', 'Basic'),
    ).rejects.toThrow('deck was not found');
  });

  it('reports per-note failures when addNotes returns null entries', async () => {
    // deck/model validation passes, dedupe passes, but AnkiConnect
    // rejects the note (e.g. field mismatch) → must surface as failed.
    respondByAction((action) => (action === 'addNotes' ? [null] : []));

    const result = await syncVocabToAnki([entry('apple')], '绝望主妇', 'Basic');
    expect(result.added).toBe(0);
    expect(result.failed).toEqual(['apple']);
  });

  it('rejects unknown note types with an actionable message', async () => {
    respondByAction(() => []);
    await expect(
      syncVocabToAnki([entry('apple')], '绝望主妇', 'Nonexistent'),
    ).rejects.toThrow('笔记类型「Nonexistent」不存在');
  });
});
