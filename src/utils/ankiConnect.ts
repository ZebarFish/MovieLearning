/**
 * ankiConnect.ts
 *
 * Direct integration with the AnkiConnect plugin (code 2055492159) that
 * exposes a local HTTP API on Anki desktop (default http://127.0.0.1:8765).
 * Lets the app push vocabulary cards into Anki with one click — no manual
 * .txt import needed.
 *
 * Prerequisites for the user:
 *   1. Anki desktop installed and running.
 *   2. AnkiConnect add-on installed (Tools → Add-ons → Get Add-ons, code
 *      2055492159), then restart Anki.
 *   3. For browser CORS: the add-on config `webCorsOriginList` must include
 *      this app's origin (e.g. "http://localhost:5180") or "*".
 */
import type { VocabWord } from '../types';
import { formatTime } from './subtitleParser';
import {
  ANKI_CSS,
  ANKI_FIELDS,
  ANKI_MODEL_NAME,
  CARD_NAME,
  FIELD_DEFINITION,
  FIELD_ENGLISH_DEFINITION,
  FIELD_FORMS,
  FIELD_LEXICAL_TAGS,
  FIELD_PHONETIC,
  FIELD_POS,
  FIELD_SENTENCE,
  FIELD_TRANSLATION,
  FIELD_WORD,
  TTS_EXPRESSION,
  buildAnkiModelPayload,
  buildCardTemplates,
  buildTemplateMap,
} from './ankiTemplate';
import { formatForms, formatLexicalTags } from './wordMeta';

export const ANKI_CONNECT_URL = 'http://127.0.0.1:8765';

interface AnkiResponse<T> {
  result: T;
  error: string | null;
}

async function invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ANKI_CONNECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });
  if (!res.ok) {
    throw new Error(`AnkiConnect HTTP ${res.status}`);
  }
  const data = (await res.json()) as AnkiResponse<T>;
  if (data.error) {
    throw new Error(data.error);
  }
  return data.result;
}

export interface AnkiConnectionStatus {
  ok: boolean;
  version?: string;
  error?: string;
}

/** Ping AnkiConnect. Resolves with ok=false instead of throwing on failure. */
export async function checkAnkiConnection(): Promise<AnkiConnectionStatus> {
  try {
    const version = await invoke<number>('version');
    return { ok: true, version: String(version) };
  } catch (err) {
    return {
      ok: false,
      error:
        '无法连接 Anki (127.0.0.1:8765)。请确认:① Anki 桌面版已打开 ② 已安装 AnkiConnect 插件 (code 2055492159) 并重启 Anki ③ 插件配置 webCorsOriginList 加入 "http://localhost:5180" 或 "*"。' +
        ((err as Error).message ? ` (${(err as Error).message})` : ''),
    };
  }
}

export interface DuplicateInfo {
  word: string;
  /** Deck where the existing (duplicate) card lives. */
  deck: string;
}

export interface SyncResult {
  /** Number of notes actually created. */
  added: number;
  /** Words skipped because they already exist IN THE TARGET DECK. */
  duplicates: DuplicateInfo[];
  /** Words that failed with an unexpected error. */
  failed: string[];
}

/**
 * Local record of words we have already synced, per deck. This is the PRIMARY
 * dedupe source because Anki search (findCards) proved unreliable in the
 * field: some Anki/AnkiConnect combos drop `front:` terms and quoted
 * `deck:"..."` filters, which silently defeats search-based dedupe and leads
 * to duplicate cards.
 *
 * But a record that only ever grows goes stale the moment the user deletes a
 * card in Anki: the word is skipped as a "duplicate" forever even though the
 * deck is empty. So each entry carries the `noteId` we created, which lets us
 * ask Anki directly whether the note still exists.
 */
const SYNCED_KEY = 'learnTV.anki.syncedWords.v1';

/**
 * One word we pushed into Anki, plus the id of the note created for it.
 * `noteId` is absent on records written by older versions. `manual` marks
 * entries the user set by hand in the vocabulary panel (e.g. they imported
 * the word into Anki some other way) — those are trusted as-is and never
 * re-verified, so the sync never overrides a human decision.
 */
interface SyncedNote {
  word: string;
  noteId?: number;
  manual?: boolean;
}

/** Read the record, upgrading the legacy `string[]` shape on the way. */
function loadSyncedNotes(): Record<string, SyncedNote[]> {
  const out: Record<string, SyncedNote[]> = {};
  try {
    const raw = localStorage.getItem(SYNCED_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [deck, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const list: SyncedNote[] = [];
      for (const item of value) {
        if (typeof item === 'string') {
          list.push({ word: item });
        } else if (item && typeof (item as SyncedNote).word === 'string') {
          list.push(item as SyncedNote);
        }
      }
      out[deck] = list;
    }
  } catch {
    /* corrupt record — start clean rather than blocking every sync */
  }
  return out;
}

function saveSyncedNotes(all: Record<string, SyncedNote[]>): void {
  try {
    localStorage.setItem(SYNCED_KEY, JSON.stringify(all));
  } catch {
    /* non-fatal */
  }
}

/** Remember a word we just created a note for, along with that note's id. */
function rememberSynced(deck: string, word: string, noteId: number): void {
  const all = loadSyncedNotes();
  const list = all[deck] ?? [];
  const existing = list.find((r) => r.word === word);
  if (existing) {
    existing.noteId = noteId;
  } else {
    list.push({ word, noteId });
  }
  all[deck] = list;
  saveSyncedNotes(all);
}

/** Drop words from the record — their notes no longer exist in Anki. */
function forgetSynced(deck: string, words: string[]): void {
  if (words.length === 0) return;
  const gone = new Set(words);
  const all = loadSyncedNotes();
  const list = (all[deck] ?? []).filter((r) => !gone.has(r.word));
  if (list.length > 0) {
    all[deck] = list;
  } else {
    delete all[deck];
  }
  saveSyncedNotes(all);
}

/**
 * Lowercase words currently recorded as synced for the deck. Display/filter
 * source for the vocabulary panel — no Anki round-trip, so a word the user
 * deleted in Anki may still show as synced here until the next sync runs its
 * verification pass.
 */
export function getSyncedWords(deck: string): Set<string> {
  return new Set((loadSyncedNotes()[deck] ?? []).map((r) => r.word));
}

/**
 * User override from the vocabulary panel. `synced=false` drops the record so
 * the next sync re-adds the word; `synced=true` writes a manual entry that
 * dedupe trusts without Anki verification (see SyncedNote.manual).
 */
export function setWordSyncedManually(
  deck: string,
  word: string,
  synced: boolean,
): void {
  const key = word.trim().toLowerCase();
  if (!key) return;
  if (!synced) {
    forgetSynced(deck, [key]);
    return;
  }
  const all = loadSyncedNotes();
  const list = all[deck] ?? [];
  const existing = list.find((r) => r.word === key);
  if (existing) {
    existing.manual = true;
  } else {
    list.push({ word: key, manual: true });
  }
  all[deck] = list;
  saveSyncedNotes(all);
}

/**
 * Which of the given note ids still exist in Anki.
 *
 * `notesInfo` answers by ID — no search involved, so none of the query quirks
 * that made us distrust search apply. It returns one entry per requested id,
 * positionally aligned, and an EMPTY OBJECT for an id that no longer exists
 * (AnkiConnect appends `{}` on its NotFoundError branch). Returns null when
 * verification isn't possible, so callers can fail safe and keep trusting the
 * local record rather than re-adding duplicates.
 */
async function existingNoteIds(ids: number[]): Promise<Set<number> | null> {
  if (ids.length === 0) return new Set();
  try {
    const infos = await invoke<Record<string, unknown>[]>('notesInfo', {
      notes: ids,
    });
    // A short/long response means the reply can't be trusted positionally.
    if (!Array.isArray(infos) || infos.length !== ids.length) return null;
    const alive = new Set<number>();
    infos.forEach((info, i) => {
      if (info && Object.keys(info).length > 0) alive.add(ids[i]!);
    });
    return alive;
  } catch {
    return null;
  }
}

/**
 * Words collected by this app carry our tag; read their Front values.
 * `ok` distinguishes "Anki has none" from "the query didn't work" — the
 * caller may only conclude a note was deleted when the query actually ran.
 */
async function getTaggedWords(): Promise<{ words: Set<string>; ok: boolean }> {
  const words = new Set<string>();
  try {
    const noteIds = await invoke<number[]>('findNotes', {
      query: 'tag:听美剧学英语',
    });
    // notesInfo accepts at most ~500 notes per call; chunk defensively.
    for (let i = 0; i < noteIds.length; i += 500) {
      const chunk = noteIds.slice(i, i + 500);
      const infos = await invoke<
        { fields: Record<string, { value: string }> }[]
      >('notesInfo', { notes: chunk });
      for (const n of infos) {
        const first = Object.values(n.fields)[0]?.value;
        if (first) words.add(first.trim().toLowerCase());
      }
    }
  } catch {
    /* search unavailable — local record still covers the common case */
    return { words, ok: false };
  }
  return { words, ok: true };
}

/**
 * Push vocabulary entries into Anki.
 *
 * Duplicate semantics — the local record is authoritative for the target deck,
 * but it is VERIFIED against Anki first so it can never go stale:
 *   1. Entries carrying a `noteId` are checked with `notesInfo`. A note the
 *      user deleted in Anki comes back as `{}` and is dropped from the record,
 *      so its word is offered for sync again instead of being skipped forever.
 *   2. Legacy entries (no `noteId`) fall back to the `tag:听美剧学英语` query —
 *      when that query works, a word missing from its result was deleted.
 *   3. If neither check is available the record is trusted as-is: never
 *      re-add a duplicate just because verification failed.
 *
 * On top of that, any note this app has ever created carries our tag, and a
 * word found there is treated as a duplicate regardless of deck — Anki's
 * global per-note-type dedupe is otherwise bypassed via allowDuplicate: true.
 *
 * Note-type adaptation: the nine card fields are written by NAME when the
 * target model has them (our "听美剧学英语" template — see ankiTemplate.ts),
 * and positionally otherwise, so a user's own note type still receives as
 * much content as it can hold. addNotes results are checked for real —
 * nulls become failures with the reason surfaced.
 *
 * Entries are expected to be enriched first (see vocabEnrich.ts) so that
 * 单词释义 / 例句释义 / the lexical metadata are populated; missing values are
 * written as empty strings rather than dropping the note.
 */
export async function syncVocabToAnki(
  entries: VocabWord[],
  deck: string,
  noteType: string,
  _allowDuplicate?: boolean, // deprecated param, kept for API compatibility
): Promise<SyncResult> {
  if (entries.length === 0) {
    return { added: 0, duplicates: [], failed: [] };
  }

  // 0) Validate deck & note type up front, with actionable errors. Our own
  //    template is created (or repaired) on demand so the sync can always
  //    fill all four fields.
  if (noteType === ANKI_MODEL_NAME) {
    await ensureAnkiModel();
  }
  const decks = await listAnkiDecks();
  if (!decks.includes(deck)) {
    throw new Error(
      `牌组「${deck}」不存在。可用牌组: ${decks.slice(0, 8).join('、')}${decks.length > 8 ? '…' : ''}`,
    );
  }
  const models = await listAnkiNoteTypes();
  if (!models.includes(noteType)) {
    throw new Error(
      `笔记类型「${noteType}」不存在。可用类型: ${models.slice(0, 8).join('、')}${models.length > 8 ? '…' : ''}`,
    );
  }
  const fields = await invoke<string[]>('modelFieldNames', {
    modelName: noteType,
  });
  if (!fields || fields.length < 2) {
    throw new Error(
      `笔记类型「${noteType}」字段不足两个,无法存放单词和例句。`,
    );
  }

  // 1) Deck-scoped duplicate pre-check. The local record is trusted, but it
  //    is verified against Anki first so a note deleted in Anki stops
  //    blocking its word forever.
  const recorded = loadSyncedNotes()[deck] ?? [];
  const tagged = await getTaggedWords();

  const kept: SyncedNote[] = [];
  const deletedInAnki: string[] = [];

  // (a) Entries with a note id — ask Anki whether those notes still exist.
  const withId = recorded.filter((r) => typeof r.noteId === 'number');
  const withoutId = recorded.filter((r) => typeof r.noteId !== 'number');
  if (withId.length > 0) {
    const alive = await existingNoteIds(withId.map((r) => r.noteId!));
    for (const r of withId) {
      if (alive === null || alive.has(r.noteId!)) {
        // alive === null → could not verify; keep it (fail safe, never
        // re-add a duplicate just because the check was unavailable).
        kept.push(r);
      } else {
        deletedInAnki.push(r.word);
      }
    }
  }

  // (b) Legacy entries written before note ids existed — the tag query is the
  //     only handle on them, and only a query that actually ran can prove a
  //     word is gone. Manually marked entries skip verification entirely:
  //     the user said this word is synced, so it stays synced.
  for (const r of withoutId) {
    if (r.manual || !tagged.ok || tagged.words.has(r.word)) {
      kept.push(r);
    } else {
      deletedInAnki.push(r.word);
    }
  }

  if (deletedInAnki.length > 0) forgetSynced(deck, deletedInAnki);
  const syncedLocal = new Set(kept.map((r) => r.word));

  const toAdd: VocabWord[] = [];
  const duplicates: DuplicateInfo[] = [];
  for (const e of entries) {
    const key = e.word.trim().toLowerCase();
    if (syncedLocal.has(key) || tagged.words.has(key)) {
      duplicates.push({ word: e.surface, deck });
    } else {
      toAdd.push(e);
    }
  }

  // 2) Add everything not already in the target deck, and CHECK the results.
  let added = 0;
  const failed: string[] = [];
  if (toAdd.length > 0) {
    const notes = toAdd.map((e) => ({
      deckName: deck,
      modelName: noteType,
      fields: buildNoteFields(fields, e),
      options: { allowDuplicate: true },
      tags: ['听美剧学英语', e.video.replace(/[^\w-]+/g, '_')].filter(Boolean),
    }));
    const results = await invoke<(number | null)[]>('addNotes', { notes });
    const createdNoteIds: number[] = [];
    results.forEach((r, i) => {
      if (typeof r === 'number') {
        added += 1;
        createdNoteIds.push(r);
        rememberSynced(deck, toAdd[i]!.word.trim().toLowerCase(), r);
      } else {
        failed.push(toAdd[i]!.surface);
      }
    });

    // 3) Work around AnkiConnect/Anki version quirks where addNotes ignores
    //    deckName and drops cards into the default deck: verify each new
    //    card's actual deck and move it if needed (changeDeck is a stable
    //    old API). Verified against AnkiConnect 23.10.29 + older Anki.
    if (createdNoteIds.length > 0) {
      const createdSet = new Set(createdNoteIds);
      const wrongCardIds: number[] = [];
      try {
        const notesInfo = await invoke<
          { cards: number[] }[]
        >('notesInfo', { notes: createdNoteIds });
        const allCardIds = notesInfo.flatMap((n) => n.cards ?? []);
        const cardsInfo = await invoke<
          { cardId: number; deckName?: string }[]
        >('cardsInfo', { cards: allCardIds });
        for (const c of cardsInfo) {
          if (c.deckName && c.deckName !== deck) {
            wrongCardIds.push(c.cardId);
          }
        }
        if (wrongCardIds.length > 0) {
          await invoke('changeDeck', {
            cards: wrongCardIds,
            deck,
          });
        }
      } catch {
        /* best-effort fixup: never fail the whole sync here */
      }
    }
  }

  return { added, duplicates, failed };
}

/** List available deck names (used to prefill the deck picker). */
export async function listAnkiDecks(): Promise<string[]> {
  return invoke<string[]>('deckNames');
}

/** List available note type (model) names. */
export async function listAnkiNoteTypes(): Promise<string[]> {
  return invoke<string[]>('modelNames');
}

/**
 * Build the AnkiConnect `fields` object for one vocabulary entry.
 *
 * If the target model exposes all nine of our field names we fill them
 * exactly — that's our own template, where 例句 stays clean and the
 * pronunciation comes from the card's `{{tts en_US:单词}}`. The five
 * dictionary-derived fields (音标 / 英文释义 / 词形变化 / 词性分布 /
 * 词汇标记) are taken from `entry.meta` and default to '' when unknown —
 * never `undefined`. `formatForms` / `formatLexicalTags` (from wordMeta.ts)
 * are reused so the Anki content matches the word card UI exactly.
 *
 * Any other note type is filled positionally (field 1 = 单词, field 2 =
 * 单词释义, …) and, when it has fewer than four fields, the leftover content
 * — plus the video/timestamp breadcrumb — is folded into the last field so
 * nothing is silently lost.
 */
export function buildNoteFields(
  fields: string[],
  entry: VocabWord,
): Record<string, string> {
  const definition = entry.definition?.trim() ?? '';
  const sentence = entry.sentence.trim();
  const translation = entry.translation?.trim() ?? '';
  const source = `${entry.video} · ${formatTime(entry.time)}`;

  const mapped: Record<string, string> = {};

  if (ANKI_FIELDS.every((f) => fields.includes(f))) {
    mapped[FIELD_WORD] = entry.surface;
    mapped[FIELD_DEFINITION] = definition;
    mapped[FIELD_SENTENCE] = sentence;
    mapped[FIELD_TRANSLATION] = translation;
    mapped[FIELD_PHONETIC] = entry.meta?.phonetic ?? '';
    mapped[FIELD_ENGLISH_DEFINITION] = entry.meta?.definition ?? '';
    mapped[FIELD_FORMS] = formatForms(entry.meta);
    mapped[FIELD_POS] = entry.meta?.pos ?? '';
    mapped[FIELD_LEXICAL_TAGS] = formatLexicalTags(entry.meta);
    return mapped;
  }

  const [first, second, third, fourth] = fields;
  if (!first) return mapped;
  mapped[first] = entry.surface;
  const tail = [sentence, translation, source].filter(Boolean);

  if (fields.length >= 4 && second && third && fourth) {
    mapped[second] = definition;
    mapped[third] = sentence;
    mapped[fourth] = [translation, source].filter(Boolean).join('\n\n');
  } else if (fields.length === 3 && second && third) {
    mapped[second] = definition;
    mapped[third] = tail.join('\n\n');
  } else if (second) {
    mapped[second] = [definition, ...tail].filter(Boolean).join('\n\n');
  }

  return mapped;
}

export interface AnkiModelStatus {
  name: string;
  /** True when the model had to be created from scratch. */
  created: boolean;
  /** Fields that were missing on an existing model and got added. */
  addedFields: string[];
  /** True when the card template / styling was (re)installed. */
  templatesUpdated: boolean;
  /** The model's field names after the operation. */
  fields: string[];
}

/**
 * Create the "听美剧学英语" note type, or repair an existing copy of it.
 *
 * Repairing is deliberately conservative: fields are only ADDED, and the
 * card template is only rewritten when it is missing or no longer contains
 * the pronunciation/definition expressions. A template the user has
 * deliberately customised is left alone.
 */
export async function ensureAnkiModel(): Promise<AnkiModelStatus> {
  const models = await listAnkiNoteTypes();
  if (!models.includes(ANKI_MODEL_NAME)) {
    await invoke('createModel', buildAnkiModelPayload());
    return {
      name: ANKI_MODEL_NAME,
      created: true,
      addedFields: [],
      templatesUpdated: true,
      fields: [...ANKI_FIELDS],
    };
  }

  const fields = await invoke<string[]>('modelFieldNames', {
    modelName: ANKI_MODEL_NAME,
  });
  const addedFields: string[] = [];
  for (const field of ANKI_FIELDS) {
    if (!fields.includes(field)) {
      await invoke('modelFieldAdd', {
        modelName: ANKI_MODEL_NAME,
        fieldName: field,
        index: fields.length,
      });
      fields.push(field);
      addedFields.push(field);
    }
  }

  let templates: Record<string, { Front: string; Back: string }> = {};
  try {
    templates = await invoke<Record<string, { Front: string; Back: string }>>(
      'modelTemplates',
      { modelName: ANKI_MODEL_NAME },
    );
  } catch {
    /* treat as "no usable template" and reinstall ours */
  }

  const ours = templates[CARD_NAME];
  // A template installed before the nine-field model has the TTS line and the
  // original four sections but none of the dictionary-derived ones, so those
  // are checked too — otherwise an existing deck would never be upgraded.
  const templateStale =
    !ours ||
    !ours.Front.includes(TTS_EXPRESSION) ||
    !ours.Front.includes(FIELD_PHONETIC) ||
    !ours.Back.includes(FIELD_TRANSLATION) ||
    !ours.Back.includes(FIELD_DEFINITION) ||
    !ours.Back.includes(FIELD_ENGLISH_DEFINITION) ||
    !ours.Back.includes(FIELD_FORMS) ||
    !ours.Back.includes(FIELD_LEXICAL_TAGS);

  let templatesUpdated = false;
  if (templateStale) {
    await invoke('updateModelTemplates', {
      model: { name: ANKI_MODEL_NAME, templates: buildTemplateMap() },
    });
    templatesUpdated = true;
  }

  try {
    const styling = await invoke<{ css?: string }>('modelStyling', {
      modelName: ANKI_MODEL_NAME,
    });
    // Same reasoning as the template check above: CSS installed before the
    // nine-field model carries `.word` but none of the newer rules, so testing
    // for `.word` alone would leave 音标 / 词汇标记 unstyled forever.
    const css = styling?.css ?? '';
    const stylingStale =
      !css.includes('.word') ||
      !css.includes('.phonetic') ||
      !css.includes('.tags');
    if (stylingStale) {
      await invoke('updateModelStyling', {
        model: { name: ANKI_MODEL_NAME, css: ANKI_CSS },
      });
    }
  } catch {
    /* styling is cosmetic — never fail the sync over it */
  }

  return {
    name: ANKI_MODEL_NAME,
    created: false,
    addedFields,
    templatesUpdated,
    fields,
  };
}
