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
 * Proxy routing reuses the project's `USE_LOCAL_PROXY` decision (dev server /
 * preview proxy `/tmdb` → api.themoviedb.org/3); the poster IMAGE itself is a
 * direct <img> src and needs no proxy. Results are cached in memory and in
 * localStorage so repeats never hit the network.
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

const API_BASE = USE_LOCAL_PROXY ? '/tmdb' : 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

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
 * One authenticated GET. Distinguishes a *definitive* answer (200 / 404, safe
 * to cache) from a *transient* one (network failure / abort / 5xx — must NOT be
 * cached, or a temporary outage would look permanent).
 */
async function requestJson(path: string, signal?: AbortSignal): Promise<ApiResult> {
  const apiKey = getTmdbApiKey();
  if (!apiKey) return { kind: 'miss' };

  const sep = path.includes('?') ? '&' : '?';
  const url = `${API_BASE}${path}${sep}api_key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, signal ? { signal } : undefined);
    if (res.status === 401) {
      lastError = 'auth';
      return { kind: 'auth' };
    }
    if (res.status === 404) return { kind: 'miss' };
    if (!res.ok) {
      if (lastError !== 'auth') lastError = 'network';
      return { kind: 'error' };
    }
    return { kind: 'ok', data: await res.json() };
  } catch {
    // Network failure / abort / JSON parse error.
    if (lastError !== 'auth') lastError = 'network';
    return { kind: 'error' };
  }
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
 * Drop the in-memory and persisted poster caches, and reset the error flag.
 * Called by `setTmdbApiKey` (so a corrected key takes effect immediately) and
 * by tests.
 */
export function clearTmdbCache(): void {
  MEM_CACHE.clear();
  lastError = 'none';
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
