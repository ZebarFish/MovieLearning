/**
 * movieCatalog.test.ts
 *
 * Guards the curated catalog's structural + content invariants so a bad edit
 * (forgotten field, broken lang coverage, duplicated id) fails loudly instead
 * of shipping a broken discover page.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG_LANGS, MOVIE_CATALOG } from './movieCatalog';
import { ALL_GENRES } from '../utils/movieRecommend';
import type { MovieEntry, MovieGenre, SubtitleLang } from '../types';

const GENRE_SET = new Set<string>(ALL_GENRES);

describe('MOVIE_CATALOG', () => {
  it('has at least 48 entries', () => {
    expect(MOVIE_CATALOG.length).toBeGreaterThanOrEqual(48);
  });

  it('has unique lowercase-slug ids', () => {
    const ids = MOVIE_CATALOG.map((m) => m.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('every entry has a non-empty langs array containing primaryLang', () => {
    for (const m of MOVIE_CATALOG) {
      expect(Array.isArray(m.langs) && m.langs.length).toBeGreaterThan(0);
      expect(m.langs).toContain(m.primaryLang);
    }
  });

  it('every entry has a non-empty genres array, all within ALL_GENRES', () => {
    for (const m of MOVIE_CATALOG) {
      expect(Array.isArray(m.genres) && m.genres.length).toBeGreaterThan(0);
      for (const g of m.genres) {
        expect(GENRE_SET.has(g)).toBe(true);
      }
    }
  });

  it('the four 1~5 level fields are all integers in range', () => {
    const levels = ['difficulty', 'speechRate', 'vocabulary', 'dialogueDensity'] as const;
    for (const m of MOVIE_CATALOG) {
      for (const key of levels) {
        const v = m[key];
        expect(Number.isInteger(v), `${m.id}.${key} integer`).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(5);
      }
    }
  });

  it('difficulty is broadly self-consistent with its sub-metrics', () => {
    // A high speech rate alone (e.g. a fast but simple cartoon) should not
    // force a high overall difficulty; require the *combination* of slow
    // difficulty AND two genuinely hard metrics to flag incoherence.
    for (const m of MOVIE_CATALOG) {
      if (m.difficulty <= 2) {
        const hardMetrics = [m.vocabulary, m.dialogueDensity].filter((x) => x >= 4).length;
        expect(hardMetrics, `${m.id} easy difficulty but many hard metrics`).toBeLessThan(2);
      }
      if (m.difficulty >= 5) {
        const hardMetrics = [m.speechRate, m.vocabulary, m.dialogueDensity].filter(
          (x) => x >= 4,
        ).length;
        expect(hardMetrics, `${m.id} top difficulty but no hard metrics`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('rating is within 0~10 and popularity within 0~100', () => {
    for (const m of MOVIE_CATALOG) {
      expect(m.rating).toBeGreaterThanOrEqual(0);
      expect(m.rating).toBeLessThanOrEqual(10);
      expect(Number.isFinite(m.rating)).toBe(true);
      expect(m.popularity).toBeGreaterThanOrEqual(0);
      expect(m.popularity).toBeLessThanOrEqual(100);
      expect(Number.isInteger(m.popularity)).toBe(true);
    }
  });

  it('synopsis and tags are non-empty', () => {
    for (const m of MOVIE_CATALOG) {
      expect(m.synopsis.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(m.tags) && m.tags.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('contains both movies and series', () => {
    const types = new Set(MOVIE_CATALOG.map((m) => m.mediaType));
    expect(types.has('movie')).toBe(true);
    expect(types.has('series')).toBe(true);
  });

  it('covers every language quota', () => {
    const count = (lang: SubtitleLang) =>
      MOVIE_CATALOG.filter((m) => m.primaryLang === lang).length;
    expect(count('en')).toBeGreaterThanOrEqual(28);
    expect(count('ja')).toBeGreaterThanOrEqual(5);
    expect(count('ko')).toBeGreaterThanOrEqual(4);
    expect(count('fr')).toBeGreaterThanOrEqual(4);
    expect(count('de')).toBeGreaterThanOrEqual(3);
    expect(count('es')).toBeGreaterThanOrEqual(3);
  });

  it('covers every genre at least twice', () => {
    const byGenre = new Map<MovieGenre, number>();
    for (const m of MOVIE_CATALOG) {
      for (const g of m.genres) {
        byGenre.set(g, (byGenre.get(g) ?? 0) + 1);
      }
    }
    for (const g of ALL_GENRES) {
      expect(byGenre.get(g) ?? 0, `genre ${g} coverage`).toBeGreaterThanOrEqual(2);
    }
  });

  it('spans the full 1~5 difficulty range', () => {
    const diffs = new Set(MOVIE_CATALOG.map((m) => m.difficulty));
    for (const d of [1, 2, 3, 4, 5]) {
      expect(diffs.has(d as MovieEntry['difficulty']), `difficulty ${d} present`).toBe(true);
    }
  });

  it('keeps a deep bench of entry-level and easy picks', () => {
    // Listening practice is the whole point of the tool, and learners bounce
    // off a catalog that only offers hard material — so the easy end has to
    // stay wide. This guards against a future edit quietly thinning it out.
    const entryLevel = MOVIE_CATALOG.filter((m) => m.difficulty === 1).length;
    const easy = MOVIE_CATALOG.filter((m) => m.difficulty <= 2).length;
    expect(entryLevel).toBeGreaterThanOrEqual(15);
    expect(easy).toBeGreaterThanOrEqual(70);
  });

  it('CATALOG_LANGS matches the languages actually present, in stable order', () => {
    const present = new Set<SubtitleLang>();
    for (const m of MOVIE_CATALOG) {
      for (const l of m.langs) present.add(l);
    }
    expect(new Set(CATALOG_LANGS)).toEqual(present);
    // Stable display order: english first, then the rest in LANG_ORDER.
    expect(CATALOG_LANGS[0]).toBe('en');
  });
});
