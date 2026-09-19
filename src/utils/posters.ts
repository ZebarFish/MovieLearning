/**
 * posters.ts
 *
 * Keyless poster resolution for the discovery catalog, with TMDB as an
 * optional first-class upgrade when the user supplies an API key.
 *
 * Source order
 * ------------
 *   key present : TMDB → (TVmaze | Douban)
 *   no key      : TVmaze (series) | Douban (films)
 *
 * Why this shape — all of it measured on a real, partly-blocked network:
 *
 *  - TMDB is authoritative (exact ids, no fuzzy matching) but needs a key, and
 *    `api.themoviedb.org` is unreachable on many CN connections. So it leads
 *    when a key is configured and is skipped entirely otherwise.
 *  - TVmaze covers series essentially 100% here, keylessly. It is series-only.
 *  - Douban's autocomplete matches our Chinese titles best, but it rate-limits
 *    aggressive clients — a burst of parallel requests gets the whole session
 *    answered with empty arrays. It is therefore SERIALIZED with a minimum gap
 *    and trips a circuit breaker on hard failures. See `doubanGate`.
 *  - iTunes Search was REMOVED. `entity=movie` returned zero results in every
 *    region tried (US/GB/CN) while `entity=tvSeason` worked — Apple simply does
 *    not serve its movie catalogue to this client. TVmaze already covers every
 *    series iTunes found, so the provider only cost requests and latency.
 *  - Wikipedia was evaluated and rejected: en.wikipedia.org is unreachable from
 *    this network (~10s timeout, every attempt), so it would be dead weight.
 *
 * Two further gotchas handled here:
 *  - Douban's image CDN rejects hotlinks (418 without a Referer, 403 with a
 *    localhost one), so returned URLs are routed through the local server's
 *    `/poster-img` endpoint (see vite.config.ts).
 *  - A provider can answer with a *different* title than we asked for (remakes,
 *    same-name shows), so each provider verifies the name loosely — a wrong
 *    poster is worse than no poster.
 */
import type { MovieEntry } from '../types';
import { USE_LOCAL_PROXY } from './localProxy';
import { fetchPosterUrl as fetchTmdbPosterUrl, hasTmdbApiKey } from './tmdb';

const DOUBAN_API = USE_LOCAL_PROXY ? '/poster/douban' : 'https://movie.douban.com';
const TVMAZE_API = USE_LOCAL_PROXY ? '/poster/tvmaze' : 'https://api.tvmaze.com';

/**
 * v3: the iTunes provider was dropped, so any cached mzstatic URLs from v2 are
 * stale (and no longer allowed through the image proxy). Bumping the prefix
 * retires them in one step.
 */
const CACHE_PREFIX = 'letv.poster.v3.';

/** How long a confirmed "no poster" is remembered before we retry. */
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Douban pacing. It answers bursts of parallel requests with empty arrays for
 * the rest of the session, so requests are serialized with a minimum gap.
 * ~350ms keeps a 27-film pass under ~10s while staying well inside the limit.
 */
const DOUBAN_MIN_GAP_MS = 350;

/** Consecutive hard failures (non-200 / network) before we stop asking. */
const DOUBAN_MAX_FAILURES = 3;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Douban gate ------------------------------------------------------------

let doubanChain: Promise<unknown> = Promise.resolve();
let doubanLastAt = 0;
let doubanFailures = 0;

/**
 * True once Douban has failed hard enough times that continuing would only
 * make things worse. Consulted by `doubanPoster` so a blocked source costs one
 * check per entry instead of one request per entry.
 */
let doubanBlocked = false;

/** Whether the keyless film source gave up for this session (for UI hints). */
export function isDoubanBlocked(): boolean {
  return doubanBlocked;
}

/** Reset the gate + breaker. Used by 「重新拉取海报」 and by tests. */
export function resetPosterSources(): void {
  doubanChain = Promise.resolve();
  doubanLastAt = 0;
  doubanFailures = 0;
  doubanBlocked = false;
}

/** Serialize Douban access and enforce the minimum gap between requests. */
async function doubanGate(): Promise<void> {
  const run = doubanChain.then(async () => {
    const wait = DOUBAN_MIN_GAP_MS - (Date.now() - doubanLastAt);
    if (wait > 0) await sleep(wait);
    doubanLastAt = Date.now();
  });
  // Keep the chain alive even if a link rejects, so one failure cannot wedge
  // every later request.
  doubanChain = run.catch(() => undefined);
  await run;
}

// --- Providers --------------------------------------------------------------

/**
 * Douban autocomplete, keyed on the Chinese title. Best hit rate for films.
 *
 * Returns `null` for a genuine "no match" AND for "blocked" — the caller only
 * cares that no poster was found. Block detection lives in `noteDoubanOutcome`.
 */
async function doubanPoster(
  entry: MovieEntry,
  signal?: AbortSignal,
): Promise<string | null> {
  if (doubanBlocked) return null;

  await doubanGate();
  if (signal?.aborted || doubanBlocked) return null;

  let data: unknown = null;
  try {
    const res = await fetch(
      `${DOUBAN_API}/j/subject_suggest?q=${encodeURIComponent(entry.title)}`,
      signal ? { signal } : undefined,
    );
    if (!res.ok) {
      noteDoubanOutcome(false);
      return null;
    }
    data = await res.json();
    noteDoubanOutcome(true);
  } catch {
    noteDoubanOutcome(false);
    return null;
  }

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

/**
 * Track Douban health. Only *hard* failures count: an empty result set is a
 * legitimate "this title is not in the index" and must not trip the breaker,
 * or a handful of obscure entries would disable the source for everyone.
 */
function noteDoubanOutcome(ok: boolean): void {
  if (ok) {
    doubanFailures = 0;
    return;
  }
  doubanFailures += 1;
  if (doubanFailures >= DOUBAN_MAX_FAILURES) doubanBlocked = true;
}

/** Shape of the bits of a TVmaze `singlesearch` payload we actually read. */
interface TvmazeShow {
  name?: unknown;
  image?: { medium?: unknown; original?: unknown };
}

/** TVmaze — series only. `singlesearch` 404s rather than guessing wildly. */
async function tvmazePoster(
  entry: MovieEntry,
  signal?: AbortSignal,
): Promise<string | null> {
  let data: TvmazeShow | null = null;
  try {
    const res = await fetch(
      `${TVMAZE_API}/singlesearch/shows?q=${encodeURIComponent(entry.originalTitle)}`,
      signal ? { signal } : undefined,
    );
    if (!res.ok) return null;
    data = (await res.json()) as TvmazeShow;
  } catch {
    return null;
  }
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

/** TMDB — authoritative, but opt-in (needs a key, and a reachable network). */
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

function readCache(entry: MovieEntry): string | null | undefined {
  const key = entry.id;
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
  const key = entry.id;
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

  const keyless: Array<(e: MovieEntry, s?: AbortSignal) => Promise<string | null>> =
    entry.mediaType === 'series' ? [tvmazePoster, doubanPoster] : [doubanPoster];

  // A configured key makes TMDB the best answer available; keep the keyless
  // sources behind it so a bad/expired key still degrades gracefully.
  const providers = hasTmdbApiKey() ? [tmdbPoster, ...keyless] : keyless;

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
