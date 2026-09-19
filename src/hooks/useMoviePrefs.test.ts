/**
 * useMoviePrefs.test.ts
 *
 * Verifies the hook's lifecycle: empty start, toggle round-trips, persistence
 * to localStorage, tolerance of corrupt storage, and clearPrefs.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMoviePrefs } from './useMoviePrefs';
import type { MoviePrefs } from '../types';

const STORAGE_KEY = 'letv.moviePrefs.v1';

function readStorage(): MoviePrefs {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as MoviePrefs) : { favorites: [], watched: [], hidden: [] };
}

describe('useMoviePrefs', () => {
  it('starts empty when storage is empty', () => {
    const { result } = renderHook(() => useMoviePrefs());
    expect(result.current.prefs).toEqual({ favorites: [], watched: [], hidden: [] });
    expect(result.current.isFavorite('x')).toBe(false);
    expect(result.current.isWatched('x')).toBe(false);
    expect(result.current.isHidden('x')).toBe(false);
  });

  it('toggleFavorite adds then removes (round-trip) and persists', () => {
    const { result } = renderHook(() => useMoviePrefs());

    act(() => result.current.toggleFavorite('friends'));
    expect(result.current.isFavorite('friends')).toBe(true);
    expect(readStorage().favorites).toContain('friends');

    act(() => result.current.toggleFavorite('friends'));
    expect(result.current.isFavorite('friends')).toBe(false);
    expect(readStorage().favorites).not.toContain('friends');
  });

  it('toggleWatched and toggleHidden behave independently', () => {
    const { result } = renderHook(() => useMoviePrefs());

    act(() => result.current.toggleWatched('a'));
    act(() => result.current.toggleHidden('b'));
    expect(result.current.isWatched('a')).toBe(true);
    expect(result.current.isHidden('b')).toBe(true);
    expect(result.current.isFavorite('a')).toBe(false);

    act(() => result.current.toggleWatched('a'));
    expect(result.current.isWatched('a')).toBe(false);
    expect(result.current.isHidden('b')).toBe(true);
  });

  it('restores persisted prefs on mount', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ favorites: ['friends'], watched: ['suits'], hidden: ['wire'] }),
    );
    const { result } = renderHook(() => useMoviePrefs());
    expect(result.current.prefs.favorites).toContain('friends');
    expect(result.current.prefs.watched).toContain('suits');
    expect(result.current.prefs.hidden).toContain('wire');
  });

  it('tolerates corrupt / partial storage without throwing', () => {
    // Malformed JSON.
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    const { result } = renderHook(() => useMoviePrefs());
    expect(result.current.prefs).toEqual({ favorites: [], watched: [], hidden: [] });

    // Valid JSON but wrong shape (missing arrays, wrong types).
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ favorites: 'oops', watched: [1, 2], hidden: null }));
    const { result: r2 } = renderHook(() => useMoviePrefs());
    expect(r2.current.prefs.favorites).toEqual([]);
    expect(r2.current.prefs.watched).toEqual([]);
    expect(r2.current.prefs.hidden).toEqual([]);
  });

  it('clearPrefs wipes everything and persists the empty set', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ favorites: ['friends'], watched: ['suits'], hidden: ['wire'] }),
    );
    const { result } = renderHook(() => useMoviePrefs());

    act(() => result.current.clearPrefs());
    expect(result.current.prefs).toEqual({ favorites: [], watched: [], hidden: [] });
    expect(readStorage()).toEqual({ favorites: [], watched: [], hidden: [] });
  });
});
