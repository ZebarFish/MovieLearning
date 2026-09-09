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

/**
 * Look up an English word. Returns null on network/parse failure or if the
 * word is not found.
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
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleaned)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      CACHE.set(cleaned, null);
      return null;
    }
    const data = (await res.json()) as RawEntry[];
    const entry = data[0];
    if (!entry) {
      CACHE.set(cleaned, null);
      return null;
    }

    const phonetic =
      entry.phonetic ??
      entry.phonetics?.find((p) => p.text && p.audio)?.text ??
      entry.phonetics?.find((p) => p.text)?.text;
    const audio = entry.phonetics?.find((p) => p.audio)?.audio || undefined;

    const result: WordDefinition = {
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

    CACHE.set(cleaned, result);
    return result;
  } catch {
    CACHE.set(cleaned, null);
    return null;
  }
}
