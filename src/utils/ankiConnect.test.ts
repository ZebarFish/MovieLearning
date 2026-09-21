/**
 * Tests for the AnkiConnect integration (utils/ankiConnect.ts).
 * fetch is mocked — no real Anki instance needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildNoteFields,
  checkAnkiConnection,
  ensureAnkiModel,
  getSyncedWords,
  setWordSyncedManually,
  syncVocabToAnki,
} from './ankiConnect';
import {
  ANKI_CSS,
  ANKI_FIELDS,
  ANKI_MODEL_NAME,
  CARD_BACK,
  CARD_FRONT,
  CARD_NAME,
  FIELD_WORD,
} from './ankiTemplate';
import type { VocabWord } from '../types';

/**
 * The exact 拼写 section CARD_BACK ships, used to synthesise the "old"
 * back template that an already-installed deck still has.
 */
const SPELL_SECTION = `<div class="section">
  <div class="label">拼写</div>
  <div class="value spell">{{${FIELD_WORD}}}</div>
</div>

`;

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

const SYNCED_KEY = 'learnTV.anki.syncedWords.v1';

/** Seed the app's synced-word record exactly as a given version wrote it. */
function seedSyncedRecord(deck: string, value: unknown): void {
  localStorage.setItem(SYNCED_KEY, JSON.stringify({ [deck]: value }));
}

function syncedRecordOf(deck: string): unknown {
  return (
    JSON.parse(localStorage.getItem(SYNCED_KEY) ?? '{}') as Record<
      string,
      unknown
    >
  )[deck];
}

beforeEach(() => {
  localStorage.clear();
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

  it('re-adds a word whose note the user deleted in Anki', async () => {
    // What a previous sync left behind: the note id it created, whose card
    // the user has since deleted. AnkiConnect answers `{}` for a dead id.
    seedSyncedRecord('绝望主妇', [{ word: 'errands', noteId: 501 }]);
    respondByAction((action) => {
      if (action === 'notesInfo') return [{}];
      if (action === 'addNotes') return [601];
      return [];
    });

    const result = await syncVocabToAnki([entry('errands')], '绝望主妇', 'Basic');

    expect(result.added).toBe(1);
    expect(result.duplicates).toEqual([]);
    // The stale entry was replaced by the freshly created note id.
    expect(syncedRecordOf('绝望主妇')).toEqual([
      { word: 'errands', noteId: 601 },
    ]);
  });

  it('still skips a word whose note really is still there', async () => {
    seedSyncedRecord('绝望主妇', [{ word: 'apple', noteId: 501 }]);
    respondByAction((action) => {
      if (action === 'notesInfo') return [{ noteId: 501, cards: [7] }];
      return [];
    });

    const result = await syncVocabToAnki([entry('apple')], '绝望主妇', 'Basic');

    expect(result.added).toBe(0);
    expect(result.duplicates).toEqual([{ word: 'apple', deck: '绝望主妇' }]);
  });

  it('re-adds legacy entries (no note id) once the tag query shows they are gone', async () => {
    // The exact shape older versions wrote: a plain array of words. These are
    // what a user upgrading mid-flight still has in localStorage.
    seedSyncedRecord('绝望主妇', ['errands', 'chores']);
    respondByAction((action) => (action === 'addNotes' ? [701, 702] : []));

    const result = await syncVocabToAnki(
      [entry('errands'), entry('chores')],
      '绝望主妇',
      'Basic',
    );

    expect(result.added).toBe(2);
    expect(result.duplicates).toEqual([]);
    expect(syncedRecordOf('绝望主妇')).toEqual([
      { word: 'errands', noteId: 701 },
      { word: 'chores', noteId: 702 },
    ]);
  });

  it('keeps a legacy entry when the tag query itself fails (fail safe)', async () => {
    seedSyncedRecord('绝望主妇', ['apple']);
    // findNotes errors → we cannot know whether the note was deleted, so the
    // record must still win rather than flooding Anki with duplicates.
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init.body));
      if (body.action === 'findNotes') {
        return {
          ok: true,
          json: () => Promise.resolve({ result: null, error: 'query failed' }),
        };
      }
      if (body.action === 'deckNames') return res(['Default', '绝望主妇']);
      if (body.action === 'modelNames') return res(['Basic']);
      if (body.action === 'modelFieldNames') return res(['Front', 'Back']);
      return res(null);
    });

    const result = await syncVocabToAnki([entry('apple')], '绝望主妇', 'Basic');

    expect(result.added).toBe(0);
    expect(result.duplicates).toEqual([{ word: 'apple', deck: '绝望主妇' }]);
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

  it('never re-adds a manually marked word, even when Anki proves it absent', async () => {
    // The user marked 'apple' by hand (e.g. imported it some other way).
    // Anki's tag query runs and finds no such note — the manual mark must
    // still win, because a human decision beats the automated check.
    seedSyncedRecord('绝望主妇', [{ word: 'apple', manual: true }]);
    respondByAction((action) => {
      if (action === 'findNotes') return [5001];
      if (action === 'notesInfo') {
        return [{ fields: { Front: { value: 'OTHER' } } }];
      }
      if (action === 'addNotes') return [801];
      return [];
    });

    const result = await syncVocabToAnki([entry('apple')], '绝望主妇', 'Basic');

    expect(result.added).toBe(0);
    expect(result.duplicates).toEqual([{ word: 'apple', deck: '绝望主妇' }]);
    // The manual record was not touched by the sync.
    expect(syncedRecordOf('绝望主妇')).toEqual([{ word: 'apple', manual: true }]);
  });

  it('setWordSyncedManually(false) lets the word sync again', async () => {
    seedSyncedRecord('绝望主妇', [{ word: 'apple', manual: true }]);
    setWordSyncedManually('绝望主妇', 'apple', false);
    expect(getSyncedWords('绝望主妇').has('apple')).toBe(false);

    respondByAction((action) => (action === 'addNotes' ? [901] : []));
    const result = await syncVocabToAnki([entry('apple')], '绝望主妇', 'Basic');
    expect(result.added).toBe(1);
    expect(syncedRecordOf('绝望主妇')).toEqual([{ word: 'apple', noteId: 901 }]);
  });

  it('getSyncedWords / setWordSyncedManually round-trip (case-insensitive)', () => {
    expect(getSyncedWords('Default').has('hello')).toBe(false);
    setWordSyncedManually('Default', 'Hello', true);
    expect(getSyncedWords('Default').has('hello')).toBe(true);
    const stored = JSON.parse(
      localStorage.getItem(SYNCED_KEY) ?? '{}',
    ) as { Default: { word: string; manual?: boolean }[] };
    expect(stored.Default).toEqual([{ word: 'hello', manual: true }]);
  });
});

describe('buildNoteFields', () => {
  const rich: VocabWord = {
    ...entry('chores'),
    definition: 'n. 家务活',
    translation: '我得做家务。',
    meta: {
      phonetic: 'tʃɔːz',
      definition: 'a routine task',
      pos: 'n:100',
      collins: 3,
      tags: ['cet4'],
      bnc: 2135,
      forms: { lemma: 'chore', plural: 'chores' },
    },
  };

  it('fills the built-in note type by field name', () => {
    expect(buildNoteFields([...ANKI_FIELDS], rich)).toEqual({
      单词: 'chores',
      单词释义: 'n. 家务活',
      例句: 'This is chores.',
      例句释义: '我得做家务。',
      音标: 'tʃɔːz',
      英文释义: 'a routine task',
      词形变化: '原形 chore · 复数 chores',
      词性分布: 'n:100',
      词汇标记: '柯林斯★★★ · 四级 · BNC 2135',
    });
  });

  it('writes empty strings (never undefined) for fields with no metadata', () => {
    const bare = buildNoteFields([...ANKI_FIELDS], entry('chores'));
    expect(bare['音标']).toBe('');
    expect(bare['英文释义']).toBe('');
    expect(bare['词形变化']).toBe('');
    expect(bare['词性分布']).toBe('');
    expect(bare['词汇标记']).toBe('');
    expect(Object.values(bare).every((v) => typeof v === 'string')).toBe(true);
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

  it('creates the note type with the nine fields and the TTS card', async () => {
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
    expect(create.params.cardTemplates[0]!.Front).toContain('{{音标}}');
    expect(create.params.cardTemplates[0]!.Back).toContain('{{例句释义}}');
    expect(create.params.cardTemplates[0]!.Back).toContain('{{词汇标记}}');
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
    expect(status.addedFields).toEqual([
      '例句释义',
      '音标',
      '英文释义',
      '词形变化',
      '词性分布',
      '词汇标记',
    ]);
    expect(status.templatesUpdated).toBe(true);

    const add = calls.find((c) => c['action'] === 'modelFieldAdd') as {
      params: { fieldName: string; index: number };
    };
    expect(add.params.fieldName).toBe('例句释义');
    expect(add.params.index).toBe(3);
  });

  it('upgrades a pre-existing four-field template to the nine-field one', async () => {
    // Exactly what an older release of this app installed: the original four
    // sections and the TTS line, but none of the dictionary-derived ones.
    const oldFront = `<div class="word">{{单词}}</div>
<div class="sound">{{tts en_US:单词}}</div>`;
    const oldBack = `{{FrontSide}}

<hr id="answer">

<div class="section">
  <div class="label">单词释义</div>
  <div class="value">{{单词释义}}</div>
</div>

<div class="section">
  <div class="label">例句</div>
  <div class="value sentence">{{例句}}</div>
</div>

<div class="section">
  <div class="label">例句释义</div>
  <div class="value">{{例句释义}}</div>
</div>`;

    const calls = trackCalls({
      modelNames: () => [ANKI_MODEL_NAME],
      modelFieldNames: () => [...ANKI_FIELDS],
      modelTemplates: () => ({
        [CARD_NAME]: { Front: oldFront, Back: oldBack },
      }),
      modelStyling: () => ({ css: ANKI_CSS }),
    });

    const status = await ensureAnkiModel();

    expect(status.templatesUpdated).toBe(true);
    expect(calls.some((c) => c['action'] === 'updateModelTemplates')).toBe(true);
    // Fields were already present, so nothing is added — only the template.
    expect(status.addedFields).toEqual([]);

    // AnkiConnect's updateModelTemplates wants templates keyed BY NAME; an
    // array here is what produced "'list' object has no attribute 'get'".
    const update = calls.find(
      (c) => c['action'] === 'updateModelTemplates',
    ) as { params: { model: { templates: unknown } } };
    const templates = update.params.model.templates;
    expect(Array.isArray(templates)).toBe(false);
    expect(templates).toEqual({
      [CARD_NAME]: { Front: CARD_FRONT, Back: CARD_BACK },
    });
  });

  it('leaves a healthy template and styling untouched', async () => {
    const calls = trackCalls({
      modelNames: () => [ANKI_MODEL_NAME],
      modelFieldNames: () => [...ANKI_FIELDS],
      modelTemplates: () => ({
        [CARD_NAME]: { Front: CARD_FRONT, Back: CARD_BACK },
      }),
      modelStyling: () => ({ css: ANKI_CSS }),
    });

    const status = await ensureAnkiModel();

    expect(status.templatesUpdated).toBe(false);
    expect(status.addedFields).toEqual([]);
    expect(calls.some((c) => c['action'] === 'updateModelTemplates')).toBe(false);
    expect(calls.some((c) => c['action'] === 'updateModelStyling')).toBe(false);
  });

  it('upgrades styling that predates the nine-field model', async () => {
    const calls = trackCalls({
      modelNames: () => [ANKI_MODEL_NAME],
      modelFieldNames: () => [...ANKI_FIELDS],
      modelTemplates: () => ({
        [CARD_NAME]: { Front: CARD_FRONT, Back: CARD_BACK },
      }),
      // The old CSS has `.word` (so the previous check called it fresh) but
      // none of the rules the new 音标 / 词汇标记 sections need.
      modelStyling: () => ({ css: '.word { font-size: 34px; }' }),
    });

    await ensureAnkiModel();

    const update = calls.find(
      (c) => c['action'] === 'updateModelStyling',
    ) as { params: { model: { css: string } } };
    expect(update).toBeDefined();
    expect(update.params.model.css).toContain('.phonetic');
    expect(update.params.model.css).toContain('.tags');
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

  it('reinstalls styling that predates the 拼写 block', async () => {
    // Regression sentinel: CSS from the previous release has `.word`,
    // `.phonetic` and `.tags`, so the OLD freshness check called it up to
    // date — and the newly added 拼写 block would stay unstyled forever.
    const calls = trackCalls({
      modelNames: () => [ANKI_MODEL_NAME],
      modelFieldNames: () => [...ANKI_FIELDS],
      modelTemplates: () => ({
        [CARD_NAME]: { Front: CARD_FRONT, Back: CARD_BACK },
      }),
      modelStyling: () => ({
        css: '.word { color: #1b5e9c; }\n.phonetic { color: #6b7488; }\n.tags { color: #8a93a5; }',
      }),
    });

    await ensureAnkiModel();

    const update = calls.find(
      (c) => c['action'] === 'updateModelStyling',
    ) as { params: { model: { css: string } } };
    expect(update).toBeDefined();
    expect(update.params.model.css).toContain('.spell');
  });

  it('reinstalls a back template that predates the 拼写 block', async () => {
    // Regression sentinel: every one of the nine fields is present, so the
    // OLD check passed — yet the 拼写 block is missing, and existing decks
    // would never receive it.
    const backWithoutSpell = CARD_BACK.replace(SPELL_SECTION, '');
    expect(backWithoutSpell).not.toContain('拼写');
    expect(backWithoutSpell).toContain('{{词汇标记}}');

    const calls = trackCalls({
      modelNames: () => [ANKI_MODEL_NAME],
      modelFieldNames: () => [...ANKI_FIELDS],
      modelTemplates: () => ({
        [CARD_NAME]: { Front: CARD_FRONT, Back: backWithoutSpell },
      }),
      modelStyling: () => ({ css: ANKI_CSS }),
    });

    const status = await ensureAnkiModel();

    expect(status.templatesUpdated).toBe(true);
    const update = calls.find(
      (c) => c['action'] === 'updateModelTemplates',
    ) as {
      params: { model: { templates: Record<string, { Back: string }> } };
    };
    expect(update).toBeDefined();
    expect(update.params.model.templates[CARD_NAME]!.Back).toContain('拼写');
  });

  it('reinstalls styling that has the old letter-spaced .spell rule', async () => {
    // Regression sentinel for the redo: an install from the previous release
    // already contains `.spell`, so a `.spell`-based check would call it fresh
    // and the blank-underline CSS would never be pushed. Rebuild that old
    // stylesheet from the current one — old `.spell` body, no blank CSS.
    const oldSpacedSpellCss = ANKI_CSS.replace(
      /\.spell \{[\s\S]*?\n\}/,
      '.spell {\n  font-weight: 600;\n  letter-spacing: 0.35em;\n  color: #1b5e9c;\n}',
    ).replace(
      /\.night_mode \.spell,\n\.nightMode \.spell \{[\s\S]*?\n\}/,
      '.night_mode .spell,\n.nightMode .spell {\n  color: #7fb6e8;\n}',
    );
    // Guard the derivation so the test can never silently become a no-op.
    expect(oldSpacedSpellCss).toContain('.spell');
    expect(oldSpacedSpellCss).toContain('letter-spacing: 0.35em');
    expect(oldSpacedSpellCss).not.toContain('background-size: 1ch');

    const calls = trackCalls({
      modelNames: () => [ANKI_MODEL_NAME],
      modelFieldNames: () => [...ANKI_FIELDS],
      // Template is unchanged, so it must NOT be rewritten — this fix is
      // CSS-only, which is exactly why every install picks it up instantly.
      modelTemplates: () => ({
        [CARD_NAME]: { Front: CARD_FRONT, Back: CARD_BACK },
      }),
      modelStyling: () => ({ css: oldSpacedSpellCss }),
    });

    await ensureAnkiModel();

    const update = calls.find(
      (c) => c['action'] === 'updateModelStyling',
    ) as { params: { model: { css: string } } };
    expect(update).toBeDefined();
    expect(update.params.model.css).toContain('background-size: 1ch');
    expect(calls.some((c) => c['action'] === 'updateModelTemplates')).toBe(false);
  });
});

describe('syncVocabToAnki with the built-in note type', () => {
  it('writes all nine fields, dictionary metadata included', async () => {
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
      [
        {
          ...entry('chores'),
          definition: 'n. 家务活',
          translation: '我得做家务。',
          meta: {
            phonetic: 'tʃɔːz',
            definition: 'a routine task',
            pos: 'n:100',
            forms: { lemma: 'chore', plural: 'chores' },
          },
        },
      ],
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
      音标: 'tʃɔːz',
      英文释义: 'a routine task',
      词形变化: '原形 chore · 复数 chores',
      词性分布: 'n:100',
      词汇标记: '',
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
