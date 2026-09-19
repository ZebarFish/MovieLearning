/**
 * dictionary.ts
 *
 * Word lookup, offline first.
 *
 * Step 0 is a LOCAL dictionary — the ECDICT database (340 万词条, MIT) served
 * by `server/dictionary.mjs` at `/dict/offline`. It answers in about a
 * millisecond, never touches the network, and returns Chinese definitions.
 * Only when it misses do we go online: the free Dictionary API
 * (https://dictionaryapi.dev/), then Youdao (Chinese definitions), then
 * Datamuse (WordNet). Inflected forms (chores → chore) are resolved on both
 * the offline and the online path.
 */
import { USE_LOCAL_PROXY } from './localProxy';

export interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: string[];
}

export interface WordDefinition {
  /** The queried word in canonical form. */
  word: string;
  /** IPA pronunciation, if available. */
  phonetic?: string;
  /** Optional URL to an audio pronunciation. */
  audio?: string;
  /** Short meaning groups. */
  meanings: DictionaryMeaning[];
  /** The surface form the user clicked, when it differed from `word`. */
  queried?: string;
}

interface RawDefinition {
  definition: string;
  example?: string;
}

interface RawMeaning {
  partOfSpeech: string;
  definitions: RawDefinition[];
}

interface RawPhonetic {
  text?: string;
  audio?: string;
}

interface RawEntry {
  word: string;
  phonetic?: string;
  phonetics?: RawPhonetic[];
  meanings: RawMeaning[];
}

const CACHE = new Map<string, WordDefinition | null>();

/** Reset the in-memory lookup cache (used by tests). */
export function clearDictionaryCache(): void {
  CACHE.clear();
}

/**
 * Both the dev server (`vite`) and the local preview server
 * (`vite preview`) proxy /dict/* to the external APIs server-side — no
 * CORS, no CN-network flakiness. Outside those servers (tests, a build
 * deployed to a real host) the absolute URLs are used directly.
 */
const DICT_API = USE_LOCAL_PROXY
  ? '/dict/api/v2/entries/en'
  : 'https://api.dictionaryapi.dev/api/v2/entries/en';
const YOUDAO = USE_LOCAL_PROXY
  ? '/dict/youdao/jsonresult'
  : 'https://dict.youdao.com/jsonresult';
const DATAMUSE = USE_LOCAL_PROXY
  ? '/dict/datamuse/words'
  : 'https://api.datamuse.com/words';

/**
 * Local offline dictionary, served by the Vite middleware in
 * `server/dictionary.mjs`. It only exists while the app is served by the
 * local dev/preview server, so outside that (tests, a build deployed to a
 * real host) this is `null` and the online chain runs instead.
 */
const OFFLINE = USE_LOCAL_PROXY ? '/dict/offline' : null;

/** The shape returned by `GET /dict/offline?w=<word>`. */
interface OfflineEntry {
  word?: string;
  phonetic?: string;
  /** Chinese definitions, several lines joined by a LITERAL `\n`. */
  translation?: string;
  /** English definitions, same literal-`\n` convention. */
  definition?: string;
}

/**
 * ECDICT writes line breaks inside `translation` / `definition` as two
 * literal characters — a backslash followed by an `n` — not as U+000A.
 * This is that two-character sequence, not an escape for a newline.
 */
const ECDICT_LINE_SEP = '\\n';

/**
 * ECDICT phonetics come in several shapes: `ˈfjuːnərəl`, `[ˈænɪməl]`, and
 * `英 [ˈfjuːnərəl] 美 [ˈfjuːnərəl]`. Keep just the IPA itself.
 */
function cleanPhonetic(raw: string | undefined): string | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;
  const bracketed = text.match(/\[([^\]]+)\]/);
  const out = (bracketed ? bracketed[1] : text.replace(/[[\]]/g, '')).trim();
  return out || undefined;
}

/** Turns one ECDICT line ("n. 日常杂务，家务活；苦差事") into a meaning group. */
function parseEcdictLine(
  line: string,
): { partOfSpeech: string; definitions: string[] } | null {
  const m = line.match(/^([a-z]+\.)\s*(.+)$/i);
  const partOfSpeech = m ? m[1] : '';
  const body = m ? m[2] : line;
  const definitions = body
    .split(/[；;]/)
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(0, 3);
  return definitions.length > 0 ? { partOfSpeech, definitions } : null;
}

/**
 * Maps an ECDICT record onto the app's `WordDefinition`. Chinese wins over
 * English; a record with neither is treated as a miss.
 *
 * Lines that share a part of speech are merged into one group — ECDICT
 * frequently emits "n. …" on two separate lines, and the UI renders one card
 * per group keyed by part of speech.
 */
function offlineEntryToDefinition(entry: OfflineEntry): WordDefinition | null {
  const source =
    (entry.translation ?? '').trim() || (entry.definition ?? '').trim();
  if (!source) return null;

  const groups = new Map<string, string[]>();
  for (const rawLine of source.split(ECDICT_LINE_SEP)) {
    const parsed = parseEcdictLine(rawLine.trim());
    if (!parsed) continue;
    const list = groups.get(parsed.partOfSpeech) ?? [];
    list.push(...parsed.definitions);
    groups.set(parsed.partOfSpeech, list);
  }

  const meanings = [...groups.entries()]
    .map(([partOfSpeech, definitions]) => ({
      partOfSpeech,
      definitions: definitions.slice(0, 3),
    }))
    .filter((m) => m.definitions.length > 0);
  if (meanings.length === 0) return null;

  return {
    word: (entry.word ?? '').trim(),
    phonetic: cleanPhonetic(entry.phonetic),
    meanings,
  };
}

/**
 * Step 0 of a lookup: the local ECDICT database. Returns null on any
 * miss or failure (404 unknown word, 503 index not built, server absent,
 * timeout) so the online chain can take over. Never throws.
 *
 * `queried` is deliberately left to the caller: ECDICT canonicalises the
 * casing of proper nouns, so comparing `form` with `entry.word` here would
 * wrongly flag `london` as an inflection of `London`.
 */
async function fetchFromOffline(form: string): Promise<WordDefinition | null> {
  if (!OFFLINE) return null;
  try {
    const res = await fetch(`${OFFLINE}?w=${encodeURIComponent(form)}`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    return offlineEntryToDefinition((await res.json()) as OfflineEntry);
  } catch {
    return null;
  }
}

const POS_TAGS: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  u: '',
};

interface DatamuseItem {
  word: string;
  defs?: string[];
  defHeadword?: string;
}

/**
 * Backup source (Datamuse / WordNet) — highly reliable and it resolves
 * inflected forms natively (querying "chores" returns defs with
 * defHeadword "chore"). Returns null on any failure.
 */
async function fetchFromDatamuse(form: string): Promise<WordDefinition | null> {
  const res = await fetch(
    `${DATAMUSE}?sp=${encodeURIComponent(form)}&md=d&max=1`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as DatamuseItem[];
  const item = data[0];
  if (!item?.defs?.length) return null;

  const groups = new Map<string, string[]>();
  for (const raw of item.defs) {
    const tab = raw.indexOf('\t');
    if (tab === -1) continue;
    const tag = raw.slice(0, tab);
    const text = raw.slice(tab + 1).trim();
    if (!text) continue;
    const pos = POS_TAGS[tag] ?? tag;
    const list = groups.get(pos) ?? [];
    list.push(text);
    groups.set(pos, list);
  }
  const meanings = [...groups.entries()]
    .map(([partOfSpeech, definitions]) => ({
      partOfSpeech,
      definitions: definitions.slice(0, 3),
    }))
    .filter((m) => m.definitions.length > 0);
  if (meanings.length === 0) return null;

  const headword = item.defHeadword ?? item.word;
  return {
    word: headword,
    meanings,
    queried: form !== headword ? form : undefined,
  };
}

/**
 * Morphological fallbacks for inflected forms (chores→chore, studies→study,
 * running→run, baked→bake …). Ordered most-likely-first; the original word
 * is NOT included — callers try it themselves.
 */
export function morphologicalVariants(word: string): string[] {
  const out: string[] = [];
  const push = (s: string): void => {
    if (s.length >= 3 && /^[a-z'-]+$/.test(s) && !out.includes(s)) out.push(s);
  };
  if (word.endsWith('ies') && word.length > 4) push(word.slice(0, -3) + 'y');
  if (word.endsWith('ves')) push(word.slice(0, -3) + 'f');
  if (word.endsWith('es')) {
    push(word.slice(0, -2)); // watches → watch
    push(word.slice(0, -1)); // chores → chore (does not end in a real -es)
  }
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('is')) {
    push(word.slice(0, -1)); // errands → errand
  }
  if (word.endsWith('ing')) {
    const b = word.slice(0, -3);
    push(b + 'e'); // making → make
    push(b); // doing → do
    if (b.length >= 3 && b[b.length - 1] === b[b.length - 2]) {
      push(b.slice(0, -1)); // running → run
    }
  }
  if (word.endsWith('ed')) {
    const b = word.slice(0, -2);
    if (word.endsWith('ied')) push(word.slice(0, -3) + 'y'); // carried → carry
    push(b + 'e'); // baked → bake
    push(b); // walked → walk
    if (b.length >= 3 && b[b.length - 1] === b[b.length - 2]) {
      push(b.slice(0, -1)); // stopped → stop
    }
  }
  if (word.endsWith('er') && word.length > 4) {
    const b = word.slice(0, -2);
    if (b.length >= 3 && b[b.length - 1] === b[b.length - 2]) {
      push(b.slice(0, -1)); // bigger → big
    }
  }
  return out;
}

/**
 * Single API fetch for one form.
 * - WordDefinition → found
 * - null → definitive "word not found" (HTTP 404 / empty entry)
 * - 'error' → network failure (source unreachable)
 */
async function fetchEntry(
  form: string,
): Promise<WordDefinition | null | 'error'> {
  try {
    const res = await fetch(
      `${DICT_API}/${encodeURIComponent(form)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null; // definitive 404 — no point retrying
    const data = (await res.json()) as RawEntry[];
    const entry = data[0];
    if (!entry || !entry.meanings?.length) return null;

    const phonetic =
      entry.phonetic ??
      entry.phonetics?.find((p) => p.text && p.audio)?.text ??
      entry.phonetics?.find((p) => p.text)?.text;
    const audio = entry.phonetics?.find((p) => p.audio)?.audio || undefined;

    return {
      word: entry.word,
      phonetic,
      audio,
      meanings: (entry.meanings || [])
        .map((m) => ({
          partOfSpeech: m.partOfSpeech,
          definitions: (m.definitions || [])
            .slice(0, 3)
            .map((d) => d.definition),
        }))
        .filter((m) => m.definitions.length > 0),
    };
  } catch {
    // Network / timeout — signal the caller to skip this flaky source.
    return 'error';
  }
}

/**
 * Third source: Youdao public jsonresult endpoint — Chinese definitions
 * (most useful for CN learners) + IPA; its `basic` text even annotates
 * inflections ("（chore 的复数）"). Unofficial API: treat as best-effort.
 */
async function fetchFromYoudao(form: string): Promise<WordDefinition | null> {
  const res = await fetch(
    `${YOUDAO}?q=${encodeURIComponent(form)}&type=1&le=eng`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    basic?: string[] | string;
    ussm?: string;
    uksm?: string;
  };

  const rawBasic = Array.isArray(data.basic)
    ? data.basic
    : data.basic
      ? [data.basic]
      : [];
  const meanings = rawBasic
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Split "n. 日常杂务，家务活；苦差事（chore 的复数）；零工" into
      // a part-of-speech prefix and individual definitions.
      const m = line.match(/^([a-z]+\.)\s*(.+)$/i);
      const pos = m ? m[1] : '';
      const body = m ? m[2] : line;
      const definitions = body
        .split(/[；;]/)
        .map((d) => d.trim())
        .filter(Boolean)
        .slice(0, 3);
      return { partOfSpeech: pos, definitions };
    })
    .filter((m) => m.definitions.length > 0);
  if (meanings.length === 0) return null;

  const phonetic = data.ussm || data.uksm || undefined;
  return { word: form, phonetic, meanings };
}

/**
 * Look up an English word. If the exact form is not found (plural, past
 * tense, gerund …), morphological variants are tried in order. Returns
 * null only when nothing matches.
 */
export async function lookupWord(word: string): Promise<WordDefinition | null> {
  const cleaned = word.trim().toLowerCase();
  if (!cleaned || /[^a-z'-]/.test(cleaned)) {
    // Not a plain English word; skip the API.
    return null;
  }

  const cached = CACHE.get(cleaned);
  if (cached !== undefined) return cached;

  try {
    // Step 0 — the local ECDICT dictionary. A hit ends the lookup here,
    // without a single network request.
    const offline = await fetchFromOffline(cleaned);
    if (offline) {
      CACHE.set(cleaned, offline);
      return offline;
    }
    for (const variant of morphologicalVariants(cleaned)) {
      const off = await fetchFromOffline(variant);
      if (off) {
        // `cleaned` is a surface form; `off.word` is the ECDICT headword.
        const result: WordDefinition = { ...off, queried: cleaned };
        CACHE.set(cleaned, result);
        return result;
      }
    }

    const direct = await fetchEntry(cleaned);
    if (direct && direct !== 'error') {
      CACHE.set(cleaned, direct);
      return direct;
    }

    // Fallback 1: morphological variants on the main source. A network
    // error means the source is unreachable — don't grind through every
    // variant at 4s timeout each; jump straight to the backup sources.
    if (direct !== 'error') {
      for (const variant of morphologicalVariants(cleaned)) {
        const hit = await fetchEntry(variant);
        if (hit === 'error') break;
        if (hit) {
          const result: WordDefinition = { ...hit, queried: cleaned };
          CACHE.set(cleaned, result);
          return result;
        }
      }
    }

    // Fallback 2: Youdao — Chinese definitions, best for CN learners.
    const yd = await fetchFromYoudao(cleaned);
    if (yd) {
      CACHE.set(cleaned, yd);
      return yd;
    }

    // Fallback 3: Datamuse — resolves inflections natively
    // (chores → defs + defHeadword "chore").
    const dm = await fetchFromDatamuse(cleaned);
    if (dm) {
      CACHE.set(cleaned, dm);
      return dm;
    }

    CACHE.set(cleaned, null);
    return null;
  } catch {
    CACHE.set(cleaned, null);
    return null;
  }
}

/**
 * Flatten a WordDefinition into the compact multi-line string we store in
 * the vocabulary entry and push into Anki's 单词释义 field, e.g.
 *
 *   n. 日常杂务，家务活；苦差事
 *   v. 做家务
 *
 * The part-of-speech label keeps its own trailing dot when it has one
 * (Youdao returns "n." while dictionaryapi.dev returns "noun").
 */
export function formatDefinition(def: WordDefinition): string {
  return def.meanings
    .slice(0, 4)
    .map((m) => {
      const pos = m.partOfSpeech.trim();
      const label = pos ? (pos.endsWith('.') ? `${pos} ` : `${pos}. `) : '';
      const defs = m.definitions.slice(0, 3).filter(Boolean);
      if (defs.length === 0) return '';
      const sep = defs.some((d) => /[\u4e00-\u9fff]/.test(d)) ? '；' : '; ';
      return `${label}${defs.join(sep)}`;
    })
    .filter(Boolean)
    .join('\n');
}
