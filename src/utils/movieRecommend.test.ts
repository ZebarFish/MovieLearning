/**
 * movieRecommend.test.ts
 *
 * Unit-tests the pure filter / score / sort / shuffle helpers. We use small
 * fixtures for the behavior tests and the real catalog for coverage-style
 * assertions, so a regression is easy to localize.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_GENRES,
  DEFAULT_FILTER,
  applyPrefs,
  describeFit,
  difficultyLabel,
  filterMovies,
  pickBatch,
  scoreMovie,
  shuffleMovies,
  sortMovies,
} from './movieRecommend';
import { MOVIE_CATALOG } from '../data/movieCatalog';
import type { MovieEntry, MovieFilter, MoviePrefs } from '../types';

function entry(partial: Partial<MovieEntry> & Pick<MovieEntry, 'id'>): MovieEntry {
  return {
    title: partial.id,
    originalTitle: partial.id,
    year: 2020,
    primaryLang: 'en',
    langs: ['en'],
    genres: ['drama'],
    mediaType: 'movie',
    difficulty: 3,
    speechRate: 3,
    vocabulary: 3,
    dialogueDensity: 3,
    rating: 7,
    popularity: 50,
    synopsis: 'synopsis',
    tags: ['tag'],
    ...partial,
  };
}

const A = entry({
  id: 'a',
  langs: ['en'],
  genres: ['comedy'],
  difficulty: 2,
  mediaType: 'series',
  rating: 9,
  popularity: 80,
});
const B = entry({
  id: 'b',
  langs: ['ja'],
  genres: ['animation'],
  difficulty: 4,
  mediaType: 'movie',
  rating: 6,
  popularity: 20,
});
const C = entry({
  id: 'c',
  langs: ['en', 'fr'],
  genres: ['comedy', 'romance'],
  difficulty: 3,
  mediaType: 'series',
  rating: 8,
  popularity: 60,
});
const ALL = [A, B, C];

describe('difficultyLabel', () => {
  it('maps 1~5 to 入门/轻松/进阶/挑战/硬核', () => {
    expect(difficultyLabel(1)).toBe('入门');
    expect(difficultyLabel(2)).toBe('轻松');
    expect(difficultyLabel(3)).toBe('进阶');
    expect(difficultyLabel(4)).toBe('挑战');
    expect(difficultyLabel(5)).toBe('硬核');
  });
});

describe('filterMovies', () => {
  it('returns everything for the default (empty) filter', () => {
    expect(filterMovies(ALL, DEFAULT_FILTER)).toHaveLength(3);
  });

  it('ORs within the language dimension', () => {
    const f: MovieFilter = { ...DEFAULT_FILTER, langs: ['en', 'ja'] };
    const ids = filterMovies(ALL, f).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('ORs within the genre dimension', () => {
    const f: MovieFilter = { ...DEFAULT_FILTER, genres: ['animation', 'romance'] };
    const ids = filterMovies(ALL, f).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['b', 'c']));
    expect(ids).not.toContain('a');
  });

  it('ANDs across dimensions (lang + genre + mediaType)', () => {
    const f: MovieFilter = {
      ...DEFAULT_FILTER,
      langs: ['en'],
      genres: ['comedy'],
      mediaType: 'series',
    };
    const ids = filterMovies(ALL, f).map((e) => e.id);
    // a: en+comedy+series ✓; c: en+comedy but series ✓ as well
    expect(ids).toEqual(expect.arrayContaining(['a', 'c']));
    expect(ids).not.toContain('b');
  });

  it('respects the inclusive difficulty interval', () => {
    const f: MovieFilter = { ...DEFAULT_FILTER, difficulty: [2, 3] };
    const ids = filterMovies(ALL, f).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['a', 'c']));
    expect(ids).not.toContain('b'); // difficulty 4
    // boundary endpoints are included
    expect(filterMovies(ALL, { ...DEFAULT_FILTER, difficulty: [2, 2] })).toContainEqual(A);
  });

  it('matches the query case-insensitively across fields', () => {
    const byTitle = filterMovies([A], { ...DEFAULT_FILTER, query: 'A' });
    expect(byTitle).toHaveLength(1);
    // tags / synopsis are also searchable (case-insensitive)
    expect(filterMovies([C], { ...DEFAULT_FILTER, query: 'tag' })).toHaveLength(1);
    expect(filterMovies([C], { ...DEFAULT_FILTER, query: 'TAG' })).toHaveLength(1);
    expect(filterMovies([A], { ...DEFAULT_FILTER, query: 'synopsis' })).toHaveLength(1);
    expect(filterMovies([A], { ...DEFAULT_FILTER, query: 'zzz' })).toHaveLength(0);
  });

  it('does not mutate its input array', () => {
    const input = [A, B, C];
    filterMovies(input, { ...DEFAULT_FILTER, langs: ['ja'] });
    expect(input).toHaveLength(3);
  });
});

describe('applyPrefs', () => {
  it('removes hidden items and leaves others untouched', () => {
    const prefs: MoviePrefs = { favorites: [], watched: [], hidden: ['b'] };
    const out = applyPrefs(ALL, prefs);
    expect(out.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('returns the same reference when nothing is hidden (no copy)', () => {
    expect(applyPrefs(ALL, { favorites: [], watched: [], hidden: [] })).toBe(ALL);
  });
});

describe('scoreMovie', () => {
  const prefs: MoviePrefs = { favorites: [], watched: [], hidden: [] };

  it('rewards favorites, penalizes watched, and crushes hidden', () => {
    const f: MovieFilter = DEFAULT_FILTER;
    const base = scoreMovie(A, f, { favorites: [], watched: [], hidden: [] });
    const fav = scoreMovie(A, f, { favorites: ['a'], watched: [], hidden: [] });
    const watched = scoreMovie(A, f, { favorites: [], watched: ['a'], hidden: [] });
    const hidden = scoreMovie(A, f, { favorites: [], watched: [], hidden: ['a'] });

    expect(fav).toBeGreaterThan(base);
    expect(watched).toBeLessThan(base);
    expect(hidden).toBeLessThan(-500);
  });

  it('rewards language + genre matches under a focused filter', () => {
    const f: MovieFilter = { ...DEFAULT_FILTER, langs: ['en'], genres: ['comedy'] };
    const matched = scoreMovie(A, f, prefs); // en + comedy
    const unmatched = scoreMovie(B, f, prefs); // ja + animation
    expect(matched).toBeGreaterThan(unmatched);
  });

  it('prefers entries near the difficulty midpoint of the filter', () => {
    const f: MovieFilter = { ...DEFAULT_FILTER, difficulty: [3, 3] };
    const onPoint = scoreMovie(C, f, prefs); // difficulty 3
    const offPoint = scoreMovie(A, f, prefs); // difficulty 2
    expect(onPoint).toBeGreaterThan(offPoint);
  });
});

describe('sortMovies', () => {
  it('sorts by rating descending', () => {
    const ids = sortMovies(ALL, 'rating', DEFAULT_FILTER, { favorites: [], watched: [], hidden: [] }).map(
      (e) => e.id,
    );
    expect(ids[0]).toBe('a'); // rating 9
    expect(ids[ids.length - 1]).toBe('b'); // rating 6
  });

  it('sorts by difficulty asc / desc', () => {
    const asc = sortMovies(ALL, 'difficulty-asc', DEFAULT_FILTER, {
      favorites: [],
      watched: [],
      hidden: [],
    }).map((e) => e.difficulty);
    const desc = sortMovies(ALL, 'difficulty-desc', DEFAULT_FILTER, {
      favorites: [],
      watched: [],
      hidden: [],
    }).map((e) => e.difficulty);
    expect(asc).toEqual([2, 3, 4]);
    expect(desc).toEqual([4, 3, 2]);
  });

  it('sorts by year descending', () => {
    const years = sortMovies(
      [entry({ id: 'x', year: 2000 }), entry({ id: 'y', year: 2022 }), entry({ id: 'z', year: 2010 })],
      'year',
      DEFAULT_FILTER,
      { favorites: [], watched: [], hidden: [] },
    ).map((e) => e.year);
    expect(years).toEqual([2022, 2010, 2000]);
  });

  it('is stable: equal scores keep original order', () => {
    // All three have identical rating/popularity/difficulty here, so a pure
    // rating sort must preserve insertion order (a, b, c).
    const same = [
      entry({ id: 'a', rating: 5, popularity: 5, difficulty: 3 }),
      entry({ id: 'b', rating: 5, popularity: 5, difficulty: 3 }),
      entry({ id: 'c', rating: 5, popularity: 5, difficulty: 3 }),
    ];
    const ids = sortMovies(same, 'rating', DEFAULT_FILTER, {
      favorites: [],
      watched: [],
      hidden: [],
    }).map((e) => e.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it("'match' orders by scoreMovie descending and pushes hidden to the end", () => {
    const ranked = sortMovies(
      ALL,
      'match',
      { ...DEFAULT_FILTER, langs: ['en'], genres: ['comedy'] },
      { favorites: [], watched: [], hidden: ['b'] },
    ).map((e) => e.id);
    expect(ranked[ranked.length - 1]).toBe('b'); // hidden sinks
  });
});

describe('shuffleMovies', () => {
  const input = Array.from({ length: 20 }, (_, i) => i);

  it('is deterministic for a given seed', () => {
    expect(shuffleMovies(input, 42)).toEqual(shuffleMovies(input, 42));
  });

  it('produces a different order for a different seed', () => {
    const a = shuffleMovies(input, 1);
    const b = shuffleMovies(input, 2);
    expect(a).not.toEqual(b);
  });

  it('does not mutate the input array', () => {
    const before = [...input];
    shuffleMovies(input, 7);
    expect(input).toEqual(before);
  });

  it('is a permutation (same elements, no loss/dup)', () => {
    const out = shuffleMovies(input, 99);
    expect(out.slice().sort((x, y) => x - y)).toEqual(input);
    expect(new Set(out).size).toBe(out.length);
  });
});

describe('pickBatch', () => {
  it('returns up to `size` items, subset with no duplicates', () => {
    const batch = pickBatch(MOVIE_CATALOG, 10, 123);
    expect(batch).toHaveLength(10);
    expect(new Set(batch.map((e) => e.id)).size).toBe(10);
    expect(batch.every((e) => MOVIE_CATALOG.includes(e))).toBe(true);
  });

  it('caps at the catalog length when size exceeds it', () => {
    const batch = pickBatch(MOVIE_CATALOG, 9999, 5);
    expect(batch).toHaveLength(MOVIE_CATALOG.length);
  });

  it('is deterministic for a fixed seed', () => {
    expect(pickBatch(ALL, 3, 8).map((e) => e.id)).toEqual(
      pickBatch(ALL, 3, 8).map((e) => e.id),
    );
  });
});

describe('describeFit', () => {
  it('explains a language + genre match', () => {
    const text = describeFit(A, { ...DEFAULT_FILTER, langs: ['en'], genres: ['comedy'] });
    expect(text).toContain('语言契合');
    expect(text).toContain('题材契合');
  });

  it('falls back to a quality pitch when no filter dimension matches', () => {
    // A (difficulty 2) is outside the [4,5] range and there are no lang/genre
    // selections, so the fallback quality pitch should be used.
    const text = describeFit(A, { ...DEFAULT_FILTER, difficulty: [4, 5] });
    expect(text).toContain('口碑');
  });
});

describe('catalog integration', () => {
  it('every genre label is defined for all catalog genres', () => {
    for (const m of MOVIE_CATALOG) {
      for (const g of m.genres) {
        expect(ALL_GENRES).toContain(g);
      }
    }
  });
});
