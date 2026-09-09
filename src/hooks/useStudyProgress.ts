/**
 * useStudyProgress
 *
 * Persists per-video study progress to localStorage:
 *  - learnedCues: which subtitle line indexes have been studied at least once
 *  - wrongWords:  words the user got wrong during dictation (for review)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { extractWordSentence } from '../utils/textDiff';

export interface WrongWordRecord {
  word: string;
  sentence: string;
  video: string;
  count: number;
}

interface StoredProgress {
  /** videoName -> sorted list of learned cue indexes */
  learned: Record<string, number[]>;
  wrongWords: WrongWordRecord[];
}

// v2: v1 stored whole-segment blobs as "sentences"; bump to start clean.
const STORAGE_KEY = 'study-progress-v2';

/**
 * Repair legacy records: some old sentences are whole-segment blobs (very
 * long and/or containing Chinese). Re-extract the word's own sentence.
 */
function sanitizeWrongWords(list: WrongWordRecord[]): WrongWordRecord[] {
  return list.map((r) => {
    if (r.sentence.length > 100 || /[\u4e00-\u9fff]/.test(r.sentence)) {
      const fixed = extractWordSentence(r.sentence, r.word);
      if (fixed && fixed.length <= r.sentence.length) {
        return { ...r, sentence: fixed };
      }
    }
    return r;
  });
}

function loadProgress(): StoredProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredProgress;
      return {
        learned: parsed.learned ?? {},
        wrongWords: sanitizeWrongWords(parsed.wrongWords ?? []),
      };
    }
  } catch {
    // corrupted storage — start fresh
  }
  return { learned: {}, wrongWords: [] };
}

export function useStudyProgress(videoName: string) {
  const [progress, setProgress] = useState<StoredProgress>(loadProgress);

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // storage full / unavailable — ignore
    }
  }, [progress]);

  const learnedSet = useMemo(
    () => new Set(progress.learned[videoName] ?? []),
    [progress, videoName],
  );

  const markLearned = useCallback(
    (video: string, indexes: number[]): void => {
      setProgress((prev) => {
        const existing = new Set(prev.learned[video] ?? []);
        for (const i of indexes) existing.add(i);
        return {
          ...prev,
          learned: {
            ...prev.learned,
            [video]: [...existing].sort((a, b) => a - b),
          },
        };
      });
    },
    [],
  );

  const addWrongWord = useCallback(
    (word: string, sentence: string, video: string): void => {
      const w = word.toLowerCase();
      setProgress((prev) => {
        const existing = prev.wrongWords.find(
          (r) => r.word.toLowerCase() === w && r.video === video,
        );
        if (existing) {
          return {
            ...prev,
            wrongWords: prev.wrongWords.map((r) =>
              r === existing ? { ...r, count: r.count + 1 } : r,
            ),
          };
        }
        return {
          ...prev,
          wrongWords: [...prev.wrongWords, { word, sentence, video, count: 1 }],
        };
      });
    },
    [],
  );

  return { learnedSet, markLearned, wrongWords: progress.wrongWords, addWrongWord };
}
