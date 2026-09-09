import { describe, expect, it } from 'vitest';
import { diffDictation, extractWordSentence, filterCueText } from './textDiff';

describe('diffDictation', () => {
  it('marks all words ok for a perfect match', () => {
    const r = diffDictation('Hello world today', 'hello world today');
    expect(r.tokens.every((t) => t.status === 'ok')).toBe(true);
    expect(r.wrongWords).toEqual([]);
    expect(r.extraTyped).toEqual([]);
  });

  it('flags missing and wrong words', () => {
    const r = diffDictation('I went to school yesterday', 'I go to school');
    const missing = r.tokens.filter((t) => t.status === 'missing');
    // "went" was typed as "go" (unmatched) and "yesterday" was skipped.
    expect(missing.map((t) => t.text).sort()).toEqual(
      ['went', 'yesterday'].sort(),
    );
    expect(r.wrongWords.sort()).toEqual(['went', 'yesterday'].sort());
  });

  it('ignores punctuation and case', () => {
    const r = diffDictation('Hello, world!', 'hello world');
    expect(r.wrongWords).toEqual([]);
  });

  it('reports extra typed words', () => {
    const r = diffDictation('good morning', 'good morning my friend');
    expect(r.wrongWords).toEqual([]);
    expect(r.extraTyped.sort()).toEqual(['friend', 'my'].sort());
  });

  it('handles empty typed text', () => {
    const r = diffDictation('one two three', '  ');
    expect(r.tokens.every((t) => t.status === 'missing')).toBe(true);
    expect(r.wrongWords).toEqual(['one', 'two', 'three']);
  });
});

describe('extractWordSentence', () => {
  it('extracts the English sentence containing the word', () => {
    const text =
      '我叫玛丽·艾莉丝·杨 My name is Mary Alice Young. 如果你看了今天的早报 When you read this morning\'s paper,';
    expect(extractWordSentence(text, 'paper')).toBe(
      "When you read this morning's paper,",
    );
    expect(extractWordSentence(text, 'Mary')).toBe(
      'My name is Mary Alice Young.',
    );
  });

  it('falls back to the whole text when nothing matches', () => {
    expect(extractWordSentence('Hello world.', 'zzz')).toBe('Hello world.');
  });
});

describe('filterCueText', () => {
  const bilingual = '做家务 I performed my chores.';
  it('keeps everything in both mode', () => {
    expect(filterCueText(bilingual, 'both')).toBe(bilingual);
  });
  it('shows only English in en mode', () => {
    expect(filterCueText(bilingual, 'en')).toBe('I performed my chores.');
  });
  it('shows only Chinese in zh mode', () => {
    expect(filterCueText(bilingual, 'zh')).toBe('做家务');
  });
  it('empties in none mode and passes pure text through', () => {
    expect(filterCueText(bilingual, 'none')).toBe('');
    expect(filterCueText('Only english.', 'zh')).toBe('Only english.');
  });
});
