/**
 * vocabEnrich.ts
 *
 * Fills in the card content that is not known at collection time:
 *
 *   单词释义  the word's definition   → dictionary lookup
 *   例句释义  the sentence's Chinese  → the ZH subtitle track, else machine
 *                                      translation
 *   meta      the lexical metadata    → the same dictionary lookup (音标 /
 *             英文释义 / 词性分布 / 词形变化 / 词汇标记 …)
 *
 * Enrichment is idempotent and only touches entries that are still missing
 * something, so it is safe to run before every sync: already-complete entries
 * cost nothing, and the caller persists the result so the work is done once.
 *
 * `meta` became part of "complete" when the richer Anki note type landed, so
 * entries collected before that are backfilled on the next sync.
 */
import type { SubtitleCue, VocabWord, WordMeta } from '../types';
import { formatDefinition, lookupWord } from './dictionary';
import { toWordMeta } from './wordMeta';
import { hasChinese, translateToChinese } from './translate';

export interface EnrichOptions {
  /**
   * Cues of the Chinese subtitle track for the video the words came from.
   * When present they are preferred over machine translation — they were
   * written by a human and match the scene.
   */
  zhCues?: SubtitleCue[];
  /** Called after each entry finishes, for progress UI. */
  onProgress?: (done: number, total: number) => void;
  /** How many lookups to run at once. Default 4. */
  concurrency?: number;
}

/** Nearest cue tolerance (seconds) when no cue strictly contains the time. */
const DEFAULT_TOLERANCE = 3;

/**
 * Return the subtitle line at `time` (seconds). Prefers a cue that actually
 * contains the timestamp, then the closest cue within `tolerance`, so a word
 * collected a hair before/after its line still finds its sentence.
 */
export function findCueAt(
  cues: SubtitleCue[] | undefined,
  time: number,
  tolerance: number = DEFAULT_TOLERANCE,
): SubtitleCue | null {
  if (!cues || cues.length === 0) return null;

  let nearest: SubtitleCue | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const cue of cues) {
    if (time >= cue.start && time <= cue.end) return cue;
    const distance = time < cue.start ? cue.start - time : time - cue.end;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = cue;
    }
  }
  return nearestDistance <= tolerance ? nearest : null;
}

/** Chinese text of the subtitle line at `time`, or null. */
export function chineseCueTextAt(
  cues: SubtitleCue[] | undefined,
  time: number,
): string | null {
  const cue = findCueAt(cues, time);
  if (!cue) return null;
  const text = cue.text.replace(/\s+/g, ' ').trim();
  // A ZH track can contain untranslated lines; don't store English as a
  // translation just because it happened to sit in the Chinese track.
  return text && hasChinese(text) ? text : null;
}

/** Metadata worth storing — an empty object carries no information. */
function usefulMeta(meta: WordMeta | undefined): WordMeta | undefined {
  return meta && Object.keys(meta).length > 0 ? meta : undefined;
}

/** Entries that still need a dictionary lookup and/or a translation. */
export function countPendingEnrichment(entries: VocabWord[]): number {
  return entries.filter(
    (e) =>
      !e.definition?.trim() || !e.translation?.trim() || !usefulMeta(e.meta),
  ).length;
}

/**
 * Enrich a batch of vocabulary entries. Returns a new array in the original
 * order; entries that were already complete are returned untouched (same
 * object reference) so callers can cheaply detect what changed.
 */
export async function enrichVocab(
  entries: VocabWord[],
  options: EnrichOptions = {},
): Promise<VocabWord[]> {
  const { zhCues, onProgress } = options;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const result: VocabWord[] = [...entries];

  const pending = entries
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        !entry.definition?.trim() ||
        !entry.translation?.trim() ||
        !usefulMeta(entry.meta),
    );

  const total = pending.length;
  if (total === 0) return result;

  let done = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const current = pending[cursor++];
      if (!current) return;
      const { entry, index } = current;

      let translation = entry.translation?.trim() || undefined;
      let definition = entry.definition?.trim() || undefined;
      let meta = usefulMeta(entry.meta);

      if (!translation && entry.sentence.trim()) {
        translation =
          chineseCueTextAt(zhCues, entry.time) ??
          (await translateToChinese(entry.sentence)) ??
          undefined;
      }

      // A single lookup feeds both 单词释义 and the lexical metadata.
      if (!definition || !meta) {
        const def = await lookupWord(entry.word);
        if (def) {
          if (!definition) definition = formatDefinition(def) || undefined;
          if (!meta) meta = usefulMeta(toWordMeta(def));
        }
      }

      if (
        translation !== entry.translation ||
        definition !== entry.definition ||
        meta !== entry.meta
      ) {
        result[index] = {
          ...entry,
          ...(definition ? { definition } : {}),
          ...(translation ? { translation } : {}),
          ...(meta ? { meta } : {}),
        };
      }

      done += 1;
      onProgress?.(done, total);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, worker),
  );

  return result;
}
