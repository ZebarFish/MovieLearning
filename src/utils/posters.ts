/**
 * posters.ts
 *
 * Keyless poster resolution for the discovery catalog.
 *
 * Why not just TMDB? Because api.themoviedb.org times out on many CN
 * connections and www.themoviedb.org — where you would register for a key — is
 * blocked outright. Requiring a key there would mean "no posters, ever" for a
 * large share of users. So we resolve through keyless public sources instead,
 * in order of how well they match this catalog:
 *
 *   1. Douban suggest  — matched on the CHINESE title, which is what the
 *                        catalog stores; by far the best hit rate.
 *   2. TVmaze          — series only; effectively 100% for well-known shows.
 *   3. iTunes Search   — Apple's official catalogue, covers both.
 *   4. TMDB            — only when the user has supplied a key (last resort,
 *                        since it usually cannot be reached).
 *
 * Two gotchas this module handles:
 *  - Douban's image CDN rejects hotlinks, so the returned URL is routed through
 *    the local server's `/poster-img` endpoint (see vite.config.ts). Passing a
 *    raw Douban URL to an <img> would 403.
 *  - A provider can answer with a *different* title than we asked for (remakes,
 *    same-name shows). Each provider therefore verifies the name loosely before
 *    accepting a hit — a wrong poster is worse than no poster.
 */
import type { MovieEntry } from '../types';
import { USE_LOCAL_PROXY } from './localProxy';
import { fetchPosterUrl as fetchTmdbPosterUrl, hasTmdbApiKey } from './tmdb';

const DOUBAN_API = USE_LOCAL_PROXY ? '/poster/douban' : 'https://movie.douban.com';
const TVMAZE_API = USE_LOCAL_PROXY ? '/poster/tvmaze' : 'https://api.tvmaze.com';
const ITUNES_API = USE_LOCAL_PROXY ? '/poster/itunes' : 'https://itunes.apple.com';

const CACHE_PREFIX = 'letv.poster.v2.';
const NULL_SENTINEL = '__null__';

/** How long a confirmed "no poster" is remembered before we retry. */
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

/** Session-level memo; `null` means "known missing". */
const MEM = new Map<string, string | null>();

/** Douban's CDN refuses hotlinks, so route remote images through the server. */
export function proxiedImage(url: string): string {
  return USE_LOCAL_PROXY ? `/poster-img?u=${encodeURIComponent(url)}` : url;
}

/** Normalize a title for fuzzy comparison. */
function normTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim();
}

/** True when two titles plausibly refer to the same work. */
function looselyMatches(a: string, b: string): boolean {
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(url, signal ? { signal } : undefined);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --- Providers --------------------------------------------------------------

/** Douban autocomplete, keyed on the Chinese title. Best hit rate here. */
async function doubanPoster(
  entry: MovieEntry,
  signal?: AbortSignal,
): Promise<string | null> {
  const data = await getJson(
    `${DOUBAN_API}/j/subject_suggest?q=${encodeURIComponent(entry.title)}`,
    signal,
  );
  if (!Array.isArray(data)) return null;

  for (const item of data) {
    const row = item as { title?: unknown; img?: unknown } | null;
    if (!row || typeof row.img !== 'string' || !row.img.startsWith('http')) continue;
    // Guard against the suggest endpoint answering with an unrelated work.
    if (typeof row.title !== 'string' || !looselyMatches(row.title, entry.title)) {
      continue;
    }
    return proxiedImage(row.img);
  }
  return null;
}

/** TVmaze — series only. `singlesearch` 404s rather than guessing wildly. */
async function tvmazePoster(
  entry: MovieEntry,
  signal?: AbortSignal,
): Promise<string | null> {
  const data = (await getJson(
    `${TVMAZE_API}/singlesearch/shows?q=${encodeURIComponent(entry.originalTitle)}`,
    signal,
  )) as { name?: unknown; image?: { medium?: unknown; original?: unknown } } | null;
  if (!data) return null;
  if (typeof data.name !== 'string' || !looselyMatches(data.name, entry.originalTitle)) {
    return null;
  }
  const img = data.image;
  const url =
    typeof img?.original === 'string'
      ? img.original
      : typeof img?.medium === 'string'
        ? img.medium
        : null;
  return url ? proxiedImage(url) : null;
}

/** Apple's iTunes Search catalogue — official and free, covers films and TV. */
async function itunesPoster(
  entry: MovieEntry,
  signal?: AbortSignal,
): Promise<string | null> {
  const entity = entry.mediaType === 'series' ? 'tvSeason' : 'movie';
  const data = (await getJson(
    `${ITUNES_API}/search?term=${encodeURIComponent(entry.originalTitle)}` +
      `&entity=${entity}&limit=10&country=US`,
    signal,
  )) as { results?: unknown } | null;

  const results = Array.isArray(data?.results) ? data.results : [];
  for (const item of results) {
    const row = item as
      | { trackName?: unknown; collectionName?: unknown; artworkUrl100?: unknown }
      | null;
    if (!row || typeof row.artworkUrl100 !== 'string') continue;
    const name =
      typeof row.trackName === 'string'
        ? row.trackName
        : typeof row.collectionName === 'string'
          ? row.collectionName
          : '';
    if (!looselyMatches(name, entry.originalTitle)) continue;
    // artworkUrl100 is a 100px thumb; swapping the size token yields a poster.
    const big = row.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.');
    return proxiedImage(big);
  }
  return null;
}

/** TMDB — opt-in only (needs a key and, in practice, network access to it). */
async function tmdbPoster(
  entry: MovieEntry,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!hasTmdbApiKey()) return null;
  return fetchTmdbPosterUrl(
    {
      tmdbId: entry.tmdbId,
      mediaType: entry.mediaType,
      title: entry.originalTitle,
      year: entry.year,
    },
    signal,
  );
}

// --- Cache ------------------------------------------------------------------

function cacheKey(entry: MovieEntry): string {
  return entry.id;
}

function readCache(entry: MovieEntry): string | null | undefined {
  const key = cacheKey(entry);
  if (MEM.has(key)) return MEM.get(key) ?? null;

  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (raw === null) return undefined;

    // A miss is stored as JSON so it can expire: sources go down and come back,
    // and a permanently cached miss is exactly the "why is nothing loading"
    // trap we are trying to avoid.
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw) as { at?: unknown };
      const at = typeof parsed.at === 'number' ? parsed.at : 0;
      if (Date.now() - at > MISS_TTL_MS) return undefined;
      MEM.set(key, null);
      return null;
    }

    MEM.set(key, raw);
    return raw;
  } catch {
    return undefined;
  }
}

function writeCache(entry: MovieEntry, url: string | null): void {
  const key = cacheKey(entry);
  MEM.set(key, url);
  try {
    localStorage.setItem(
      `${CACHE_PREFIX}${key}`,
      url === null ? JSON.stringify({ at: Date.now() }) : url,
    );
  } catch {
    // ignore
  }
}

/** Drop both caches so every poster is looked up again. */
export function clearPosterCache(): void {
  MEM.clear();
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

// --- Public API -------------------------------------------------------------

/**
 * Resolve a poster URL for one catalog entry.
 *
 * Never throws — `null` means "no poster found", and the card renders its
 * placeholder. Results (including misses, for a day) are cached.
 */
export async function fetchPosterUrl(
  entry: MovieEntry,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!entry) return null;

  const cached = readCache(entry);
  if (cached !== undefined) return cached;

  const providers: Array<(e: MovieEntry, s?: AbortSignal) => Promise<string | null>> =
    entry.mediaType === 'series'
      ? [tvmazePoster, doubanPoster, itunesPoster, tmdbPoster]
      : [doubanPoster, itunesPoster, tmdbPoster];

  for (const provider of providers) {
    if (signal?.aborted) return null;
    const url = await provider(entry, signal);
    if (url) {
      writeCache(entry, url);
      return url;
    }
  }

  writeCache(entry, null);
  return null;
}
