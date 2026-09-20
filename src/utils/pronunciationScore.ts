/**
 * pronunciationScore
 *
 * Word-level pronunciation feedback for the shadowing (跟读) step: align what
 * speech recognition heard against the target sentence with edit distance
 * (substitution-aware, unlike the dictation LCS diff), then classify each
 * target word as ok / wrong (with the misheard word) / missed, plus any extra
 * words the user said that align to nothing.
 */

export type SpokenStatus = 'ok' | 'wrong' | 'missed';

export interface SpokenToken {
  /** The target word (original casing / punctuation). */
  text: string;
  status: SpokenStatus;
  /** What recognition heard instead (only for 'wrong'). */
  heard?: string;
}

export interface PronunciationResult {
  tokens: SpokenToken[];
  /** Recognized words that match nothing in the target sentence. */
  extraSpoken: string[];
  /** 0–100, matched target words over total target words. */
  score: number;
}

/** Normalize a word for comparison: lowercase, strip everything but a-z0-9'. */
function norm(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, '');
}

/**
 * Keep only tokens that survive normalization (drops pure-Chinese tokens from
 * bilingual subtitle lines and bare punctuation).
 */
function normTokenize(text: string): { raw: string; norm: string }[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, norm: norm(raw) }))
    .filter((t) => t.norm.length > 0);
}

/**
 * Align the spoken (recognized) words against the target words with
 * Levenshtein-style DP and backtrace the cheapest path.
 * Costs: match 0, substitution 1, insertion (extra spoken) 1, deletion
 * (missed target) 1 — so substitutions are preferred over a mix of
 * insert+delete, which is what a reader actually did.
 */
export function scorePronunciation(
  targetText: string,
  spokenText: string,
): PronunciationResult {
  const target = normTokenize(targetText);
  const spoken = normTokenize(spokenText);
  const m = target.length;
  const n = spoken.length;

  // dp[i][j] = cost of aligning target[i..] with spoken[j..].
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i < m; i++) dp[i]![n] = m - i; // remaining targets = missed
  for (let j = 0; j < n; j++) dp[m]![j] = n - j; // remaining spoken = extra
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const sub = dp[i + 1]![j + 1]! + (target[i]!.norm === spoken[j]!.norm ? 0 : 1);
      dp[i]![j] = Math.min(
        sub,
        dp[i + 1]![j]! + 1, // target word missed
        dp[i]![j + 1]! + 1, // extra spoken word
      );
    }
  }

  const tokens: SpokenToken[] = [];
  const extraSpoken: string[] = [];
  let matched = 0;
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    const best = dp[i]![j]!;
    const equal = target[i]!.norm === spoken[j]!.norm;
    const subCost = dp[i + 1]![j + 1]! + (equal ? 0 : 1);
    const delCost = dp[i + 1]![j]! + 1;
    // Skip heuristic: when the heard word is actually the NEXT target word,
    // the reader most likely skipped the current one (e.g. target "last
    // thursday" heard "thursday" → "last" missed), which reads far better
    // than reporting two wrong words.
    const nextIsMatch =
      !equal && i + 1 < m && spoken[j]!.norm === target[i + 1]!.norm;
    if (subCost === best && !(nextIsMatch && delCost === best)) {
      if (equal) {
        tokens.push({ text: target[i]!.raw, status: 'ok' });
        matched++;
      } else {
        tokens.push({
          text: target[i]!.raw,
          status: 'wrong',
          heard: spoken[j]!.raw,
        });
      }
      i++;
      j++;
    } else if (delCost === best) {
      tokens.push({ text: target[i]!.raw, status: 'missed' });
      i++;
    } else {
      extraSpoken.push(spoken[j]!.raw);
      j++;
    }
  }
  while (i < m) {
    tokens.push({ text: target[i]!.raw, status: 'missed' });
    i++;
  }
  while (j < n) {
    extraSpoken.push(spoken[j]!.raw);
    j++;
  }

  const score = m === 0 ? 0 : Math.round((matched / m) * 100);
  return { tokens, extraSpoken, score };
}
