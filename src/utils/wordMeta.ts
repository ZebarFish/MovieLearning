/**
 * wordMeta.ts
 *
 * Pure, side-effect-free formatting helpers over `WordMeta`. This is the
 * shared layer the word card UI and the Anki exporter both import, so the
 * names and signatures here are frozen by contract — do not rename or reshape.
 *
 * None of these functions ever throw: an `undefined` / empty input is a safe
 * no-op that returns `''` or `[]` as appropriate.
 */
import type { WordDefinition } from './dictionary';
import type { ExamTag, WordForms, WordMeta } from '../types';

/** Chinese labels for ECDICT's exam-syllabus codes. */
export const EXAM_TAG_LABELS: Record<ExamTag, string> = {
  zk: '中考',
  gk: '高考',
  cet4: '四级',
  cet6: '六级',
  ky: '考研',
  toefl: '托福',
  ielts: '雅思',
  gre: 'GRE',
};

/** Fixed display order for exam tags — output never depends on input order. */
const TAG_ORDER: ExamTag[] = ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'];

/** Fixed order of the inflection summary, lemma first. */
const FORM_ORDER: { key: keyof WordForms; label: string }[] = [
  { key: 'lemma', label: '原形' },
  { key: 'past', label: '过去式' },
  { key: 'pastParticiple', label: '过去分词' },
  { key: 'presentParticiple', label: '现在分词' },
  { key: 'thirdPerson', label: '三单' },
  { key: 'plural', label: '复数' },
  { key: 'comparative', label: '比较级' },
  { key: 'superlative', label: '最高级' },
];

/**
 * ECDICT separates lines with a LITERAL backslash followed by `n`, not
 * U+000A. Stored metadata may still carry that raw sequence (older entries),
 * so anything we hand to the UI or Anki is normalised here.
 */
const LITERAL_LINE_SEP = '\\n';

/** Literal `\n` separators → real newlines, blank lines dropped. */
function normalizeLines(value: string): string {
  return value
    .split(LITERAL_LINE_SEP)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Extract the storable metadata from a lookup result, whatever source it came
 * from. Returns `{ ...def.meta, phonetic: def.phonetic }`, but an empty-string
 * `phonetic` is dropped rather than kept as an empty key. An entirely empty
 * result collapses to `{}` so callers always get a valid `WordMeta`.
 */
export function toWordMeta(def: WordDefinition): WordMeta {
  const meta: WordMeta = { ...(def.meta ?? {}) };
  if (typeof def.phonetic === 'string' && def.phonetic.trim() === '') {
    delete meta.phonetic;
  } else if (def.phonetic) {
    meta.phonetic = def.phonetic;
  }

  // Defensive: an entry stored before the fix still has literal `\n` here.
  if (typeof meta.definition === 'string') {
    const definition = normalizeLines(meta.definition);
    if (definition) meta.definition = definition;
    else delete meta.definition;
  }

  return meta;
}

/**
 * Short chip labels for the word card, e.g.
 * `['牛津3000', '柯林斯 ★★★★', '高考', '四级', '词频 49']`.
 *
 * Order is fixed: Oxford → Collins → exam tags → frequency. Missing values are
 * simply skipped. Returns `[]` for an empty/absent meta.
 */
export function metaBadges(meta: WordMeta | undefined): string[] {
  if (!meta) return [];
  const badges: string[] = [];

  if (meta.oxford) badges.push('牛津3000');

  if (typeof meta.collins === 'number' && meta.collins >= 1 && meta.collins <= 5) {
    badges.push(`柯林斯 ${'★'.repeat(meta.collins)}`);
  }

  if (meta.tags && meta.tags.length > 0) {
    for (const tag of TAG_ORDER) {
      if (meta.tags.includes(tag)) badges.push(EXAM_TAG_LABELS[tag]);
    }
  }

  const freq = meta.bnc ?? meta.frq;
  if (typeof freq === 'number') badges.push(`词频 ${freq}`);

  return badges;
}

/**
 * One-line inflection summary, e.g.
 * '原形 discover · 过去式 discovered · 过去分词 discovered · 现在分词 discovering · 三单 discovers'.
 * Empty/absent forms collapse to `''`.
 */
export function formatForms(meta: WordMeta | undefined): string {
  if (!meta?.forms) return '';
  const parts: string[] = [];
  for (const { key, label } of FORM_ORDER) {
    const value = meta.forms[key];
    if (value) parts.push(`${label} ${value}`);
  }
  return parts.join(' · ');
}

/**
 * One line for the Anki 词汇标记 field, e.g.
 * '牛津3000 · 柯林斯★★★★★ · 高考 / 四级 · BNC 49 / 当代 47'.
 * Segments are joined by ` · ` and skipped when absent; collapses to `''`.
 */
export function formatLexicalTags(meta: WordMeta | undefined): string {
  if (!meta) return '';
  const segments: string[] = [];

  if (meta.oxford) segments.push('牛津3000');

  if (typeof meta.collins === 'number' && meta.collins >= 1 && meta.collins <= 5) {
    segments.push(`柯林斯${'★'.repeat(meta.collins)}`);
  }

  if (meta.tags && meta.tags.length > 0) {
    const labels = TAG_ORDER.filter((t) => meta.tags!.includes(t)).map((t) => EXAM_TAG_LABELS[t]);
    if (labels.length > 0) segments.push(labels.join(' / '));
  }

  if (typeof meta.bnc === 'number') segments.push(`BNC ${meta.bnc}`);
  if (typeof meta.frq === 'number') segments.push(`当代 ${meta.frq}`);

  return segments.join(' · ');
}
