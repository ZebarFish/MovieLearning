/**
 * One-click subtitle discovery.
 *
 * Instead of scraping third-party sites (which is both legally and technically
 * fragile), we offer a curated set of deep-links to the most common subtitle
 * search engines, pre-populated with a free-text query. The user finishes the
 * search + download in a new browser tab and then loads the file via the
 * regular VideoSelector file picker.
 */

export interface SubtitleSearchSource {
  /** Display label, e.g. "OpenSubtitles (English)" */
  label: string;
  /** Two-letter short tag for chips. */
  tag: string;
  /** Target language. */
  lang: 'en' | 'zh' | 'both';
  /** URL to open. */
  url: (query: string) => string;
}

export const SUBTITLE_SOURCES: SubtitleSearchSource[] = [
  {
    label: 'OpenSubtitles',
    tag: 'EN',
    lang: 'en',
    url: (q) =>
      `https://www.opensubtitles.org/en/search/sublanguageid-eng/searchonlymovies-on/moviename-${encodeURIComponent(q)}`,
  },
  {
    label: 'SubHD',
    tag: '中',
    lang: 'zh',
    url: (q) =>
      `https://subhd.tv/dsearch/?key=${encodeURIComponent(q)}`,
  },
  {
    label: '字幕库 Zimuku',
    tag: '中',
    lang: 'zh',
    url: (q) =>
      `https://so.zimuku.org/?search=${encodeURIComponent(q)}`,
  },
];

/** Best-guess URL to fetch a subtitle file given a generic .srt URL. */
export async function fetchSubtitleText(url: string): Promise<string> {
  // Single attempt via fetch. Most public subtitle sites do not set CORS
  // headers; failures fall through to the rejected promise so the caller can
  // guide the user to download the file manually.
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  }
  return resp.text();
}
