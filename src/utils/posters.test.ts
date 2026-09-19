/**
 * posters.test.ts
 *
 * The poster resolver must be robust on a flaky, partly-blocked network:
 * providers are tried in order, a provider that answers with the WRONG title is
 * rejected, a source that starts failing hard is abandoned instead of hammered,
 * hits are cached, and misses expire instead of sticking forever.
 *
 * `fetch` is stubbed per-test; the real network is never touched. Note that
 * USE_LOCAL_PROXY is false under Vitest, so the provider URLs are the real
 * hosts and `proxiedImage` is a pass-through (except in the last describe,
 * where the proxy decision is mocked).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Controllable stand-in for the TMDB module (see the "with a key" describe). */
const tmdb = vi.hoisted(() => ({
  key: false,
  url: null as string | null,
  calls: 0,
}));

vi.mock('./tmdb', () => ({
  hasTmdbApiKey: () => tmdb.key,
  fetchPosterUrl: async () => {
    tmdb.calls += 1;
    return tmdb.url;
  },
}));

import {
  clearPosterCache,
  fetchPosterUrl,
  isDoubanBlocked,
  proxiedImage,
  resetPosterSources,
} from './posters';
import type { MovieEntry } from '../types';

function entry(over: Partial<MovieEntry> = {}): MovieEntry {
  return {
    id: 'friends',
    title: '老友记',
    originalTitle: 'Friends',
    year: 1994,
    primaryLang: 'en',
    langs: ['en'],
    genres: ['comedy'],
    mediaType: 'series',
    difficulty: 2,
    speechRate: 2,
    vocabulary: 2,
    dialogueDensity: 5,
    rating: 8.9,
    popularity: 96,
    synopsis: '六位纽约好友的日常，对白密集、用词生活化。',
    tags: ['美音', '情景喜剧'],
    ...over,
  };
}

function json(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => data } as unknown as Response;
}

type Route = [RegExp, () => Response];

/** Route requests by URL; anything unmatched behaves like a 404. */
function mockFetch(routes: Route[]) {
  const fn = vi.fn(async (url: unknown): Promise<Response> => {
    const u = String(url);
    for (const [re, make] of routes) {
      if (re.test(u)) return make();
    }
    return json(null, false, 404);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function callUrl(fn: { mock: { calls: unknown[][] } }, index: number): string {
  return String(fn.mock.calls[index]?.[0]);
}

const DOUBAN_HIT = (title: string, img: string): Route => [
  /douban\.com/,
  () => json([{ title, img }]),
];

beforeEach(() => {
  tmdb.key = false;
  tmdb.url = null;
  tmdb.calls = 0;
});

afterEach(() => {
  clearPosterCache();
  resetPosterSources();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('provider order', () => {
  it('resolves a series poster from TVmaze first', async () => {
    const fn = mockFetch([
      [
        /tvmaze\.com/,
        () => json({ name: 'Friends', image: { medium: 'https://static.tvmaze.com/f.jpg' } }),
      ],
    ]);

    expect(await fetchPosterUrl(entry())).toBe('https://static.tvmaze.com/f.jpg');
    expect(callUrl(fn, 0)).toContain('api.tvmaze.com');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('tries Douban first for films', async () => {
    const fn = mockFetch([
      DOUBAN_HIT('千与千寻', 'https://img1.doubanio.com/p.jpg'),
    ]);

    const movie = entry({
      id: 'spirited-away',
      title: '千与千寻',
      originalTitle: 'Spirited Away',
      mediaType: 'movie',
    });
    expect(await fetchPosterUrl(movie)).toBe('https://img1.doubanio.com/p.jpg');
    expect(callUrl(fn, 0)).toContain('movie.douban.com');
  });

  it('falls back to Douban when TVmaze misses a series', async () => {
    const fn = mockFetch([
      DOUBAN_HIT('老友记 第一季', 'https://img1.doubanio.com/f.jpg'),
    ]);

    expect(await fetchPosterUrl(entry())).toBe('https://img1.doubanio.com/f.jpg');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(callUrl(fn, 1)).toContain('movie.douban.com');
  });

  it('never asks iTunes — the provider was removed', async () => {
    const fn = mockFetch([]);
    await fetchPosterUrl(entry());
    const urls = fn.mock.calls.map((_c, i) => callUrl(fn, i));
    expect(urls.some((u) => u.includes('itunes'))).toBe(false);
  });
});

describe('with a TMDB key', () => {
  it('consults TMDB first and never touches the keyless sources on a hit', async () => {
    tmdb.key = true;
    tmdb.url = 'https://image.tmdb.org/t/p/w342/abc.jpg';
    const fn = mockFetch([]);

    expect(await fetchPosterUrl(entry())).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
    expect(tmdb.calls).toBe(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('degrades to the keyless sources when TMDB returns nothing', async () => {
    tmdb.key = true;
    tmdb.url = null;
    const fn = mockFetch([
      [
        /tvmaze\.com/,
        () => json({ name: 'Friends', image: { medium: 'https://static.tvmaze.com/f.jpg' } }),
      ],
    ]);

    expect(await fetchPosterUrl(entry())).toBe('https://static.tvmaze.com/f.jpg');
    expect(tmdb.calls).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('wrong-title guard', () => {
  it('rejects a TVmaze match for a different show and moves on', async () => {
    mockFetch([
      [
        /tvmaze\.com/,
        () => json({ name: 'Frasier', image: { medium: 'https://static.tvmaze.com/wrong.jpg' } }),
      ],
      DOUBAN_HIT('老友记 第一季', 'https://img1.doubanio.com/right.jpg'),
    ]);

    expect(await fetchPosterUrl(entry())).toBe('https://img1.doubanio.com/right.jpg');
  });

  it('ignores a Douban hit whose title does not match', async () => {
    mockFetch([
      DOUBAN_HIT('完全无关的片子', 'https://img1.doubanio.com/wrong.jpg'),
    ]);

    const movie = entry({
      id: 'spirited-away',
      title: '千与千寻',
      originalTitle: 'Spirited Away',
      mediaType: 'movie',
    });
    expect(await fetchPosterUrl(movie)).toBeNull();
  });

  it('returns null when every provider misses', async () => {
    mockFetch([]);
    expect(await fetchPosterUrl(entry())).toBeNull();
  });
});

describe('Douban circuit breaker', () => {
  /** 403 = Douban refusing us, which is what the breaker is for. */
  function always403() {
    return mockFetch([[/douban\.com/, () => json(null, false, 403)]]);
  }

  it('stops calling Douban after repeated hard failures', async () => {
    const fn = always403();

    // Three failing lookups trip the breaker …
    await fetchPosterUrl(entry({ id: 'a', mediaType: 'movie' }));
    await fetchPosterUrl(entry({ id: 'b', mediaType: 'movie' }));
    await fetchPosterUrl(entry({ id: 'c', mediaType: 'movie' }));
    expect(isDoubanBlocked()).toBe(true);
    const callsBefore = fn.mock.calls.length;

    // … and after that the source is not contacted at all.
    await fetchPosterUrl(entry({ id: 'd', mediaType: 'movie' }));
    expect(fn.mock.calls.length).toBe(callsBefore);
  });

  it('does NOT trip on an empty result set — that is a legitimate miss', async () => {
    mockFetch([[/douban\.com/, () => json([])]]);

    await fetchPosterUrl(entry({ id: 'a', mediaType: 'movie' }));
    await fetchPosterUrl(entry({ id: 'b', mediaType: 'movie' }));
    await fetchPosterUrl(entry({ id: 'c', mediaType: 'movie' }));
    await fetchPosterUrl(entry({ id: 'd', mediaType: 'movie' }));

    expect(isDoubanBlocked()).toBe(false);
  });

  it('a success resets the failure streak', async () => {
    always403();
    await fetchPosterUrl(entry({ id: 'a', mediaType: 'movie' }));
    await fetchPosterUrl(entry({ id: 'b', mediaType: 'movie' }));
    expect(isDoubanBlocked()).toBe(false);

    // A success must clear the count, so the next two failures still do not
    // trip it — otherwise an occasional error would eventually disable the
    // source for everyone.
    vi.unstubAllGlobals();
    mockFetch([DOUBAN_HIT('老友记', 'https://img1.doubanio.com/f.jpg')]);
    await fetchPosterUrl(entry({ id: 'c' }));
    expect(isDoubanBlocked()).toBe(false);

    vi.unstubAllGlobals();
    always403();
    await fetchPosterUrl(entry({ id: 'd', mediaType: 'movie' }));
    await fetchPosterUrl(entry({ id: 'e', mediaType: 'movie' }));
    expect(isDoubanBlocked()).toBe(false);
  });

  it('a single failure does not trip it', async () => {
    always403();
    await fetchPosterUrl(entry({ id: 'a', mediaType: 'movie' }));
    expect(isDoubanBlocked()).toBe(false);
  });

  it('resetPosterSources clears the breaker', async () => {
    always403();
    await fetchPosterUrl(entry({ id: 'a', mediaType: 'movie' }));
    await fetchPosterUrl(entry({ id: 'b', mediaType: 'movie' }));
    await fetchPosterUrl(entry({ id: 'c', mediaType: 'movie' }));
    expect(isDoubanBlocked()).toBe(true);

    resetPosterSources();
    expect(isDoubanBlocked()).toBe(false);
  });
});

describe('caching', () => {
  it('serves a repeat lookup from cache without touching the network', async () => {
    const fn = mockFetch([
      [
        /tvmaze\.com/,
        () => json({ name: 'Friends', image: { medium: 'https://static.tvmaze.com/f.jpg' } }),
      ],
    ]);

    await fetchPosterUrl(entry());
    const calls = fn.mock.calls.length;
    expect(await fetchPosterUrl(entry())).toBe('https://static.tvmaze.com/f.jpg');
    expect(fn.mock.calls.length).toBe(calls);
  });

  it('persists a miss with a timestamp rather than a bare sentinel', async () => {
    mockFetch([]);
    await fetchPosterUrl(entry());

    const raw = localStorage.getItem('letv.poster.v3.friends');
    expect(raw).toBeTruthy();
    expect(raw?.startsWith('{')).toBe(true);
    const parsed = JSON.parse(raw ?? '{}') as { at?: unknown };
    expect(typeof parsed.at).toBe('number');
  });

  it('does not reuse the retired v2 (iTunes-era) cache entries', async () => {
    // A stale v2 hit must be ignored: its URL may point at a host the image
    // proxy no longer allows, which would render as a broken image.
    localStorage.setItem('letv.poster.v2.friends', 'https://is1-ssl.mzstatic.com/a.jpg');
    const fn = mockFetch([
      [
        /tvmaze\.com/,
        () => json({ name: 'Friends', image: { medium: 'https://static.tvmaze.com/f.jpg' } }),
      ],
    ]);

    expect(await fetchPosterUrl(entry())).toBe('https://static.tvmaze.com/f.jpg');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honours a fresh miss without touching the network', async () => {
    localStorage.setItem('letv.poster.v3.friends', JSON.stringify({ at: Date.now() }));
    const fn = mockFetch([
      [
        /tvmaze\.com/,
        () => json({ name: 'Friends', image: { medium: 'https://static.tvmaze.com/f.jpg' } }),
      ],
    ]);

    expect(await fetchPosterUrl(entry())).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('retries a miss that is older than the TTL', async () => {
    const aged = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem('letv.poster.v3.friends', JSON.stringify({ at: aged }));
    const fn = mockFetch([
      [
        /tvmaze\.com/,
        () => json({ name: 'Friends', image: { medium: 'https://static.tvmaze.com/fresh.jpg' } }),
      ],
    ]);

    expect(await fetchPosterUrl(entry())).toBe('https://static.tvmaze.com/fresh.jpg');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after clearPosterCache', async () => {
    const fn = mockFetch([]);
    await fetchPosterUrl(entry());
    const before = fn.mock.calls.length;

    clearPosterCache();
    await fetchPosterUrl(entry());
    expect(fn.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('image proxying', () => {
  it('passes the URL through when there is no local server', () => {
    // USE_LOCAL_PROXY is false under Vitest, so nothing is rewritten.
    expect(proxiedImage('https://img1.doubanio.com/a.jpg')).toBe(
      'https://img1.doubanio.com/a.jpg',
    );
  });

  it('routes the image through /poster-img when served locally', async () => {
    // Douban's CDN rejects hotlinks (418/403), so this rewrite is what makes
    // its posters usable at all — worth locking down.
    vi.resetModules();
    vi.doMock('./localProxy', () => ({ USE_LOCAL_PROXY: true }));
    try {
      const mod = await import('./posters');
      const raw = 'https://img1.doubanio.com/a.jpg';
      expect(mod.proxiedImage(raw)).toBe(
        `/poster-img?u=${encodeURIComponent(raw)}`,
      );
    } finally {
      vi.doUnmock('./localProxy');
      vi.resetModules();
    }
  });
});
