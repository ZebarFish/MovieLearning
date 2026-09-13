/**
 * Tests for the AnkiConnect integration (utils/ankiConnect.ts).
 * fetch is mocked — no real Anki instance needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildNoteFields,
  checkAnkiConnection,
  ensureAnkiModel,
  syncVocabToAnki,
} from './ankiConnect';
import {
  ANKI_FIELDS,
  ANKI_MODEL_NAME,
  CARD_BACK,
  CARD_FRONT,
  CARD_NAME,
} from './ankiTemplate';
import type { VocabWord } from '../types';

const entry = (word: string): VocabWord => ({
  word,
  surface: word,
  sentence: `This is ${word}.`,
  video: 'demo.mp4',
  time: 12.5,
  addedAt: new Date().toISOString(),
});

/** AnkiConnect success envelope. */
function res<T>(result: T): { ok: boolean; json: () => Promise<unknown> } {
  return { ok: true, json: () => Promise.resolve({ result, error: null }) };
}

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

describe('buildNoteFields', () => {
  const rich: VocabWord = {
    ...entry('chores'),
    definition: 'n. 家务活',
    translation: '我得做家务。',
  };

  it('fills the built-in note type by field name', () => {
    expect(buildNoteFields([...ANKI_FIELDS], rich)).toEqual({
      单词: 'chores',
      单词释义: 'n. 家务活',
      例句: 'This is chores.',
      例句释义: '我得做家务。',
    });
  });

  it('maps positionally onto a foreign four-field model', () => {
    expect(buildNoteFields(['Front', 'Meaning', 'Sentence', 'Extra'], rich)).toEqual({
      Front: 'chores',
      Meaning: 'n. 家务活',
      Sentence: 'This is chores.',
      // The breadcrumb only survives on models that lack our fields.
      Extra: '我得做家务。\n\ndemo.mp4 · 00:00:12',
    });
  });

  it('folds everything into the last field of a two-field model', () => {
    const fields = buildNoteFields(['Front', 'Back'], rich);
    expect(fields.Front).toBe('chores');
    expect(fields.Back).toContain('n. 家务活');
    expect(fields.Back).toContain('This is chores.');
    expect(fields.Back).toContain('我得做家务。');
    expect(fields.Back).toContain('demo.mp4');
  });

  it('keeps 例句 clean for the built-in type (no breadcrumb)', () => {
    const fields = buildNoteFields([...ANKI_FIELDS], rich);
    expect(fields['例句']).toBe('This is chores.');
    expect(fields['例句']).not.toContain('demo.mp4');
  });
});

describe('ensureAnkiModel', () => {
  /** Record every AnkiConnect call and answer via a per-action table. */
  function trackCalls(
    table: Record<string, (params: Record<string, unknown>) => unknown>,
  ): Record<string, unknown>[] {
    const calls: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      calls.push(body);
      const handler = table[body.action];
      return { ok: true, json: () => Promise.resolve({ result: handler ? handler(body.params) : null, error: null }) };
    });
    return calls;
  }

  it('creates the note type with the four fields and the TTS card', async () => {
    const calls = trackCalls({ modelNames: () => ['Basic'] });

    const status = await ensureAnkiModel();

    expect(status.created).toBe(true);
    expect(status.fields).toEqual(ANKI_FIELDS);

    const create = calls.find((c) => c['action'] === 'createModel') as {
      params: {
        modelName: string;
        inOrderFields: string[];
        cardTemplates: { Front: string; Back: string }[];
      };
    };
    expect(create.params.modelName).toBe(ANKI_MODEL_NAME);
    expect(create.params.inOrderFields).toEqual(ANKI_FIELDS);
    expect(create.params.cardTemplates[0]!.Front).toContain('{{tts en_US:单词}}');
    expect(create.params.cardTemplates[0]!.Back).toContain('{{例句释义}}');
  });

  it('adds only the missing fields to an existing copy', async () => {
    const calls = trackCalls({
      modelNames: () => [ANKI_MODEL_NAME],
      modelFieldNames: () => ['单词', '单词释义', '例句'],
      modelTemplates: () => ({}),
      modelStyling: () => ({ css: '.word { color: red; }' }),
    });

    const status = await ensureAnkiModel();

    expect(status.created).toBe(false);
    expect(status.addedFields).toEqual(['例句释义']);
    expect(status.templatesUpdated).toBe(true);

    const add = calls.find((c) => c['action'] === 'modelFieldAdd') as {
      params: { fieldName: string; index: number };
    };
    expect(add.params.fieldName).toBe('例句释义');
    expect(add.params.index).toBe(3);
  });

  it('leaves a healthy template and styling untouched', async () => {
    const calls = trackCalls({
      modelNames: () => [ANKI_MODEL_NAME],
      modelFieldNames: () => [...ANKI_FIELDS],
      modelTemplates: () => ({
        [CARD_NAME]: { Front: CARD_FRONT, Back: CARD_BACK },
      }),
      modelStyling: () => ({ css: '.word { color: red; }' }),
    });

    const status = await ensureAnkiModel();

    expect(status.templatesUpdated).toBe(false);
    expect(status.addedFields).toEqual([]);
    expect(calls.some((c) => c['action'] === 'updateModelTemplates')).toBe(false);
    expect(calls.some((c) => c['action'] === 'updateModelStyling')).toBe(false);
  });

  it('reinstalls a template that lost the pronunciation expression', async () => {
    const calls = trackCalls({
      modelNames: () => [ANKI_MODEL_NAME],
      modelFieldNames: () => [...ANKI_FIELDS],
      modelTemplates: () => ({
        [CARD_NAME]: { Front: '{{单词}}', Back: '{{单词释义}}' },
      }),
      modelStyling: () => ({ css: '.word { color: red; }' }),
    });

    const status = await ensureAnkiModel();

    expect(status.templatesUpdated).toBe(true);
    expect(calls.some((c) => c['action'] === 'updateModelTemplates')).toBe(true);
  });
});

describe('syncVocabToAnki with the built-in note type', () => {
  it('writes all four fields (definition and translation included)', async () => {
    const calls: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init.body)) as {
        action: string;
        params: Record<string, unknown>;
      };
      calls.push(body);
      switch (body.action) {
        case 'modelNames':
          return res([ANKI_MODEL_NAME]);
        case 'modelFieldNames':
          return res([...ANKI_FIELDS]);
        case 'modelTemplates':
          return res({ [CARD_NAME]: { Front: CARD_FRONT, Back: CARD_BACK } });
        case 'modelStyling':
          return res({ css: '.word { color: red; }' });
        case 'deckNames':
          return res(['绝望主妇']);
        case 'findNotes':
          return res([]);
        case 'addNotes':
          return res([900]);
        case 'notesInfo':
          return res([{ cards: [42] }]);
        case 'cardsInfo':
          return res([{ cardId: 42, deckName: '绝望主妇' }]);
        default:
          return res(null);
      }
    });

    const result = await syncVocabToAnki(
      [{ ...entry('chores'), definition: 'n. 家务活', translation: '我得做家务。' }],
      '绝望主妇',
      ANKI_MODEL_NAME,
    );

    expect(result.added).toBe(1);
    const add = calls.find((c) => c['action'] === 'addNotes') as {
      params: { notes: { fields: Record<string, string> }[] };
    };
    expect(add.params.notes[0]!.fields).toEqual({
      单词: 'chores',
      单词释义: 'n. 家务活',
      例句: 'This is chores.',
      例句释义: '我得做家务。',
    });
  });

  it('creates the note type on the fly when the user picked it but it is missing', async () => {
    const calls: Record<string, unknown>[] = [];
    let created = false;
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { action: string };
      calls.push(body);
      switch (body.action) {
        case 'modelNames':
          return res(created ? [ANKI_MODEL_NAME] : ['Basic']);
        case 'createModel':
          created = true;
          return res({ id: 1 });
        case 'modelFieldNames':
          return res([...ANKI_FIELDS]);
        case 'modelTemplates':
          return res({ [CARD_NAME]: { Front: CARD_FRONT, Back: CARD_BACK } });
        case 'modelStyling':
          return res({ css: '.word { color: red; }' });
        case 'deckNames':
          return res(['Default']);
        case 'findNotes':
          return res([]);
        case 'addNotes':
          return res([123]);
        default:
          return res(null);
      }
    });

    const result = await syncVocabToAnki(
      [entry('apple')],
      'Default',
      ANKI_MODEL_NAME,
    );

    expect(calls.some((c) => c['action'] === 'createModel')).toBe(true);
    expect(result.added).toBe(1);
  });
});
