import { describe, expect, it } from 'vitest';
import {
  cleanCueText,
  detectFormat,
  findCueAtTime,
  formatTime,
  parseSubtitles,
} from './subtitleParser';

describe('cleanCueText', () => {
  it('strips inline HTML tags', () => {
    expect(cleanCueText('<i>Hello world.</i>')).toBe('Hello world.');
    expect(cleanCueText('<b>Hi</b> <font color="#fff">there</font>')).toBe(
      'Hi there',
    );
  });

  it('strips VTT voice tags and ASS overrides', () => {
    expect(cleanCueText('<v Tom>Hi there.')).toBe('Hi there.');
    expect(cleanCueText('{\\an8}Bottom line.')).toBe('Bottom line.');
  });

  it('keeps plain text untouched', () => {
    expect(cleanCueText('Just plain text.')).toBe('Just plain text.');
  });
});

describe('detectFormat', () => {
  it('detects VTT when first line starts with WEBVTT', () => {
    expect(detectFormat('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHi')).toBe('vtt');
  });

  it('detects VTT case-insensitively', () => {
    expect(detectFormat('webvtt\n\n1\n00:00:01.000 --> 00:00:02.000\nHi')).toBe('vtt');
  });

  it('detects SRT when first line is a number', () => {
    expect(detectFormat('1\n00:00:01,000 --> 00:00:02,000\nHi')).toBe('srt');
  });

  it('returns unknown for unrecognized content', () => {
    expect(detectFormat('hello world')).toBe('unknown');
  });

  it('handles BOM at start', () => {
    // BOM should not block detection — but here leading char is not WEBVTT nor numeric
    // We just verify it doesn't throw.
    expect(() => detectFormat('\uFEFFhello')).not.toThrow();
  });
});

describe('parseSubtitles - SRT', () => {
  const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:04,000 --> 00:00:06,000
How are you?
I'm fine.

3
00:00:07,250 --> 00:00:09,000
Goodbye!`;

  it('parses single-line cues', () => {
    const cues = parseSubtitles(SAMPLE_SRT);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toMatchObject({
      index: 1,
      start: 1,
      end: 3.5,
      text: 'Hello world',
    });
  });

  it('parses multi-line cues by joining with newlines', () => {
    const cues = parseSubtitles(SAMPLE_SRT);
    expect(cues[1].text).toBe("How are you?\nI'm fine.");
  });

  it('handles SRT timestamps with milliseconds correctly', () => {
    const cues = parseSubtitles(SAMPLE_SRT);
    expect(cues[2].start).toBe(7.25);
    expect(cues[2].end).toBe(9);
  });

  it('returns empty array for empty input', () => {
    expect(parseSubtitles('')).toEqual([]);
  });

  it('skips blocks without valid timestamp lines', () => {
    const content = `1
this is not a timestamp
Hello

2
00:00:01,000 --> 00:00:02,000
Real cue`;
    const cues = parseSubtitles(content);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('Real cue');
  });

  it('skips cues with empty text', () => {
    const content = `1
00:00:01,000 --> 00:00:02,000

2
00:00:03,000 --> 00:00:04,000
Valid`;
    const cues = parseSubtitles(content);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('Valid');
  });

  it('handles CRLF line endings', () => {
    const content = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n\r\n';
    const cues = parseSubtitles(content);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('Hello');
  });
});

describe('parseSubtitles - VTT', () => {
  const SAMPLE_VTT = `WEBVTT

00:00:01.000 --> 00:00:03.500
First cue

cue-id-2
00:00:04.000 --> 00:00:06.000
Second cue
with two lines`;

  it('strips WEBVTT header', () => {
    const cues = parseSubtitles(SAMPLE_VTT);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('First cue');
  });

  it('handles VTT cue identifiers (non-numeric)', () => {
    const cues = parseSubtitles(SAMPLE_VTT);
    expect(cues[1].text).toBe('Second cue\nwith two lines');
  });

  it('parses VTT timestamps with dot separator', () => {
    const cues = parseSubtitles(SAMPLE_VTT);
    expect(cues[0].start).toBe(1);
    expect(cues[0].end).toBe(3.5);
  });
});

describe('formatTime', () => {
  it('formats zero', () => {
    expect(formatTime(0)).toBe('00:00:00');
  });

  it('formats single-digit minutes/seconds with padding', () => {
    expect(formatTime(65)).toBe('00:01:05');
  });

  it('formats hours', () => {
    expect(formatTime(3661)).toBe('01:01:01');
  });

  it('returns 00:00:00 for negative', () => {
    expect(formatTime(-5)).toBe('00:00:00');
  });

  it('returns 00:00:00 for NaN', () => {
    expect(formatTime(Number.NaN)).toBe('00:00:00');
  });

  it('returns 00:00:00 for Infinity', () => {
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('00:00:00');
  });

  it('truncates fractional seconds', () => {
    expect(formatTime(1.9)).toBe('00:00:01');
  });
});

describe('findCueAtTime', () => {
  const cues = [
    { index: 1, start: 1, end: 3, text: 'A' },
    { index: 2, start: 5, end: 7, text: 'B' },
    { index: 3, start: 10, end: 12, text: 'C' },
  ];

  it('finds the cue at the given time', () => {
    expect(findCueAtTime(cues, 2)?.text).toBe('A');
    expect(findCueAtTime(cues, 6)?.text).toBe('B');
  });

  it('returns null when no cue is active', () => {
    expect(findCueAtTime(cues, 0)).toBeNull();
    expect(findCueAtTime(cues, 4)).toBeNull();
    expect(findCueAtTime(cues, 8)).toBeNull();
  });

  it('uses half-open interval [start, end)', () => {
    // At exactly start, should match
    expect(findCueAtTime(cues, 1)?.text).toBe('A');
    // At exactly end, should NOT match (transitions to next cue if exists)
    expect(findCueAtTime(cues, 3)).toBeNull();
  });

  it('returns null for empty cue list', () => {
    expect(findCueAtTime([], 1)).toBeNull();
  });
});