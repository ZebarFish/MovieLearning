import { describe, expect, it } from 'vitest';
import type { VocabWord } from '../types';
import { buildAnkiText, escapeCell } from './ankiExport';

function entry(over: Partial<VocabWord> = {}): VocabWord {
  return {
    word: 'hello',
    surface: 'Hello',
    sentence: 'Hello, world!',
    video: 'episode-01.mp4',
    time: 65,
    addedAt: '2025-01-01T00:00:00.000Z',
    ...over,
  };
}

/** Data rows only (drop the `#…` directive lines and blanks). */
function rows(text: string): string[][] {
  return text
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t'));
}

describe('buildAnkiText', () => {
  it('returns empty string for empty input', () => {
    expect(buildAnkiText([])).toBe('');
  });

  it('emits a directive header that maps the ten columns', () => {
    const text = buildAnkiText([entry()]);
    expect(text.startsWith('#separator:tab\n#html:true\n#tags column:10\n\n')).toBe(
      true,
    );
  });

  it('emits the nine card fields plus a tags column', () => {
    const text = buildAnkiText([
      entry({ definition: 'n. 你好', translation: '你好，世界！' }),
    ]);
    expect(rows(text)).toEqual([
      [
        'Hello',
        'n. 你好',
        'Hello, world!',
        '你好，世界！',
        '',
        '',
        '',
        '',
        '',
        '听美剧学英语 episode-01_mp4',
      ],
    ]);
  });

  it('fills the dictionary-derived columns from entry.meta', () => {
    const text = buildAnkiText([
      entry({
        definition: 'n. 你好',
        translation: '你好，世界！',
        meta: {
          phonetic: 'həˈləʊ',
          definition: 'a greeting',
          pos: 'n:100',
          collins: 5,
          forms: { lemma: 'hello' },
        },
      }),
    ]);
    const [cols] = rows(text);
    expect(cols).toEqual([
      'Hello',
      'n. 你好',
      'Hello, world!',
      '你好，世界！',
      'həˈləʊ',
      'a greeting',
      '原形 hello',
      'n:100',
      '柯林斯★★★★★',
      '听美剧学英语 episode-01_mp4',
    ]);
  });

  it('leaves definition and translation empty when unknown', () => {
    const [cols] = rows(buildAnkiText([entry()]));
    expect(cols).toHaveLength(10);
    expect(cols![1]).toBe('');
    expect(cols![3]).toBe('');
  });

  it('joins multiple entries with newlines, one row each', () => {
    const text = buildAnkiText([
      entry({ word: 'apple', surface: 'apple' }),
      entry({ word: 'banana', surface: 'banana' }),
    ]);
    const data = rows(text);
    expect(data).toHaveLength(2);
    expect(data[0]![0]).toBe('apple');
    expect(data[1]![0]).toBe('banana');
  });
});

describe('escapeCell', () => {
  it('escapes HTML so definitions survive the import', () => {
    expect(escapeCell('<b>a</b> & c')).toBe('&lt;b&gt;a&lt;/b&gt; &amp; c');
  });

  it('flattens newlines and tabs so the TSV layout is preserved', () => {
    expect(escapeCell('n. 家务\nv. 做家务')).toBe('n. 家务<br>v. 做家务');
    expect(escapeCell('a\tb')).toBe('a b');
  });

  it('trims surrounding whitespace', () => {
    expect(escapeCell('  hello  ')).toBe('hello');
  });
});
