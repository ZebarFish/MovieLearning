/**
 * movieRecommend
 *
 * Pure helpers for the "discover movies" feature: filtering, scoring,
 * sorting and deterministic shuffling over the curated MOVIE_CATALOG.
 *
 * Design notes:
 *  - Every function here is a pure function and never mutates its inputs.
 *  - Within a dimension (langs / genres) the rule is OR (matching ANY
 *    selected value passes); across dimensions the rule is AND.
 *  - Personalization (favorites / watched / hidden) is handled in `scoreMovie`
 *    and `sortMovies`. `filterMovies` intentionally does NOT take prefs: the
 *    UI removes hidden items up-front via `applyPrefs` BEFORE filtering/sorting
 *    so a hidden entry never reaches the visible grid. `scoreMovie` still
 *    slams hidden entries to the bottom as a belt-and-braces guard.
 */
import type {
  Level1to5,
  MovieEntry,
  MovieFilter,
  MovieGenre,
  MoviePrefs,
  MovieSortKey,
  SubtitleLang,
} from '../types';

/** All 15 genres, in a stable display order. */
export const ALL_GENRES: MovieGenre[] = [
  'drama',
  'comedy',
  'crime',
  'thriller',
  'sci-fi',
  'animation',
  'documentary',
  'action',
  'romance',
  'fantasy',
  'adventure',
  'history',
  'music',
  'family',
  'mystery',
];

/** Chinese labels for genres (used by the UI filter bar + cards). */
export const GENRE_LABELS: Record<MovieGenre, string> = {
  drama: '剧情',
  comedy: '喜剧',
  crime: '犯罪',
  thriller: '惊悚',
  'sci-fi': '科幻',
  animation: '动画',
  documentary: '纪录片',
  action: '动作',
  romance: '爱情',
  fantasy: '奇幻',
  adventure: '冒险',
  history: '历史',
  music: '音乐',
  family: '家庭',
  mystery: '悬疑',
};

/** Chinese labels for subtitle languages (no existing constant — defined here). */
export const LANG_LABELS: Record<SubtitleLang, string> = {
  en: '英语',
  zh: '中文',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  other: '其他',
};

/** The default, "show everything" filter. */
export const DEFAULT_FILTER: MovieFilter = {
  langs: [],
  genres: [],
  difficulty: [1, 5],
  mediaType: 'all',
  query: '',
};

const DIFFICULTY_LABELS: Record<Level1to5, string> = {
  1: '入门',
  2: '轻松',
  3: '进阶',
  4: '挑战',
  5: '硬核',
};

/** Human-readable difficulty bucket: 入门/轻松/进阶/挑战/硬核. */
export function difficultyLabel(level: Level1to5): string {
  return DIFFICULTY_LABELS[level] ?? '';
}

/**
 * Keep only entries that satisfy every active dimension of `filter`.
 * Pure & non-mutating. `hidden` items are NOT removed here — call
 * `applyPrefs` first if you want them gone (see module doc above).
 */
export function filterMovies(entries: MovieEntry[], filter: MovieFilter): MovieEntry[] {
  const query = filter.query.trim().toLowerCase();
  const [minDiff, maxDiff] = filter.difficulty;

  return entries.filter((entry) => {
    // Language: OR within selection.
    if (filter.langs.length > 0) {
      const hit = filter.langs.some((l) => entry.langs.includes(l));
      if (!hit) return false;
    }
    // Genre: OR within selection.
    if (filter.genres.length > 0) {
      const hit = filter.genres.some((g) => entry.genres.includes(g));
      if (!hit) return false;
    }
    // Difficulty: inclusive closed interval.
    if (entry.difficulty < minDiff || entry.difficulty > maxDiff) return false;
    // Media type.
    if (filter.mediaType !== 'all' && entry.mediaType !== filter.mediaType) {
      return false;
    }
    // Free-text query across title / originalTitle / tags / synopsis.
    if (query) {
      const haystack = [
        entry.title,
        entry.originalTitle,
        entry.tags.join(' '),
        entry.synopsis,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/**
 * Remove hidden entries entirely. Call this BEFORE `filterMovies` /
 * `sortMovies` so hidden items never appear in the grid.
 * Returns the same array reference when nothing is hidden (no copy needed).
 */
export function applyPrefs(entries: MovieEntry[], prefs: MoviePrefs): MovieEntry[] {
  const hidden = prefs?.hidden;
  if (!hidden || hidden.length === 0) return entries;
  const blocked = new Set(hidden);
  return entries.filter((entry) => !blocked.has(entry.id));
}

/**
 * Recommendation score in roughly [-1000, ~12]. Higher is better.
 * Combines filter fit (language / genre / difficulty proximity), quality
 * (rating + popularity) and personalization. Hidden items are slammed to a
 * huge negative so they sink to the bottom even if `applyPrefs` was skipped.
 */
export function scoreMovie(
  entry: MovieEntry,
  filter: MovieFilter,
  prefs: MoviePrefs,
): number {
  let score = 0;

  // Language match.
  if (filter.langs.length > 0 && filter.langs.some((l) => entry.langs.includes(l))) {
    score += 3;
  }
  // Genre match.
  if (filter.genres.length > 0 && filter.genres.some((g) => entry.genres.includes(g))) {
    score += 3;
  }
  // Difficulty proximity to the filter's midpoint (peaks at the middle,
  // falls off linearly toward the interval edges).
  const [minDiff, maxDiff] = filter.difficulty;
  const mid = (minDiff + maxDiff) / 2;
  const span = Math.max(maxDiff - minDiff, 1);
  const dist = Math.abs(entry.difficulty - mid);
  score += 2 * (1 - Math.min(dist / span, 1));
  // Quality signals.
  score += (entry.rating / 10) * 2; // 0~2
  score += (entry.popularity / 100) * 1; // 0~1
  // Personalization.
  if (prefs?.favorites?.includes(entry.id)) score += 3;
  if (prefs?.watched?.includes(entry.id)) score -= 1.5;
  if (prefs?.hidden?.includes(entry.id)) score -= 1000;

  return score;
}

/**
 * Sort a copy of `entries`. Always STABLE: equal scores keep their original
 * order (we break ties by the original index). `'match'` orders by
 * `scoreMovie` descending; the other keys are self-explanatory.
 */
export function sortMovies(
  entries: MovieEntry[],
  sort: MovieSortKey,
  filter: MovieFilter,
  prefs: MoviePrefs,
): MovieEntry[] {
  const indexed = entries.map((entry, index) => ({ entry, index }));
  indexed.sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case 'match':
        cmp = scoreMovie(b.entry, filter, prefs) - scoreMovie(a.entry, filter, prefs);
        break;
      case 'rating':
        cmp = b.entry.rating - a.entry.rating;
        break;
      case 'difficulty-asc':
        cmp = a.entry.difficulty - b.entry.difficulty;
        break;
      case 'difficulty-desc':
        cmp = b.entry.difficulty - a.entry.difficulty;
        break;
      case 'year':
        cmp = b.entry.year - a.entry.year;
        break;
    }
    if (cmp !== 0) return cmp;
    return a.index - b.index; // stable tiebreak
  });
  return indexed.map((x) => x.entry);
}

/**
 * mulberry32 — a tiny, fast, deterministic PRNG. Seeded identically it yields
 * an identical stream, so our shuffles are reproducible (no Math.random).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher–Yates shuffle. Returns a NEW array; never mutates the
 * input. Same `(items, seed)` always produces the same order.
 */
export function shuffleMovies<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Deterministically draw up to `size` entries from `entries` (the "换一批"
 * / shuffle-and-show use case). The result is a subset with no duplicates and
 * its length is `min(size, entries.length)`.
 */
export function pickBatch(
  entries: MovieEntry[],
  size: number,
  seed: number,
): MovieEntry[] {
  const shuffled = shuffleMovies(entries, seed);
  return shuffled.slice(0, Math.min(size, entries.length));
}

/**
 * One-line explanation of why an entry fits the current filter, for display
 * on the card. Falls back to a quality-based pitch when the filter is empty.
 */
export function describeFit(entry: MovieEntry, filter: MovieFilter): string {
  const reasons: string[] = [];

  if (filter.langs.length > 0 && filter.langs.some((l) => entry.langs.includes(l))) {
    reasons.push(`语言契合：${LANG_LABELS[filter.langs[0]] ?? '所选语言'}`);
  }
  if (filter.genres.length > 0 && filter.genres.some((g) => entry.genres.includes(g))) {
    reasons.push(`题材契合：${GENRE_LABELS[filter.genres[0]] ?? '所选题材'}`);
  }
  const [minDiff, maxDiff] = filter.difficulty;
  if (entry.difficulty >= minDiff && entry.difficulty <= maxDiff) {
    reasons.push(`难度${difficultyLabel(entry.difficulty)}`);
  }
  if (reasons.length === 0) {
    // No active dimension matched (e.g. an unfocused filter) — pitch on quality.
    reasons.push(`口碑 ${entry.rating.toFixed(1)} 分，适合练听力`);
  }
  return reasons.join('，');
}
