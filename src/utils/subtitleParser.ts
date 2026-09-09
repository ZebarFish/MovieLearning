/**
 * Subtitle parser for SRT and VTT formats.
 *
 * Both formats are very similar:
 *   - SRT uses `,` as the millisecond separator: `HH:MM:SS,mmm --> HH:MM:SS,mmm`
 *   - VTT uses `.` as the millisecond separator: `HH:MM:SS.mmm --> HH:MM:SS.mmm`
 *   - SRT cues start with a numeric index
 *   - VTT files start with `WEBVTT` and may include cue identifiers / cue settings
 *
 * Output: an array of cues with shape `{index, start, end, text}` where
 * `start`/`end` are numbers in seconds (float).
 */
import type { SubtitleCue } from '../types';

/** Parse a `HH:MM:SS,mmm` or `HH:MM:SS.mmm` style timestamp into seconds. */
function parseTimestamp(raw: string): number {
  // Trim and normalize. Accept both `,` and `.` as the ms separator.
  const cleaned = raw.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length !== 3) {
    return 0;
  }
  const [hStr, mStr, sStr] = parts;
  const hours = Number.parseInt(hStr, 10) || 0;
  const minutes = Number.parseInt(mStr, 10) || 0;
  const seconds = Number.parseFloat(sStr) || 0;
  return hours * 3600 + minutes * 60 + seconds;
}

/** Detect whether content looks like WebVTT (vs SRT). */
export function detectFormat(content: string): 'srt' | 'vtt' | 'unknown' {
  const firstLine = content.trimStart().split(/\r?\n/, 1)[0] ?? '';
  if (/^WEBVTT/i.test(firstLine)) {
    return 'vtt';
  }
  // SRT cues begin with a numeric index on a line by itself.
  if (/^\d+\s*$/.test(firstLine)) {
    return 'srt';
  }
  return 'unknown';
}

/**
 * Parse the given subtitle content into a list of cues. Auto-detects format.
 * If format detection fails, falls back to SRT-like parsing because SRT and
 * VTT share enough structure for the basic parser to recover gracefully.
 */
export function parseSubtitles(content: string): SubtitleCue[] {
  const trimmed = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const format = detectFormat(trimmed);
  const isVtt = format === 'vtt';

  // Strip the WEBVTT header line(s). Anything up to the first blank line.
  let body = trimmed;
  if (isVtt) {
    const headerEnd = body.indexOf('\n\n');
    body = headerEnd >= 0 ? body.slice(headerEnd + 2) : '';
  }

  const blocks = body
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const cues: SubtitleCue[] = [];
  let autoIndex = 0;

  for (const block of blocks) {
    const lines = block.split('\n');
    // Find the timestamp line. It contains `-->`. Lines before it may be the
    // SRT numeric index or a VTT cue identifier.
    let timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) {
      continue;
    }
    const timeLine = lines[timeLineIdx];
    const match = timeLine.match(
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/,
    );
    if (!match) {
      continue;
    }
    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);

    const textLines = lines.slice(timeLineIdx + 1);
    const text = textLines.join('\n').trim();
    if (!text) {
      continue;
    }

    autoIndex += 1;
    cues.push({
      index: autoIndex,
      start,
      end,
      text,
    });
  }

  return cues;
}

/** Convenience: read a File (from <input type="file">) and parse it. */
export async function parseSubtitleFile(file: File): Promise<SubtitleCue[]> {
  const text = await file.text();
  return parseSubtitles(text);
}

/**
 * Format seconds as `HH:MM:SS` for display.
 * Useful when showing A/B loop markers and timestamps.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00:00';
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Find the cue whose [start, end] contains the given playback time. */
export function findCueAtTime(
  cues: SubtitleCue[],
  time: number,
): SubtitleCue | null {
  for (const cue of cues) {
    if (time >= cue.start && time < cue.end) {
      return cue;
    }
  }
  return null;
}