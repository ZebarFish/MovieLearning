/**
 * textDiff
 *
 * Word-level dictation diff: align what the user typed against the expected
 * subtitle text using LCS on normalized words, then classify each expected
 * word as ok/missing and each extra typed word as extra.
 */

export type DiffStatus = 'ok' | 'missing';

export interface DiffToken {
  /** The expected word (original casing / punctuation). */
  text: string;
  status: DiffStatus;
  /** The word the user typed at the aligned position, if any. */
  typed?: string;
}

export interface DiffResult {
  tokens: DiffToken[];
  /** Words the user typed that match nothing in the expected text. */
  extraTyped: string[];
  /** Expected words the user got wrong or missed (normalized). */
  wrongWords: string[];
}

/** Normalize a word for comparison: lowercase, strip punctuation. */
function norm(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, '');
}

function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function diffDictation(
  expectedText: string,
  typedText: string,
): DiffResult {
  const expected = tokenize(expectedText);
  const typed = tokenize(typedText);
  const normExpected = expected.map(norm);
  const normTyped = typed.map(norm);

  // LCS table over normalized words.
  const m = normExpected.length;
  const n = normTyped.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] =
        normExpected[i] === normTyped[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  // Walk the table: matched expected words get their typed counterpart;
  // unmatched expected words are 'missing'; unmatched typed words are extra.
  const tokens: DiffToken[] = [];
  const extraTyped: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (normExpected[i] === normTyped[j]) {
      tokens.push({ text: expected[i]!, status: 'ok', typed: typed[j] });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      tokens.push({ text: expected[i]!, status: 'missing' });
      i++;
    } else {
      extraTyped.push(typed[j]!);
      j++;
    }
  }
  while (i < m) {
    tokens.push({ text: expected[i]!, status: 'missing' });
    i++;
  }
  while (j < n) {
    extraTyped.push(typed[j]!);
    j++;
  }

  const wrongWords = tokens
    .filter((t) => t.status === 'missing')
    .map((t) => norm(t.text))
    .filter((w) => w.length > 0);

  return { tokens, extraTyped, wrongWords };
}

/**
 * Extract just the sentence containing `word` from a (possibly bilingual)
 * subtitle line, preferring the English part. Used so collected words carry
 * a meaningful example sentence instead of the whole cue blob.
 */
export function extractWordSentence(text: string, word: string): string {
  const target = norm(word);
  if (!target) return text;
  const sentences = text
    .split(/(?<=[.!?。！?；;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hit =
    sentences.find((s) =>
      s.split(/\s+/).some((w) => norm(w) === target),
    ) ??
    sentences.find((s) => norm(s).includes(target)) ??
    text;
  // Drop pure-Chinese tokens (bilingual subtitles prepend a translation).
  const englishOnly = hit
    .split(/\s+/)
    .filter((t) => !/[\u4e00-\u9fff]/.test(t))
    .join(' ')
    .trim();
  return englishOnly || hit;
}

const CJK_RE = /[\u4e00-\u9fff]/;

/** Chinese runs incl. CJK punctuation (、。！？：""《》·…) and inner spaces. */
const ZH_RUN_RE =
  /[\u4e00-\u9fff\u3001\u3002\uff0c\uff1a\uff1b\uff01\uff1f\u201c\u201d\u300a\u300b\u00b7\uff08\uff09][\u4e00-\u9fff\u3001\u3002\uff0c\uff1a\uff1b\uff01\uff1f\u201c\u201d\u300a\u300b\u00b7\uff08\uff09\s]*[\u4e00-\u9fff\u3001\u3002\uff0c\uff1a\uff1b\uff01\uff1f\u201d\u300b\uff09]|[\u4e00-\u9fff\u3001\u3002\uff0c\uff1a\uff1b\uff01\uff1f]/g;

/**
 * Display filter for bilingual subtitle lines (e.g. "中文 English.").
 *  - both → original text
 *  - en   → strip Chinese tokens
 *  - zh   → keep only Chinese runs
 *  - none → empty
 * Falls back to the original text when the requested part is empty.
 */
export function filterCueText(
  text: string,
  mode: 'none' | 'en' | 'zh' | 'both',
): string {
  if (mode === 'none') return '';
  if (mode === 'both' || !CJK_RE.test(text)) return text;
  if (mode === 'en') {
    const en = text
      .split(/\s+/)
      .filter((t) => !CJK_RE.test(t))
      .join(' ')
      .trim();
    return en || text;
  }
  // zh: collect Chinese runs
  const runs = text.match(ZH_RUN_RE) ?? [];
  const zh = runs.join(' ').trim();
  return zh || text;
}
