/**
 * useMoviePrefs
 *
 * Manages the user's discovery-page personalization (favorites / watched /
 * hidden) with localStorage persistence, mirroring the defensive load/save
 * style of useVocabulary.
 *
 * Public API:
 *   - prefs        : current MoviePrefs
 *   - isFavorite / isWatched / isHidden(id)
 *   - toggleFavorite / toggleWatched / toggleHidden(id)
 *   - clearPrefs   : wipe all personalization
 *
 * Storage key: `letv.moviePrefs.v1`. Corrupt or partial data degrades to the
 * empty preference set rather than throwing; writes that fail (private mode)
 * are silently ignored.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MoviePrefs } from '../types';

const STORAGE_KEY = 'letv.moviePrefs.v1';

const EMPTY: MoviePrefs = { favorites: [], watched: [], hidden: [] };

/** Keep only the string ids of a possibly-dirty array. */
function cleanIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];
}

/** Read prefs from localStorage, tolerating missing / corrupt data. */
function loadFromStorage(): MoviePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY };
    const p = parsed as Partial<MoviePrefs>;
    return {
      favorites: cleanIds(p.favorites),
      watched: cleanIds(p.watched),
      hidden: cleanIds(p.hidden),
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Persist prefs; swallow failures (private mode / quota). */
function saveToStorage(prefs: MoviePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore — preferences are best-effort.
  }
}

/** Toggle membership of `id` in a list (immutably). */
function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export interface UseMoviePrefsResult {
  prefs: MoviePrefs;
  isFavorite(id: string): boolean;
  isWatched(id: string): boolean;
  isHidden(id: string): boolean;
  toggleFavorite(id: string): void;
  toggleWatched(id: string): void;
  toggleHidden(id: string): void;
  clearPrefs(): void;
}

export function useMoviePrefs(): UseMoviePrefsResult {
  const [prefs, setPrefs] = useState<MoviePrefs>(() => loadFromStorage());

  // Persist on every change.
  useEffect(() => {
    saveToStorage(prefs);
  }, [prefs]);

  const toggleFavorite = useCallback(
    (id: string) => setPrefs((p) => ({ ...p, favorites: toggleIn(p.favorites, id) })),
    [],
  );
  const toggleWatched = useCallback(
    (id: string) => setPrefs((p) => ({ ...p, watched: toggleIn(p.watched, id) })),
    [],
  );
  const toggleHidden = useCallback(
    (id: string) => setPrefs((p) => ({ ...p, hidden: toggleIn(p.hidden, id) })),
    [],
  );
  const clearPrefs = useCallback(() => setPrefs({ ...EMPTY }), []);

  const isFavorite = useCallback((id: string) => prefs.favorites.includes(id), [prefs]);
  const isWatched = useCallback((id: string) => prefs.watched.includes(id), [prefs]);
  const isHidden = useCallback((id: string) => prefs.hidden.includes(id), [prefs]);

  return useMemo(
    () => ({
      prefs,
      isFavorite,
      isWatched,
      isHidden,
      toggleFavorite,
      toggleWatched,
      toggleHidden,
      clearPrefs,
    }),
    [prefs, isFavorite, isWatched, isHidden, toggleFavorite, toggleWatched, toggleHidden, clearPrefs],
  );
}
