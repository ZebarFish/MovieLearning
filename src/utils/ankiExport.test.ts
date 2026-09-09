import { describe, expect, it } from 'vitest';
import type { VocabWord } from '../types';
import { buildAnkiText } from './ankiExport';

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

describe('buildAnkiText', () => {
  it('returns empty string for empty input', () => {
    expect(buildAnkiText([])).toBe('');
  });

  it('emits a single line with three tab-separated columns', () => {
    const text = buildAnkiText([entry()]);
    const lines = text.split('\n');
    expect(lines).toHaveLength(1);
    const cols = lines[0].split('\t');
    expect(cols).toHaveLength(3);
    expect(cols[0]).toBe('hello');
    expect(cols[1]).toBe(''); // back intentionally empty
  });

  it('orders fields as front<tab>back<tab>extra', () => {
    const text = buildAnkiText([entry()]);
    expect(text).toBe(
      'hello\t\tHello, world! | episode-01.mp4 | 00:01:05',
    );
  });

  it('joins multiple entries with newlines, one per row', () => {
    const text = buildAnkiText([
      entry({ word: 'apple', sentence: 'I ate an apple' }),
      entry({ word: 'banana', sentence: 'Bananas are yellow', time: 120 }),
    ]);
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith('apple\t\t')).toBe(true);
    expect(lines[1].startsWith('banana\t\t')).toBe(true);
    // Each line is exactly 3 tab-separated fields
    for (const line of lines) {
      expect(line.split('\t')).toHaveLength(3);
    }
  });

  it('formats time in HH:MM:SS using formatTime', () => {
    const text = buildAnkiText([entry({ time: 3725 })]); // 1h 2m 5s
    expect(text).toContain('| 01:02:05');
  });

  it('handles 0-second timestamp', () => {
    const text = buildAnkiText([entry({ time: 0 })]);
    expect(text).toContain('| 00:00:00');
  });
});