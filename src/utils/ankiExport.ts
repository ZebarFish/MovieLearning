/**
 * Anki export utility.
 *
 * Generates a tab-separated text file that Anki can import directly.
 * Each line is: `front\tback\t<TAGS>`
 * Where `extra` is the third column Anki displays below the back.
 *
 * Layout per line:
 *   front = the English word
 *   back  = translation (left empty so the user can fill in via Anki)
 *   extra = sentence | video name | timestamp
 */
import type { VocabWord } from '../types';
import { formatTime } from './subtitleParser';

/** Build the raw Anki text content from a list of vocabulary entries. */
export function buildAnkiText(entries: VocabWord[]): string {
  return entries
    .map((entry) => {
      const front = entry.word;
      // Back intentionally left empty - user will provide translations.
      const back = '';
      const extra = `${entry.sentence} | ${entry.video} | ${formatTime(entry.time)}`;
      return `${front}\t${back}\t${extra}`;
    })
    .join('\n');
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