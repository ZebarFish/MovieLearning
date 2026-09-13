/**
 * translate.ts
 *
 * Machine translation for subtitle sentences (EN → zh-CN), used to fill the
 * Anki card's 例句释义 field when no Chinese subtitle track is loaded.
 *
 * Backed by the free MyMemory API (no key, ~500 chars/request). Bogus
 * responses — quota warnings, HTML escapes, empty strings — are normalised
 * away and surface as `null` so callers can just leave the field empty.
 */
import { USE_LOCAL_PROXY } from './localProxy';

const MYMEMORY = USE_LOCAL_PROXY
  ? '/dict/mymemory/get'
  : 'https://api.mymemory.translated.net/get';

const CACHE = new Map<string, string | null>();

/** Reset the in-memory translation cache (used by tests). */
export function clearTranslationCache(): void {
  CACHE.clear();
}

/** Decode the handful of HTML entities MyMemory puts in its output. */
function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** True when the text already contains CJK characters. */
export function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/**
 * Translate an English sentence into Simplified Chinese.
 * Resolves to `null` when the text is empty, already Chinese, or the service
 * is unavailable / out of quota — never throws.
 */
export async function translateToChinese(text: string): Promise<string | null> {
  const source = text.trim();
  if (!source) return null;
  if (hasChinese(source)) return source;

  const cached = CACHE.get(source);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(
      `${MYMEMORY}?q=${encodeURIComponent(source)}&langpair=${encodeURIComponent('en|zh-CN')}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      CACHE.set(source, null);
      return null;
    }
    const data = (await res.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number | string;
    };
    const raw = data.responseData?.translatedText;
    if (typeof raw !== 'string' || !raw.trim()) {
      CACHE.set(source, null);
      return null;
    }
    // Quota / error notices come back as the "translation" itself.
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(raw)) {
      CACHE.set(source, null);
      return null;
    }
    const translated = decodeEntities(raw).trim();
    CACHE.set(source, translated);
    return translated;
  } catch {
    CACHE.set(source, null);
    return null;
  }
}
