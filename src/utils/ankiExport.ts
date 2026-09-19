/**
 * Anki export utility.
 *
 * Generates a tab-separated text file that Anki can import directly
 * (File → Import). The columns line up 1:1 with the fields of the
 * "听美剧学英语" note type created by ankiTemplate.ts, so the same content
 * ends up on the card whether it was synced or imported:
 *
 *   单词 | 单词释义 | 例句 | 例句释义 | 音标 | 英文释义 | 词形变化 | 词性分布 |
 *   词汇标记 | tags
 *
 * The `#tags column:<n>` directive is derived from the field list rather than
 * hard-coded, so it cannot drift when the note type gains fields. Values are
 * HTML-escaped and newlines become <br>, so multi-line definitions survive
 * the TSV round-trip without breaking the column layout.
 */
import type { VocabWord } from '../types';
import { ANKI_FIELDS } from './ankiTemplate';
import { formatForms, formatLexicalTags } from './wordMeta';

/** Make a value safe for one TSV cell (no tabs/newlines, HTML escaped). */
export function escapeCell(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>')
    .replace(/\t/g, ' ')
    .trim();
}

/** Tag applied to every exported/synced card. */
export const EXPORT_TAG = '听美剧学英语';

/** Build the raw Anki text content from a list of vocabulary entries. */
export function buildAnkiText(entries: VocabWord[]): string {
  if (entries.length === 0) return '';

  // The nine card fields, plus the trailing tags column.
  const tagsColumn = ANKI_FIELDS.length + 1;
  const directives = `#separator:tab\n#html:true\n#tags column:${tagsColumn}\n\n`;

  const rows = entries.map((entry) => {
    const tags = [EXPORT_TAG, entry.video.replace(/[^\w-]+/g, '_')]
      .filter(Boolean)
      .join(' ');
    return [
      escapeCell(entry.surface),
      escapeCell(entry.definition ?? ''),
      escapeCell(entry.sentence),
      escapeCell(entry.translation ?? ''),
      escapeCell(entry.meta?.phonetic ?? ''),
      escapeCell(entry.meta?.definition ?? ''),
      escapeCell(formatForms(entry.meta)),
      escapeCell(entry.meta?.pos ?? ''),
      escapeCell(formatLexicalTags(entry.meta)),
      tags,
    ].join('\t');
  });

  return directives + rows.join('\n');
}

/**
 * Trigger a browser download of the vocabulary as an Anki-importable text file.
 * Creates a Blob and an invisible anchor element to download it.
 */
export function downloadAnkiExport(entries: VocabWord[]): void {
  if (entries.length === 0) {
    return;
  }
  const content = buildAnkiText(entries);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `vocabulary-anki-export-${timestamp}.txt`;

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Release the blob URL on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
