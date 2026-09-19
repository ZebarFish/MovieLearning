/**
 * tmdb.test.ts
 *
 * Poster enrichment is optional and must never throw. We verify: no key →
 * hasTmdbApiKey() false and fetchPosterUrl() null; set/get round-trip; a
 * successful fetch returns a w342 URL; and the cache prevents a second network
 * request for the same id.
 *
 * `fetch` is stubbed per-test; the real network is never touched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TMDB_KEY_STORAGE,
  clearTmdbCache,
  fetchPosterUrl,
  getTmdbApiKey,
  hasTmdbApiKey,
  setTmdbApiKey,
} from './tmdb';

function okResponse(posterPath: string): Response {
  return {
    ok: true,
    json: async () => ({ poster_path: posterPath }),
  } as unknown as Response;
}

afterEach(() => {
  clearTmdbCache();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('api key handling', () => {
  it('reports no key and returns null without one', async () => {
    expect(hasTmdbApiKey()).toBe(false);
    expect(getTmdbApiKey()).toBe('');
    expect(await fetchPosterUrl(123)).toBeNull();
  });

  it('set/get round-trips through localStorage', () => {
    setTmdbApiKey('abc123');
    expect(getTmdbApiKey()).toBe('abc123');
    expect(hasTmdbApiKey()).toBe(true);
  });

  it('returns null for an invalid id even with a key', async () => {
    setTmdbApiKey('k');
    expect(await fetchPosterUrl(NaN)).toBeNull();
    expect(await fetchPosterUrl(Infinity)).toBeNull();
  });
});

describe('fetchPosterUrl', () => {
  it('returns a w342 image URL on success', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () => okResponse('/abc.jpg'));
    vi.stubGlobal('fetch', fetchMock);

    const url = await fetchPosterUrl(550);
    expect(url).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // request was routed to the absolute API host (USE_LOCAL_PROXY is false in tests)
    const firstCall = ((fetchMock.mock.calls as unknown as unknown[][])[0])?.[0];
    expect(typeof firstCall === 'string' && firstCall).toContain(
      'api.themoviedb.org/3/movie/550',
    );
  });

  it('returns null on a non-200 response', async () => {
    setTmdbApiKey('k');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response),
    );
    expect(await fetchPosterUrl(550)).toBeNull();
  });

  it('returns null on a network error (never throws)', async () => {
    setTmdbApiKey('k');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    await expect(fetchPosterUrl(550)).resolves.toBeNull();
  });

  it('returns null when poster_path is missing', async () => {
    setTmdbApiKey('k');
    vi.stubGlobal('fetch', vi.fn(async () => okResponse('')));
    expect(await fetchPosterUrl(550)).toBeNull();
  });

  it('caches the result so the network is hit only once', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () => okResponse('/cached.jpg'));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchPosterUrl(999);
    const second = await fetchPosterUrl(999);
    expect(first).toBe('https://image.tmdb.org/t/p/w342/cached.jpg');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('persists the cache across clearTmdbCache calls in memory? (memory cleared, localStorage kept)', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () => okResponse('/persist.jpg'));
    vi.stubGlobal('fetch', fetchMock);

    await fetchPosterUrl(111);
    clearTmdbCache(); // wipes memory + localStorage poster cache
    // After clearing, a fresh fetch is required.
    const again = await fetchPosterUrl(111);
    expect(again).toBe('https://image.tmdb.org/t/p/w342/persist.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
