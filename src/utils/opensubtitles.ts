/**
 * OpenSubtitles.com API integration — accurate subtitle lookup by video hash.
 *
 * The OpenSubtitles hash covers file size + first/last 64 KiB, so a match is
 * essentially guaranteed to be the exact same video rip (accuracy >> filename
 * search). Requires a free API key from https://www.opensubtitles.com
 * (Account settings → API keys).
 */
import type { SubtitleCue } from '../types';
import { parseSubtitles } from './subtitleParser';

const API_BASE = 'https://api.opensubtitles.com/api/v1';
const CHUNK_SIZE = 65536; // 64 KiB

const KEY_STORAGE = 'opensubtitles-api-key';

export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function storeApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // storage unavailable — ignore
  }
}

/**
 * OpenSubtitles moviehash: sum of file size (u64) + all u64 LE words from the
 * first and last 64 KiB, with u64 wraparound. Returned as decimal string.
 */
export async function computeOpenSubtitlesHash(file: File): Promise<string> {
  let sum = BigInt(file.size);
  const readChunk = async (start: number, end: number): Promise<void> => {
    const buf = await file.slice(start, end).arrayBuffer();
    const view = new DataView(buf);
    for (let off = 0; off + 8 <= view.byteLength; off += 8) {
      sum += view.getBigUint64(off, true);
      sum &= 0xffffffffffffffffn;
    }
  };
  await readChunk(0, CHUNK_SIZE);
  if (file.size > CHUNK_SIZE) {
    // Tail chunk is the *last* 64 KiB: start exactly at size - 64 KiB so it
    // never overlaps the head chunk (matches the official OS hash spec).
    await readChunk(file.size - CHUNK_SIZE, file.size);
  }
  return sum.toString();
}

/** One search result row we surface in the UI. */
export interface SubtitleCandidate {
  id: string;
  language: string;
  release: string;
  downloads: number;
  rating: number;
  hearingImpaired: boolean;
  fileId: number | null;
  /** Human-facing page on opensubtitles.com (fallback if download fails). */
  pageUrl: string;
  extension: string;
  /** How this candidate was found — exact hash or filename search. */
  source: 'hash' | 'filename';
}

interface OsSubtitleAttr {
  language?: string;
  release?: string | null;
  downloadsCount?: number;
  ratings?: number;
  hearing_impaired?: boolean;
  url?: string;
  subtitle_id?: string;
  files?: { file_id?: number; hd?: boolean }[];
}

/** Human-readable meaning for common OpenSubtitles HTTP status codes. */
export function httpHint(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return 'API Key 无效或未授权,请检查 Key 是否正确。';
    case 404:
      return '接口或资源不存在,可能是字幕已被移除。';
    case 406:
      return '今日/本月下载额度已用完(免费账户有限额),明天再试或升级账户。';
    case 429:
      return '请求过于频繁(免费额度限制),请稍等再试。';
    case 500:
    case 502:
    case 503:
      return 'OpenSubtitles 服务器暂时不可用,请稍后再试。';
    default:
      return '';
  }
}

export async function searchSubtitles(
  apiKey: string,
  moviehash: string,
  languages: string = 'en,zh-cn,zh',
  fileSize?: number,
): Promise<SubtitleCandidate[]> {
  // Official search endpoint is GET /subtitles (NOT /subtitles/search).
  // Sending moviebytesize alongside moviehash sharpens the exact match.
  let url =
    `${API_BASE}/subtitles?moviehash=${encodeURIComponent(moviehash)}` +
    `&languages=${encodeURIComponent(languages)}`;
  if (typeof fileSize === 'number' && Number.isFinite(fileSize)) {
    url += `&moviebytesize=${fileSize}`;
  }
  const res = await fetch(url, {
    headers: { 'Api-Key': apiKey, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`搜索失败(HTTP ${res.status}):${httpHint(res.status)}`);
  }
  if (res.status === 429) {
    throw new Error(`搜索失败(429):${httpHint(429)}`);
  }
  if (!res.ok) {
    throw new Error(`搜索失败(HTTP ${res.status}):${httpHint(res.status)}`);
  }
  const json = (await res.json()) as { data?: { id?: string; attributes?: OsSubtitleAttr }[] };
  const rows = json.data ?? [];
  return rows.map((row, i) => {
    const a = row.attributes ?? {};
    return {
      id: row.id ?? String(i),
      language: a.language ?? '?',
      release: a.release ?? a.subtitle_id ?? '',
      downloads: a.downloadsCount ?? 0,
      rating: a.ratings ?? 0,
      hearingImpaired: Boolean(a.hearing_impaired),
      fileId: a.files?.[0]?.file_id ?? null,
      pageUrl: a.url ?? 'https://www.opensubtitles.com',
      extension: '',
      source: 'hash',
    };
  });
}

/** What could be guessed from a video filename for query-based search. */
export interface FilenameGuess {
  /** Cleaned show/movie title (release tags stripped). */
  query: string;
  season: number | null;
  episode: number | null;
}

/**
 * Guess a searchable title (and season/episode) from a video filename.
 * Strips the extension, S01E02 markers (kept as structured data) and
 * common release tags like 1080p / WEB-DL / x264 / BluRay.
 */
export function guessQueryFromFilename(name: string): FilenameGuess {
  let s = name.replace(/\.[a-z0-9]{1,5}$/i, '');
  let season: number | null = null;
  let episode: number | null = null;
  const se = s.match(/\bs(\d{1,2})\s*e(\d{1,3})\b/i);
  if (se) {
    season = Number(se[1]);
    episode = Number(se[2]);
    s = s.slice(0, se.index) + ' ' + s.slice((se.index ?? 0) + se[0].length);
  }
  s = s.replace(
    /\b(2160p|1080p|1080i|720p|480p|4k|uhd|web[\s.-]*dl|web[\s.-]*rip|web|nf|amzn|dsnp|bluray|blu[\s.-]*ray|bdrip|brrip|dvdrip|dvdscr|hdtv|pdtv|x264|x265|h[\s.]?264|h[\s.]?265|hevc|avc|aac|ac3|eac3|dd[\s.]?5[\s.]?1|ddp|dts|truehd|atmos|10bit|8bit|hdr10?|\+?hdr|dv|remux|proper|repack|extended|unrated|remastered|internal|dual[\s.-]*audio)\b/gi,
    ' ',
  );
  s = s
    .replace(/[._]+/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { query: s, season, episode };
}

/**
 * Query-based fallback search (used when the hash finds nothing — e.g.
 * transcoded videos). Sharpens TV lookups with season/episode when known.
 */
export async function searchSubtitlesByQuery(
  apiKey: string,
  guess: FilenameGuess,
  languages: string = 'en,zh-cn,zh',
): Promise<SubtitleCandidate[]> {
  const params = new URLSearchParams({ query: guess.query, languages });
  if (guess.season !== null) params.set('season_number', String(guess.season));
  if (guess.episode !== null) {
    params.set('episode_number', String(guess.episode));
  }
  const url = `${API_BASE}/subtitles?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'Api-Key': apiKey, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`搜索失败(HTTP ${res.status}):${httpHint(res.status)}`);
  }
  if (res.status === 429) {
    throw new Error(`搜索失败(429):${httpHint(429)}`);
  }
  if (!res.ok) {
    throw new Error(`搜索失败(HTTP ${res.status}):${httpHint(res.status)}`);
  }
  const json = (await res.json()) as { data?: { id?: string; attributes?: OsSubtitleAttr }[] };
  const rows = json.data ?? [];
  return rows.map((row, i) => {
    const a = row.attributes ?? {};
    return {
      id: row.id ?? String(i),
      language: a.language ?? '?',
      release: a.release ?? a.subtitle_id ?? '',
      downloads: a.downloadsCount ?? 0,
      rating: a.ratings ?? 0,
      hearingImpaired: Boolean(a.hearing_impaired),
      fileId: a.files?.[0]?.file_id ?? null,
      pageUrl: a.url ?? 'https://www.opensubtitles.com',
      extension: '',
      source: 'filename' as const,
    };
  });
}

export interface DownloadResult {
  /** Direct subtitle file URL (usually a CDN .srt/.vtt). */
  link: string;
  remaining: number | null;
}

export async function downloadSubtitle(
  apiKey: string,
  fileId: number,
): Promise<DownloadResult> {
  const res = await fetch(`${API_BASE}/download`, {
    method: 'POST',
    headers: {
      'Api-Key': apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (res.status === 406) {
    throw new Error(`下载失败(406):${httpHint(406)}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`下载失败(HTTP ${res.status}):${httpHint(res.status)}`);
  }
  if (!res.ok) {
    throw new Error(`下载请求失败(HTTP ${res.status}):${httpHint(res.status)}`);
  }
  const json = (await res.json()) as { link?: string; remaining?: number };
  if (!json.link) {
    throw new Error('响应中没有下载链接。');
  }
  return { link: json.link, remaining: json.remaining ?? null };
}

/** Map an OpenSubtitles language code onto our SubtitleLang. */
export function osLangToLang(lang: string): 'en' | 'zh' | 'other' {
  const l = lang.toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('en')) return 'en';
  return 'other';
}

/** Fetch + parse the downloaded subtitle into cues. */
export async function fetchSubtitleCues(link: string): Promise<SubtitleCue[]> {
  const res = await fetch(link);
  if (!res.ok) {
    throw new Error(`字幕文件下载失败(HTTP ${res.status}):${httpHint(res.status)}`);
  }
  const text = await res.text();
  return parseSubtitles(text);
}
