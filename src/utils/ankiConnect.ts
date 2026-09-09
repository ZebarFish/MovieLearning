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
 */
const SYNCED_KEY = 'learnTV.anki.syncedWords.v1';

function loadSyncedWords(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(SYNCED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function saveSyncedWord(deck: string, word: string): void {
  try {
    const all = loadSyncedWords();
    const list = all[deck] ?? [];
    if (!list.includes(word)) {
      list.push(word);
      all[deck] = list;
      localStorage.setItem(SYNCED_KEY, JSON.stringify(all));
    }
  } catch {
    /* non-fatal */
  }
}

/** Words collected by this app carry our tag; read their Front values. */
async function getTaggedWords(): Promise<Set<string>> {
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
  }
  return words;
}

/**
 * Push vocabulary entries into Anki.
 *
 * Duplicate semantics: scoped to the target deck, via TWO search-free
 * sources (Anki findCards proved unreliable in the field):
 *   1. localStorage record of words this app already synced to that deck.
 *   2. All notes tagged 听美剧学英语 — match on their first field value.
 * Words that exist only in OTHER decks are still added (Anki's global
 * per-note-type dedupe is bypassed via allowDuplicate: true).
 *
 * Note-type adaptation: field names are NOT hard-coded. Many collections
 * (especially Chinese-localized or imported ones) don't have a "Basic" model
 * with Front/Back. We read the model's real field names and use the first
 * field as the word, the second as the example sentence. addNotes results
 * are checked for real — nulls become failures with the reason surfaced.
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

  // 0) Validate deck & note type up front, with actionable errors.
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
  const [frontField, backField] = fields;

  // 1) Deck-scoped duplicate pre-check (search-free sources only).
  const syncedLocal = new Set(loadSyncedWords()[deck] ?? []);
  const taggedWords = await getTaggedWords();
  const toAdd: VocabWord[] = [];
  const duplicates: DuplicateInfo[] = [];
  for (const e of entries) {
    const key = e.word.trim().toLowerCase();
    if (syncedLocal.has(key) || taggedWords.has(key)) {
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
      fields: {
        [frontField]: e.surface,
        [backField]: `${e.sentence}\n\n— ${e.video} · ${formatTime(e.time)}`,
      },
      options: { allowDuplicate: true },
      tags: ['听美剧学英语', e.video.replace(/[^\w-]+/g, '_')].filter(Boolean),
    }));
    const results = await invoke<(number | null)[]>('addNotes', { notes });
    const createdNoteIds: number[] = [];
    results.forEach((r, i) => {
      if (typeof r === 'number') {
        added += 1;
        createdNoteIds.push(r);
        saveSyncedWord(deck, toAdd[i]!.word.trim().toLowerCase());
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
