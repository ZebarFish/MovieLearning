/**
 * useVocabulary
 *
 * Manages the user's vocabulary list with localStorage persistence.
 * Each word is keyed (lowercased) and stores the originating sentence,
 * video name, timestamp, and addition time.
 *
 * Public API:
 *   - vocab       : ordered list of VocabWord entries
 *   - addWord     : add a word (no-op if already present)
 *   - removeWord  : remove a word by its normalized form
 *   - hasWord     : check membership
 *   - clearAll    : wipe the vocabulary
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SubtitleLang, VocabWord } from '../types';

const STORAGE_KEY = 'learnTV.vocab.v1';

/** Normalize a surface form to the dictionary key we store it under. */
function normalize(word: string): string {
  return word.trim().toLowerCase();
}

/** Strip trailing punctuation that often attaches to words in subtitles. */
function cleanSurface(word: string): string {
  return word.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
}

interface AddWordArgs {
  word: string;
  sentence: string;
  video: string;
  time: number;
  lang?: SubtitleLang;
}

interface UseVocabularyResult {
  vocab: VocabWord[];
  addWord: (args: AddWordArgs) => boolean;
  removeWord: (word: string) => void;
  hasWord: (word: string) => boolean;
  clearAll: () => void;
}

function loadFromStorage(): VocabWord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    // Defensive: filter out anything that doesn't look like a vocab entry.
    return parsed.filter((item): item is VocabWord => {
      return (
        !!item &&
        typeof item === 'object' &&
        typeof (item as VocabWord).word === 'string' &&
        typeof (item as VocabWord).addedAt === 'string'
      );
    });
  } catch {
    return [];
  }
}

function saveToStorage(entries: VocabWord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage disabled — silently ignore.
  }
}

export function useVocabulary(): UseVocabularyResult {
  const [vocab, setVocab] = useState<VocabWord[]>(() => loadFromStorage());

  // Persist on every change.
  useEffect(() => {
    saveToStorage(vocab);
  }, [vocab]);

  const hasWord = useCallback(
    (word: string) => vocab.some((entry) => entry.word === normalize(word)),
    [vocab],
  );

  const addWord = useCallback(
    ({ word, sentence, video, time, lang }: AddWordArgs): boolean => {
      const cleaned = cleanSurface(word);
      if (!cleaned) {
        return false;
      }
      const key = normalize(cleaned);
      if (vocab.some((entry) => entry.word === key)) {
        return false;
      }
      const entry: VocabWord = {
        word: key,
        surface: cleaned,
        sentence,
        video,
        time,
        addedAt: new Date().toISOString(),
        lang,
      };
      setVocab((prev) => [entry, ...prev]);
      return true;
    },
    [vocab],
  );

  const removeWord = useCallback((word: string) => {
    const key = normalize(word);
    setVocab((prev) => prev.filter((entry) => entry.word !== key));
  }, []);

  const clearAll = useCallback(() => {
    setVocab([]);
  }, []);

  return useMemo(
    () => ({ vocab, addWord, removeWord, hasWord, clearAll }),
    [vocab, addWord, removeWord, hasWord, clearAll],
  );
}