/**
 * tmdb.ts
 *
 * Optional, best-effort TMDB poster enrichment for the discovery page.
 *
 * Posters are NOT required: the catalog ships without them and the UI renders
 * a text fallback. We only fetch when an API key is present (user-entered in
 * localStorage, or a build-time VITE_TMDB_API_KEY). Any missing key, missing
 * id, network error, or non-200 response resolves to `null` — never throws.
 *
 * Two details that are easy to get wrong and are handled explicitly here:
 *
 *  1. TMDB keeps MOVIES and TV SHOWS in separate namespaces (`/movie/{id}` and
 *     `/tv/{id}`). The same numeric id can exist in both. So every request has
 *     to carry the catalog entry's `mediaType`, and the cache key has to
 *     include it too.
 *  2. Only some catalog entries carry a hard-coded `tmdbId`. When it is absent
 *     (or the id 404s) we fall back to a title SEARCH so the entry still gets a
 *     poster instead of a permanent placeholder.
 *
 * Proxy routing: the browser talks to TMDB DIRECTLY, and the local `/tmdb`
 * proxy is only a fallback. Reason: a "system proxy" VPN (HTTP_PROXY pointed at
 * e.g. 127.0.0.1:2604) is honoured by the browser but NOT by Node — which means
 * the Vite server cannot reach api.themoviedb.org even when the browser can.
 * Routing through the server would therefore break the very setup it was meant
 * to help. TMDB sends `Access-Control-Allow-Origin: *`, so a direct call is
 * allowed. The fallback covers the mirror-image case (a TUN-mode VPN where Node
 * has connectivity). Results are cached in memory and in localStorage so
 * repeats never hit the network.
 */
import type { MovieMediaType } from '../types';
import { USE_LOCAL_PROXY } from './localProxy';

export const TMDB_KEY_STORAGE = 'letv.tmdbApiKey';

/** Everything needed to resolve one poster. */
export interface PosterQuery {
  /** Known TMDB id — tried first, and the most reliable match. */
  tmdbId?: number;
  /** TMDB separates movies from TV shows; this selects the right namespace. */
  mediaType: MovieMediaType;
  /** Original (Latin-script) title — used for the search fallback. */
  title: string;
  /** Release / first-air year, used to disambiguate search hits. */
  year?: number;
}

/** Why the last batch of poster lookups produced no images (for UI hints). */
export type PosterErrorKind = 'none' | 'auth' | 'network';

let lastError: PosterErrorKind = 'none';

/**
 * How the previous poster lookups failed, so the UI can explain a wall of
 * placeholders instead of leaving the user guessing:
 *  - 'auth'    → the API key was rejected (HTTP 401).
 *  - 'network' → the request never completed (offline / blocked / proxy down).
 */
export function getLastPosterError(): PosterErrorKind {
  return lastError;
}

/** In-memory cache; `null` means "known missing" (definitive answer). */
const MEM_CACHE = new Map<string, string | null>();
const NULL_SENTINEL = '__null__';
const CACHE_PREFIX = 'letv.tmdb.poster.';

/** Stable cache identity for a query — media type is part of it on purpose. */
function cacheKey(q: PosterQuery): string {
  if (q.tmdbId != null && Number.isFinite(q.tmdbId)) {
    return `${q.mediaType}.id.${q.tmdbId}`;
  }
  return `${q.mediaType}.q.${q.title.trim().toLowerCase()}.${q.year ?? ''}`;
}

function storageKey(ck: string): string {
  return `${CACHE_PREFIX}${ck}`;
}

/** Read the API key: localStorage wins, else the build-time env var. */
export function getTmdbApiKey(): string {
  try {
    const fromLs = localStorage.getItem(TMDB_KEY_STORAGE);
    if (fromLs && fromLs.trim()) return fromLs.trim();
  } catch {
    // storage unavailable — fall through to env
  }
  const fromEnv = (import.meta.env as Record<string, unknown>).VITE_TMDB_API_KEY;
  return typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : '';
}

/**
 * Persist the API key to localStorage (silent on failure).
 *
 * Also drops the poster cache: a wrong key caches nothing (see `requestJson`),
 * but a *changed* key must not keep serving entries fetched under the old one.
 */
export function setTmdbApiKey(key: string): void {
  try {
    localStorage.setItem(TMDB_KEY_STORAGE, key ?? '');
  } catch {
    // ignore
  }
  clearTmdbCache();
}

/** True only when a non-empty key is configured. */
export function hasTmdbApiKey(): boolean {
  return getTmdbApiKey().length > 0;
}

const DIRECT_BASE = 'https://api.themoviedb.org/3';
const PROXY_BASE = '/tmdb';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

/**
 * Per-attempt timeout. A blocked host otherwise hangs until the OS gives up
 * (~10s), which multiplied by dozens of entries stalls the whole poster pass.
 */
const ATTEMPT_TIMEOUT_MS = 8000;

/** Consecutive all-bases-failed requests before TMDB is skipped entirely. */
const MAX_CONSECUTIVE_FAILURES = 3;

let consecutiveFailures = 0;
/** Set once the server proxy has failed, so it is not retried per entry. */
let proxyFallbackUsable = true;

/** Bases to try, in order. Empty when TMDB should be skipped this session. */
function apiBaseOrder(): string[] {
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return [];
  // Not served from localhost → there is no Vite proxy to fall back to.
  if (!USE_LOCAL_PROXY) return [DIRECT_BASE];
  return proxyFallbackUsable ? [DIRECT_BASE, PROXY_BASE] : [DIRECT_BASE];
}

/** Combine the caller's signal with a timeout, and clean both up afterwards. */
function withTimeout(
  outer: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const forward = (): void => ctrl.abort();
  outer?.addEventListener('abort', forward);
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', forward);
    },
  };
}

/** Load a previously persisted poster URL (memoized into MEM_CACHE). */
function loadPersisted(ck: string): string | null | undefined {
  if (MEM_CACHE.has(ck)) return MEM_CACHE.get(ck) ?? null;
  try {
    const raw = localStorage.getItem(storageKey(ck));
    if (raw === null) return undefined;
    const value = raw === NULL_SENTINEL ? null : raw;
    MEM_CACHE.set(ck, value);
    return value;
  } catch {
    return undefined;
  }
}

/** Persist a poster URL (or the missing sentinel) alongside the mem cache. */
function persist(ck: string, url: string | null): void {
  MEM_CACHE.set(ck, url);
  try {
    localStorage.setItem(storageKey(ck), url === null ? NULL_SENTINEL : url);
  } catch {
    // ignore
  }
}

type ApiResult =
  | { kind: 'ok'; data: unknown }
  | { kind: 'miss' }
  | { kind: 'auth' }
  | { kind: 'error' };

/**
 * TMDB shows TWO credentials side by side on the same settings page, which
 * makes pasting the "wrong" one a very common mistake:
 *
 *   - "API Key (v3 auth)"                → 32 hex chars, sent as `?api_key=`
 *   - "API Read Access Token (v4 auth)"  → a JWT, sent as a Bearer header
 *
 * Both are accepted; the shape of the value tells them apart, so the UI never
 * has to make the user choose. v4 costs one CORS preflight, which TMDB answers
 * with `Access-Control-Allow-Headers: Authorization`.
 */
export function isV4Token(credential: string): boolean {
  const c = credential.trim();
  return c.startsWith('eyJ') && c.split('.').length === 3;
}

/**
 * One authenticated GET against a specific base. Distinguishes a *definitive*
 * answer (200 / 404 / 401, safe to cache or act on) from a *transient* one
 * (network failure / timeout / 5xx — must NOT be cached, or a temporary outage
 * would look permanent).
 */
async function requestOnce(
  base: string,
  path: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ApiResult> {
  const credential = apiKey.trim();
  const v4 = isV4Token(credential);
  const sep = path.includes('?') ? '&' : '?';
  const url = v4
    ? `${base}${path}`
    : `${base}${path}${sep}api_key=${encodeURIComponent(credential)}`;

  const { signal: s, cleanup } = withTimeout(signal, ATTEMPT_TIMEOUT_MS);
  try {
    const init: RequestInit = v4
      ? { signal: s, headers: { Authorization: `Bearer ${credential}` } }
      : { signal: s };
    const res = await fetch(url, init);
    if (res.status === 401) return { kind: 'auth' };
    if (res.status === 404) return { kind: 'miss' };
    if (!res.ok) return { kind: 'error' };
    return { kind: 'ok', data: await res.json() };
  } catch {
    // Network failure / abort / JSON parse error.
    return { kind: 'error' };
  } finally {
    cleanup();
  }
}

/**
 * One authenticated GET, trying each candidate base in turn.
 *
 * Only a network-level failure moves on to the next base: a 401 or 404 is
 * TMDB's real answer and would be identical from the other base too.
 */
async function requestJson(path: string, signal?: AbortSignal): Promise<ApiResult> {
  const apiKey = getTmdbApiKey();
  if (!apiKey) return { kind: 'miss' };

  const bases = apiBaseOrder();
  if (bases.length === 0) return { kind: 'error' };

  for (const base of bases) {
    const r = await requestOnce(base, path, apiKey, signal);
    if (r.kind === 'ok' || r.kind === 'miss' || r.kind === 'auth') {
      if (r.kind === 'auth') lastError = 'auth';
      consecutiveFailures = 0;
      return r;
    }
    if (base === PROXY_BASE) proxyFallbackUsable = false;
  }

  consecutiveFailures += 1;
  if (lastError !== 'auth') lastError = 'network';
  return { kind: 'error' };
}

function posterPathOf(data: unknown): string | null {
  const p = (data as { poster_path?: unknown } | null)?.poster_path;
  return typeof p === 'string' && p ? p : null;
}

const YEAR_FIELD_RE = /^(\d{4})/;

/**
 * Choose a poster from a `/search/{movie,tv}` payload. Prefers a hit whose
 * year is within a year of the catalog entry (remakes and same-name titles are
 * common), otherwise the first hit that actually has artwork.
 */
function pickPosterFromSearch(data: unknown, year?: number): string | null {
  const results = (data as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return null;

  const hits = results.filter((r): r is Record<string, unknown> => {
    return posterPathOf(r) !== null;
  });
  if (hits.length === 0) return null;

  if (year != null) {
    const near = hits.find((r) => {
      const raw = r.release_date ?? r.first_air_date;
      const m = typeof raw === 'string' ? YEAR_FIELD_RE.exec(raw) : null;
      return m ? Math.abs(Number(m[1]) - year) <= 1 : false;
    });
    if (near) return posterPathOf(near);
  }
  return posterPathOf(hits[0]);
}

interface Resolved {
  path: string | null;
  /** True when every attempt got a real answer (so a miss is cacheable). */
  definitive: boolean;
}

/** Try the id lookup, then the title search. */
async function resolvePosterPath(
  q: PosterQuery,
  signal?: AbortSignal,
): Promise<Resolved> {
  const ns = q.mediaType === 'series' ? 'tv' : 'movie';
  let definitive = true;

  if (q.tmdbId != null && Number.isFinite(q.tmdbId)) {
    const r = await requestJson(`/${ns}/${q.tmdbId}`, signal);
    if (r.kind === 'ok') {
      const p = posterPathOf(r.data);
      if (p) return { path: p, definitive };
    } else if (r.kind === 'auth') {
      return { path: null, definitive: false };
    } else if (r.kind === 'error') {
      definitive = false;
    }
  }

  const title = q.title.trim();
  if (title) {
    const yearQ = q.year != null ? `&year=${q.year}` : '';
    const r = await requestJson(
      `/search/${ns}?query=${encodeURIComponent(title)}${yearQ}`,
      signal,
    );
    if (r.kind === 'ok') {
      const p = pickPosterFromSearch(r.data, q.year);
      if (p) return { path: p, definitive };
    } else if (r.kind === 'auth') {
      return { path: null, definitive: false };
    } else if (r.kind === 'error') {
      definitive = false;
    }
  }

  return { path: null, definitive };
}

/**
 * Resolve the w342 poster URL for one catalog entry. Resolves to `null` on any
 * missing input, missing key, network error, or non-200 response. Cached so
 * repeated calls for the same entry hit the network at most once.
 */
export async function fetchPosterUrl(
  query: PosterQuery,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!hasTmdbApiKey()) return null;
  if (!query || (query.tmdbId == null && !query.title?.trim())) return null;

  const ck = cacheKey(query);
  const cached = loadPersisted(ck);
  if (cached !== undefined) return cached;

  const { path, definitive } = await resolvePosterPath(query, signal);
  const url = path ? `${IMAGE_BASE}${path}` : null;

  // Only a definitive answer is worth remembering — a transient failure has to
  // stay retryable, and a rejected key must not poison the cache.
  if (definitive) persist(ck, url);
  return url;
}

/**
 * Drop the in-memory and persisted poster caches, and reset the error and
 * connectivity state. Called by `setTmdbApiKey` (so a corrected key takes
 * effect immediately) and by tests.
 */
export function clearTmdbCache(): void {
  MEM_CACHE.clear();
  lastError = 'none';
  consecutiveFailures = 0;
  proxyFallbackUsable = true;
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
