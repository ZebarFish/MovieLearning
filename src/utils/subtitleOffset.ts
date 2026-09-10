/**
 * Subtitle timeline offset utilities.
 *
 * Shift every cue of the loaded tracks by a constant offset (in seconds,
 * may be negative) so the subtitles stay in sync with the video/audio.
 * Shifting is applied as a derived value in App (never mutating the
 * originally parsed cues), so repeated adjustments never accumulate error.
 */
import type { SubtitleCue, SubtitleTrack } from '../types';

/** Round to millisecond precision to avoid float drift. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Return new cues shifted by `offset` seconds (originals untouched). */
export function shiftCues(cues: SubtitleCue[], offset: number): SubtitleCue[] {
  if (offset === 0) return cues;
  return cues.map((c) => ({
    ...c,
    start: round3(c.start + offset),
    end: round3(c.end + offset),
  }));
}

/** Shift every track's cues; identity when offset is 0. */
export function shiftTracks(
  tracks: SubtitleTrack[],
  offset: number,
): SubtitleTrack[] {
  if (offset === 0) return tracks;
  return tracks.map((t) => ({ ...t, cues: shiftCues(t.cues, offset) }));
}

/** Format an offset for display: 0 → "0s", 0.5 → "+0.5s", -1 → "-1s". */
export function formatOffset(offset: number): string {
  if (offset === 0) return '0s';
  return `${offset > 0 ? '+' : ''}${round3(offset)}s`;
}
