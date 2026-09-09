import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useVocabulary } from './useVocabulary';
import type { VocabWord } from '../types';

const STORAGE_KEY = 'learnTV.vocab.v1';

function readStorage(): VocabWord[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as VocabWord[];
}

describe('useVocabulary', () => {
  it('starts empty when storage is empty', () => {
    const { result } = renderHook(() => useVocabulary());
    expect(result.current.vocab).toEqual([]);
  });

  it('addWord inserts a normalized entry and persists to localStorage', () => {
    const { result } = renderHook(() => useVocabulary());

    let added: boolean | undefined;
    act(() => {
      added = result.current.addWord({
        word: '  Hello, ',
        sentence: 'Hello world!',
        video: 'ep01',
        time: 12,
      });
    });

    expect(added).toBe(true);
    expect(result.current.vocab).toHaveLength(1);
    expect(result.current.vocab[0].word).toBe('hello');
    expect(result.current.vocab[0].surface).toBe('Hello');

    const stored = readStorage();
    expect(stored).toHaveLength(1);
    expect(stored[0].word).toBe('hello');
  });

  it('returns false when adding a duplicate word (case-insensitive)', () => {
    const { result } = renderHook(() => useVocabulary());

    act(() => {
      result.current.addWord({
        word: 'hello',
        sentence: 'first occurrence',
        video: 'ep01',
        time: 1,
      });
    });

    let added: boolean | undefined;
    act(() => {
      added = result.current.addWord({
        word: 'HELLO',
        sentence: 'duplicate',
        video: 'ep01',
        time: 5,
      });
    });

    expect(added).toBe(false);
    expect(result.current.vocab).toHaveLength(1);
  });

  it('hasWord reflects membership case-insensitively', () => {
    const { result } = renderHook(() => useVocabulary());
    act(() => {
      result.current.addWord({
        word: 'world',
        sentence: 'Hello world',
        video: 'ep01',
        time: 0,
      });
    });
    expect(result.current.hasWord('world')).toBe(true);
    expect(result.current.hasWord('WORLD')).toBe(true);
    expect(result.current.hasWord('  world  ')).toBe(true);
    expect(result.current.hasWord('missing')).toBe(false);
  });

  it('removeWord removes by normalized key', () => {
    const { result } = renderHook(() => useVocabulary());
    act(() => {
      result.current.addWord({ word: 'apple', sentence: '', video: 'v', time: 0 });
      result.current.addWord({ word: 'banana', sentence: '', video: 'v', time: 0 });
    });

    act(() => {
      result.current.removeWord('APPLE');
    });

    expect(result.current.vocab).toHaveLength(1);
    expect(result.current.vocab[0].word).toBe('banana');
    expect(result.current.hasWord('apple')).toBe(false);
  });

  it('clearAll empties vocab and storage', () => {
    const { result } = renderHook(() => useVocabulary());
    act(() => {
      result.current.addWord({ word: 'one', sentence: '', video: 'v', time: 0 });
      result.current.addWord({ word: 'two', sentence: '', video: 'v', time: 0 });
    });
    expect(readStorage().length).toBe(2);

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.vocab).toEqual([]);
    expect(readStorage()).toEqual([]);
  });

  it('rejects empty or punctuation-only words', () => {
    const { result } = renderHook(() => useVocabulary());
    let added: boolean | undefined;
    act(() => {
      added = result.current.addWord({ word: '!!!', sentence: '', video: 'v', time: 0 });
    });
    expect(added).toBe(false);
    expect(result.current.vocab).toHaveLength(0);
  });

  it('strips surrounding punctuation but keeps apostrophes', () => {
    const { result } = renderHook(() => useVocabulary());
    act(() => {
      result.current.addWord({
        word: '"don\'t"',
        sentence: 'don\'t go',
        video: 'v',
        time: 0,
      });
    });
    expect(result.current.vocab[0].surface).toBe("don't");
    expect(result.current.vocab[0].word).toBe("don't");
  });

  it('loads existing vocabulary from localStorage on mount', () => {
    const seeded: VocabWord[] = [
      {
        word: 'preset',
        surface: 'Preset',
        sentence: 'pre',
        video: 'v',
        time: 0,
        addedAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));

    const { result } = renderHook(() => useVocabulary());
    expect(result.current.vocab).toHaveLength(1);
    expect(result.current.vocab[0].word).toBe('preset');
  });

  it('ignores malformed localStorage payloads gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{{{');
    const { result } = renderHook(() => useVocabulary());
    expect(result.current.vocab).toEqual([]);
  });

  it('ignores non-array payloads', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
    const { result } = renderHook(() => useVocabulary());
    expect(result.current.vocab).toEqual([]);
  });

  it('filters out non-vocab-shaped items from storage', () => {
    const garbage = [
      { word: 'good', surface: 'g', sentence: '', video: '', time: 0, addedAt: 'x' },
      { foo: 'no-word-field' },
      null,
      'string-not-object',
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(garbage));
    const { result } = renderHook(() => useVocabulary());
    expect(result.current.vocab).toHaveLength(1);
    expect(result.current.vocab[0].word).toBe('good');
  });
});