/**
 * tmdb.test.ts
 *
 * Poster enrichment is optional and must never throw. We verify: no key →
 * hasTmdbApiKey() false and fetchPosterUrl() null; set/get round-trip; the
 * movie-vs-TV namespace split (TMDB keeps them in separate id spaces); the
 * title-search fallback for entries with no hard-coded id; cache behaviour
 * (definitive answers cached, transient failures retryable, rejected keys not
 * poisoning anything); the error flag the UI uses to explain a wall of
 * placeholders; and the transport policy — call TMDB directly from the browser,
 * give up on a blocked host after a few tries, and never hang on one attempt.
 *
 * `fetch` is stubbed per-test; the real network is never touched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TMDB_KEY_STORAGE,
  clearTmdbCache,
  fetchPosterUrl,
  getLastPosterError,
  getTmdbApiKey,
  hasTmdbApiKey,
  isV4Token,
  setTmdbApiKey,
} from './tmdb';
import type { PosterQuery } from './tmdb';

const MOVIE: PosterQuery = {
  tmdbId: 550,
  mediaType: 'movie',
  title: 'Fight Club',
  year: 1999,
};

function jsonResponse(posterPath: string | null, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ poster_path: posterPath }),
  } as unknown as Response;
}

function searchResponse(entries: Array<{ p: string | null; d?: string }>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      results: entries.map((e) => ({
        poster_path: e.p,
        release_date: e.d,
        first_air_date: e.d,
      })),
    }),
  } as unknown as Response;
}

function requestedUrl(call: unknown): string {
  return String(call);
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
    expect(await fetchPosterUrl(MOVIE)).toBeNull();
  });

  it('set/get round-trips through localStorage', () => {
    setTmdbApiKey('abc123');
    expect(getTmdbApiKey()).toBe('abc123');
    expect(hasTmdbApiKey()).toBe(true);
    expect(localStorage.getItem(TMDB_KEY_STORAGE)).toBe('abc123');
  });

  it('drops the poster cache when the key changes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse('/a.jpg'));
    vi.stubGlobal('fetch', fetchMock);

    setTmdbApiKey('first');
    await fetchPosterUrl(MOVIE);
    await fetchPosterUrl(MOVIE); // served from cache
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setTmdbApiKey('second'); // must invalidate
    await fetchPosterUrl(MOVIE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores a query with neither id nor title', async () => {
    setTmdbApiKey('k');
    expect(await fetchPosterUrl({ mediaType: 'movie', title: '   ' })).toBeNull();
  });

  it('ignores a non-finite id when there is no title either', async () => {
    setTmdbApiKey('k');
    expect(
      await fetchPosterUrl({ tmdbId: NaN, mediaType: 'movie', title: '' }),
    ).toBeNull();
  });
});

describe('namespace: movies vs TV', () => {
  it('uses /movie/<id> for films', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () => jsonResponse('/film.jpg'));
    vi.stubGlobal('fetch', fetchMock);

    const url = await fetchPosterUrl(MOVIE);
    expect(url).toBe('https://image.tmdb.org/t/p/w342/film.jpg');
    expect(requestedUrl((fetchMock.mock.calls[0] as unknown[])[0])).toContain(
      '/movie/550',
    );
  });

  it('uses /tv/<id> for series', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () => jsonResponse('/tv.jpg'));
    vi.stubGlobal('fetch', fetchMock);

    // Friends (1668) is a TV show — hitting /movie/1668 would return an
    // unrelated film, which is exactly the bug this test locks down.
    const url = await fetchPosterUrl({
      tmdbId: 1668,
      mediaType: 'series',
      title: 'Friends',
      year: 1994,
    });
    expect(url).toBe('https://image.tmdb.org/t/p/w342/tv.jpg');
    expect(requestedUrl((fetchMock.mock.calls[0] as unknown[])[0])).toContain(
      '/tv/1668',
    );
  });
});

describe('title-search fallback', () => {
  it('searches when the entry has no tmdbId', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () => searchResponse([{ p: '/found.jpg' }]));
    vi.stubGlobal('fetch', fetchMock);

    const url = await fetchPosterUrl({
      mediaType: 'series',
      title: 'Some Show',
      year: 2010,
    });
    expect(url).toBe('https://image.tmdb.org/t/p/w342/found.jpg');

    const called = requestedUrl((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(called).toContain('/search/tv');
    expect(called).toContain('query=Some%20Show');
    expect(called).toContain('year=2010');
  });

  it('falls back to search when the known id 404s', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async (url: unknown) =>
      String(url).includes('/search/')
        ? searchResponse([{ p: '/via-search.jpg' }])
        : jsonResponse(null, 404),
    );
    vi.stubGlobal('fetch', fetchMock);

    const url = await fetchPosterUrl(MOVIE);
    expect(url).toBe('https://image.tmdb.org/t/p/w342/via-search.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prefers a search hit released near the catalog year', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () =>
      searchResponse([
        { p: '/old.jpg', d: '1930-01-01' },
        { p: '/right.jpg', d: '1999-10-15' },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const url = await fetchPosterUrl({
      mediaType: 'movie',
      title: 'Fight Club',
      year: 1999,
    });
    expect(url).toBe('https://image.tmdb.org/t/p/w342/right.jpg');
  });

  it('skips search hits without artwork', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () =>
      searchResponse([{ p: null }, { p: '/second.jpg' }]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const url = await fetchPosterUrl({ mediaType: 'movie', title: 'Whatever' });
    expect(url).toBe('https://image.tmdb.org/t/p/w342/second.jpg');
  });
});

describe('failure handling', () => {
  it('returns null on a server error', async () => {
    setTmdbApiKey('k');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, 500)));
    expect(await fetchPosterUrl(MOVIE)).toBeNull();
  });

  it('returns null when poster_path is missing', async () => {
    setTmdbApiKey('k');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null)));
    expect(await fetchPosterUrl(MOVIE)).toBeNull();
  });

  it('never throws on a network error and reports it', async () => {
    setTmdbApiKey('k');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(fetchPosterUrl(MOVIE)).resolves.toBeNull();
    expect(getLastPosterError()).toBe('network');
  });

  it('flags a rejected key and does not cache the failure', async () => {
    setTmdbApiKey('bad');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, 401)));

    expect(await fetchPosterUrl(MOVIE)).toBeNull();
    expect(getLastPosterError()).toBe('auth');

    // Nothing was cached, so a corrected key still resolves the same entry.
    setTmdbApiKey('good');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('/ok.jpg')));
    expect(await fetchPosterUrl(MOVIE)).toBe(
      'https://image.tmdb.org/t/p/w342/ok.jpg',
    );
  });

  it('does not cache a transient network failure', async () => {
    setTmdbApiKey('k');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await fetchPosterUrl(MOVIE);

    const fetchMock = vi.fn(async () => jsonResponse('/recovered.jpg'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchPosterUrl(MOVIE)).toBe(
      'https://image.tmdb.org/t/p/w342/recovered.jpg',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('transport: browser-direct, with a breaker', () => {
  it('calls the API host directly from the browser, not the local proxy', async () => {
    // A "system proxy" VPN is honoured by the browser but NOT by Node, so the
    // server-side /tmdb proxy cannot reach TMDB even when the browser can.
    // Going direct is what makes a key work in that setup.
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () => jsonResponse('/direct.jpg'));
    vi.stubGlobal('fetch', fetchMock);

    await fetchPosterUrl(MOVIE);
    const url = requestedUrl((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url.startsWith('https://api.themoviedb.org/3/')).toBe(true);
    expect(url).not.toContain('/tmdb/');
  });

  it('stops asking TMDB after repeated failures, so a blocked host is paid for once', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () => jsonResponse(null, 500));
    vi.stubGlobal('fetch', fetchMock);

    // Each entry costs two attempts (id lookup, then title search).
    await fetchPosterUrl({ tmdbId: 1, mediaType: 'movie', title: 'A' });
    await fetchPosterUrl({ tmdbId: 2, mediaType: 'movie', title: 'B' });

    const callsBefore = fetchMock.mock.calls.length;
    await fetchPosterUrl({ tmdbId: 3, mediaType: 'movie', title: 'C' });
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('gives TMDB another chance after clearTmdbCache', async () => {
    setTmdbApiKey('k');
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, 500)));
    await fetchPosterUrl({ tmdbId: 1, mediaType: 'movie', title: 'A' });
    await fetchPosterUrl({ tmdbId: 2, mediaType: 'movie', title: 'B' });

    clearTmdbCache();
    const fetchMock = vi.fn(async () => jsonResponse('/back.jpg'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchPosterUrl({ tmdbId: 3, mediaType: 'movie', title: 'C' })).toBe(
      'https://image.tmdb.org/t/p/w342/back.jpg',
    );
    expect(fetchMock).toHaveBeenCalled();
  });

  it('aborts a hanging attempt instead of stalling the whole pass', async () => {
    vi.useFakeTimers();
    try {
      setTmdbApiKey('k');
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: unknown, init?: { signal?: AbortSignal }) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new Error('aborted')),
              );
            }),
        ),
      );

      const pending = fetchPosterUrl(MOVIE);
      // Two attempts (id + search), each capped by ATTEMPT_TIMEOUT_MS (8000).
      await vi.advanceTimersByTimeAsync(8100);
      await vi.advanceTimersByTimeAsync(8100);

      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('credential handling: v3 key and v4 token both work', () => {
  /** A realistic v4 Read Access Token: a JWT with three segments. */
  const V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJhYmMifQ.signature';

  it('classifies the two credential shapes', () => {
    expect(isV4Token(V4)).toBe(true);
    expect(isV4Token('  ' + V4 + '  ')).toBe(true);
    // A v3 key is 32 hex characters, not a JWT.
    expect(isV4Token('0123456789abcdef0123456789abcdef')).toBe(false);
    expect(isV4Token('')).toBe(false);
    expect(isV4Token('eyJnotajwt')).toBe(false);
  });

  it('sends a v3 key as ?api_key= with no Authorization header', async () => {
    const key = '0123456789abcdef0123456789abcdef';
    setTmdbApiKey(key);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse('/v3.jpg'),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchPosterUrl(MOVIE);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain(`api_key=${key}`);
    expect(init?.headers).toBeUndefined();
  });

  it('sends a v4 token as a Bearer header with no api_key param', async () => {
    // Pasting the wrong one of the two is the common mistake, so both are
    // accepted — this is what removes the footgun.
    setTmdbApiKey(V4);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse('/v4.jpg'),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchPosterUrl(MOVIE)).toBe(
      'https://image.tmdb.org/t/p/w342/v4.jpg',
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).not.toContain('api_key=');
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      `Bearer ${V4}`,
    );
  });

  it('flags a rejected v4 token as an auth error too', async () => {
    setTmdbApiKey(V4);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, 401)));
    expect(await fetchPosterUrl(MOVIE)).toBeNull();
    expect(getLastPosterError()).toBe('auth');
  });
});

describe('caching', () => {
  it('hits the network only once per entry', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () => jsonResponse('/cached.jpg'));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchPosterUrl(MOVIE);
    const second = await fetchPosterUrl(MOVIE);
    expect(first).toBe('https://image.tmdb.org/t/p/w342/cached.jpg');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a movie and a series sharing the same numeric id apart', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async (url: unknown) =>
      jsonResponse(String(url).includes('/tv/') ? '/tv.jpg' : '/movie.jpg'),
    );
    vi.stubGlobal('fetch', fetchMock);

    const asMovie = await fetchPosterUrl({ tmdbId: 42, mediaType: 'movie', title: 'X' });
    const asSeries = await fetchPosterUrl({ tmdbId: 42, mediaType: 'series', title: 'X' });

    expect(asMovie).toBe('https://image.tmdb.org/t/p/w342/movie.jpg');
    expect(asSeries).toBe('https://image.tmdb.org/t/p/w342/tv.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-fetches after clearTmdbCache', async () => {
    setTmdbApiKey('k');
    const fetchMock = vi.fn(async () => jsonResponse('/persist.jpg'));
    vi.stubGlobal('fetch', fetchMock);

    await fetchPosterUrl(MOVIE);
    clearTmdbCache();
    const again = await fetchPosterUrl(MOVIE);
    expect(again).toBe('https://image.tmdb.org/t/p/w342/persist.jpg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
