/**
 * posters.test.ts
 *
 * The poster resolver must be robust on a flaky, partly-blocked network:
 * providers are tried in order, a provider that answers with the WRONG title is
 * rejected, hits are cached, and misses expire instead of sticking forever.
 *
 * `fetch` is stubbed per-test; the real network is never touched. Note that
 * USE_LOCAL_PROXY is false under Vitest, so the provider URLs are the real
 * hosts and `proxiedImage` is a pass-through (except in the last describe,
 * where the proxy decision is mocked).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPosterCache, fetchPosterUrl, proxiedImage } from './posters';
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

afterEach(() => {
  clearPosterCache();
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
      [
        /douban\.com/,
        () => json([{ title: '千与千寻', img: 'https://img1.doubanio.com/p.jpg' }]),
      ],
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

  it('falls through to iTunes when the earlier providers miss', async () => {
    const fn = mockFetch([
      [
        /itunes\.apple\.com/,
        () =>
          json({
            results: [
              { trackName: 'Friends', artworkUrl100: 'https://is1-ssl.mzstatic.com/a/100x100bb.jpg' },
            ],
          }),
      ],
    ]);

    // No TVmaze and no Douban route → both 404 → iTunes answers.
    const url = await fetchPosterUrl(entry());
    expect(url).toBe('https://is1-ssl.mzstatic.com/a/600x600bb.jpg');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('wrong-title guard', () => {
  it('rejects a TVmaze match for a different show and moves on', async () => {
    mockFetch([
      [
        /tvmaze\.com/,
        () => json({ name: 'Frasier', image: { medium: 'https://static.tvmaze.com/wrong.jpg' } }),
      ],
      [
        /douban\.com/,
        () => json([{ title: '老友记 第一季', img: 'https://img1.doubanio.com/right.jpg' }]),
      ],
    ]);

    expect(await fetchPosterUrl(entry())).toBe('https://img1.doubanio.com/right.jpg');
  });

  it('ignores a Douban hit whose title does not match', async () => {
    mockFetch([
      [
        /douban\.com/,
        () => json([{ title: '完全无关的片子', img: 'https://img1.doubanio.com/wrong.jpg' }]),
      ],
      [/itunes\.apple\.com/, () => json({ results: [] })],
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

    const raw = localStorage.getItem('letv.poster.v2.friends');
    expect(raw).toBeTruthy();
    expect(raw?.startsWith('{')).toBe(true);
    const parsed = JSON.parse(raw ?? '{}') as { at?: unknown };
    expect(typeof parsed.at).toBe('number');
  });

  it('honours a fresh miss without touching the network', async () => {
    localStorage.setItem(
      'letv.poster.v2.friends',
      JSON.stringify({ at: Date.now() }),
    );
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
    localStorage.setItem('letv.poster.v2.friends', JSON.stringify({ at: aged }));
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
    // Douban's CDN rejects hotlinks, so this rewrite is what makes its posters
    // usable at all — worth locking down.
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
