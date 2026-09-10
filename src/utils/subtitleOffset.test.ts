/**
 * Tests for subtitle timeline offset utilities.
 */
import { describe, expect, it } from 'vitest';
import { formatOffset, shiftCues, shiftTracks } from './subtitleOffset';
import type { SubtitleCue, SubtitleTrack } from '../types';

const CUES: SubtitleCue[] = [
  { index: 1, start: 1.5, end: 2.75, text: 'Hello' },
  { index: 2, start: 3.001, end: 4.499, text: 'World' },
];

const TRACK: SubtitleTrack = {
  id: 't1',
  label: 'English',
  filename: 'a.srt',
  lang: 'en',
  cues: CUES,
};

describe('shiftCues', () => {
  it('returns the same array for offset 0 (no drift on repeated calls)', () => {
    expect(shiftCues(CUES, 0)).toBe(CUES);
  });

  it('delays cues for a positive offset', () => {
    const out = shiftCues(CUES, 1);
    expect(out[0]!.start).toBe(2.5);
    expect(out[0]!.end).toBe(3.75);
    expect(out[1]!.start).toBeCloseTo(4.001, 6);
    // Originals untouched.
    expect(CUES[0]!.start).toBe(1.5);
  });

  it('advances cues for a negative offset', () => {
    const out = shiftCues(CUES, -0.5);
    expect(out[0]!.start).toBe(1);
    expect(out[1]!.start).toBeCloseTo(2.501, 6);
  });

  it('keeps text and index', () => {
    const out = shiftCues(CUES, 2);
    expect(out[0]!.text).toBe('Hello');
    expect(out[1]!.index).toBe(2);
  });
});

describe('shiftTracks', () => {
  it('is identity at offset 0', () => {
    expect(shiftTracks([TRACK], 0)).toEqual([TRACK]);
  });

  it('shifts cues inside each track but preserves track metadata', () => {
    const [t] = shiftTracks([TRACK], 1);
    expect(t!.id).toBe('t1');
    expect(t!.label).toBe('English');
    expect(t!.cues[0]!.start).toBe(2.5);
  });
});

describe('formatOffset', () => {
  it('formats zero, positive and negative offsets', () => {
    expect(formatOffset(0)).toBe('0s');
    expect(formatOffset(0.5)).toBe('+0.5s');
    expect(formatOffset(-1)).toBe('-1s');
    expect(formatOffset(1.5)).toBe('+1.5s');
  });
});
