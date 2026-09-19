/**
 * tmdb.ts
 *
 * Optional, best-effort TMDB poster enrichment for the discovery page.
 *
 * Posters are NOT required: the catalog ships without them and the UI renders
 * a text fallback. We only fetch when an API key is present (user-entered in
 * localStorage, or a build-time VITE_TMDB_API_KEY). Any missing key, missing
 * tmdbId, network error, or non-200 response resolves to `null` — never throws.
 *
 * Proxy routing reuses the project's `USE_LOCAL_PROXY` decision (dev server /
 * preview proxy `/tmdb` → api.themoviedb.org/3); the poster IMAGE itself is a
 * direct <img> src and needs no proxy. Results are cached in memory and in
 * localStorage so repeats never hit the network.
 */
import { USE_LOCAL_PROXY } from './localProxy';

export const TMDB_KEY_STORAGE = 'letv.tmdbApiKey';

/** In-memory cache keyed by tmdbId; value `null` means "known missing". */
const MEM_CACHE = new Map<number, string | null>();

/** localStorage key for a persisted poster URL (or the `__null__` sentinel). */
function posterCacheKey(id: number): string {
  return `letv.tmdb.poster.${id}`;
}

const NULL_SENTINEL = '__null__';

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

/** Persist the API key to localStorage (silent on failure). */
export function setTmdbApiKey(key: string): void {
  try {
    localStorage.setItem(TMDB_KEY_STORAGE, key ?? '');
  } catch {
    // ignore
  }
}

/** True only when a non-empty key is configured. */
export function hasTmdbApiKey(): boolean {
  return getTmdbApiKey().length > 0;
}

const API_BASE = USE_LOCAL_PROXY ? '/tmdb' : 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

/** Load a previously persisted poster URL (memoized into MEM_CACHE). */
function loadPersisted(id: number): string | null | undefined {
  if (MEM_CACHE.has(id)) return MEM_CACHE.get(id) ?? null;
  try {
    const raw = localStorage.getItem(posterCacheKey(id));
    if (raw === null) return undefined;
    const value = raw === NULL_SENTINEL ? null : raw;
    MEM_CACHE.set(id, value);
    return value;
  } catch {
    return undefined;
  }
}

/** Persist a poster URL (or the missing sentinel) alongside the mem cache. */
function persist(id: number, url: string | null): void {
  MEM_CACHE.set(id, url);
  try {
    localStorage.setItem(posterCacheKey(id), url === null ? NULL_SENTINEL : url);
  } catch {
    // ignore
  }
}

/**
 * Fetch the w342 poster URL for a TMDB id. Resolves to `null` on any missing
 * input, missing key, network error, or non-200 response. Cached so repeated
 * calls for the same id hit the network at most once.
 */
export async function fetchPosterUrl(
  tmdbId: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!hasTmdbApiKey()) return null;
  if (typeof tmdbId !== 'number' || !Number.isFinite(tmdbId)) return null;

  const cached = loadPersisted(tmdbId);
  if (cached !== undefined) return cached;

  try {
    const url = `${API_BASE}/movie/${tmdbId}?api_key=${encodeURIComponent(getTmdbApiKey())}`;
    const res = await fetch(url, signal ? { signal } : undefined);
    if (!res.ok) {
      persist(tmdbId, null);
      return null;
    }
    const data = (await res.json()) as { poster_path?: string | null };
    const poster = data.poster_path ? `${IMAGE_BASE}${data.poster_path}` : null;
    persist(tmdbId, poster);
    return poster;
  } catch {
    // Network failure / abort / parse error → graceful null, but don't cache
    // a transient failure so a later retry can succeed.
    return null;
  }
}

/**
 * Clear both the in-memory and the persisted poster caches. Used by tests and
 * (optionally) by the UI when the key changes.
 */
export function clearTmdbCache(): void {
  MEM_CACHE.clear();
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(posterCacheKey(0).slice(0, -1))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
