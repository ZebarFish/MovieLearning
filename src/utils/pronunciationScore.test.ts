import { describe, expect, it } from 'vitest';
import { scorePronunciation } from './pronunciationScore';

describe('scorePronunciation', () => {
  it('marks every word ok on a perfect read (case / punctuation agnostic)', () => {
    const r = scorePronunciation('But that all changed last Thursday.', 'but that ALL changed, last thursday');
    expect(r.tokens.map((t) => t.status)).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
    ]);
    expect(r.score).toBe(100);
    expect(r.extraSpoken).toEqual([]);
  });

  it('shows what was heard for substituted words', () => {
    const r = scorePronunciation('but that all changed', 'but that all charges');
    expect(r.tokens[3]).toEqual({
      text: 'changed',
      status: 'wrong',
      heard: 'charges',
    });
    expect(r.score).toBe(75);
  });

  it('marks skipped words as missed', () => {
    const r = scorePronunciation('but that all changed', 'but changed');
    expect(r.tokens.map((t) => [t.text, t.status])).toEqual([
      ['but', 'ok'],
      ['that', 'missed'],
      ['all', 'missed'],
      ['changed', 'ok'],
    ]);
    expect(r.score).toBe(50);
  });

  it('surfaces extra spoken words that match nothing', () => {
    const r = scorePronunciation('good morning', 'good good morning everyone');
    expect(r.extraSpoken).toEqual(['good', 'everyone']);
    // One duplicated "good" is consumed as an extra, not a wrong.
    expect(r.tokens.map((t) => t.status)).toEqual(['ok', 'ok']);
    expect(r.score).toBe(100);
  });

  it('combines wrong + missed + extra in one aligned result', () => {
    const r = scorePronunciation('but that all changed last thursday', 'but the all change thursday guys');
    expect(r.tokens.map((t) => [t.text, t.status])).toEqual([
      ['but', 'ok'],
      ['that', 'wrong'],
      ['all', 'ok'],
      ['changed', 'wrong'],
      ['last', 'missed'],
      ['thursday', 'ok'],
    ]);
    expect(r.extraSpoken).toEqual(['guys']);
    expect(r.score).toBe(50);
  });

  it('drops pure-Chinese tokens from bilingual subtitle lines', () => {
    const r = scorePronunciation('做家务 I performed my chores.', 'i performed my chores');
    expect(r.tokens.map((t) => t.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(r.score).toBe(100);
  });

  it('handles an empty read', () => {
    const r = scorePronunciation('hello world', '');
    expect(r.tokens.map((t) => t.status)).toEqual(['missed', 'missed']);
    expect(r.score).toBe(0);
  });

  it('handles a completely unrelated read', () => {
    const r = scorePronunciation('hello world', 'lorem ipsum');
    expect(r.tokens.map((t) => t.status)).toEqual(['wrong', 'wrong']);
    expect(r.tokens[0]!.heard).toBe('lorem');
    expect(r.score).toBe(0);
  });
});
