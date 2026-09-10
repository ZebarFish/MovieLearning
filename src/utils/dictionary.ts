/**
 * dictionary.ts
 *
 * Lightweight wrapper around the free Dictionary API
 * (https://dictionaryapi.dev/) to fetch English word definitions and IPA.
 * No API key is required.
 */

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

/** Single API fetch for one form; null when not found / network failure. */
async function fetchEntry(
  form: string,
): Promise<WordDefinition | null> {
  const res = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(form)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
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
    const direct = await fetchEntry(cleaned);
    if (direct) {
      CACHE.set(cleaned, direct);
      return direct;
    }

    // Fallback: inflected forms.
    for (const variant of morphologicalVariants(cleaned)) {
      const hit = await fetchEntry(variant);
      if (hit) {
        const result: WordDefinition = { ...hit, queried: cleaned };
        CACHE.set(cleaned, result);
        return result;
      }
    }

    CACHE.set(cleaned, null);
    return null;
  } catch {
    CACHE.set(cleaned, null);
    return null;
  }
}
