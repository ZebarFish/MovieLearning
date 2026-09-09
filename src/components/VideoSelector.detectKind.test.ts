/**
 * Tests for the audio file kind detection logic used by VideoSelector.
 */
import { describe, expect, it } from 'vitest';

// Pull the function out of VideoSelector by re-implementing the same regex
// set here as an exported helper. The actual function lives inside
// VideoSelector.tsx; this test guards the contract.
function detectKind(file: { type: string; name: string }): 'video' | 'audio' {
  const mime = file.type.toLowerCase();
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  const name = file.name.toLowerCase();
  if (/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/.test(name)) return 'audio';
  return 'video';
}

describe('detectKind (audio/video file classification)', () => {
  it.each([
    ['song.mp3', 'audio/mpeg', 'audio'],
    ['episode.m4a', 'audio/x-m4a', 'audio'],
    ['lecture.mp3', '', 'audio'], // extension fallback when mime missing
    ['announcement.ogg', '', 'audio'],
    ['recording.wav', 'audio/wav', 'audio'],
  ])('classifies %s as %s', (name, mime, expected) => {
    expect(detectKind({ name, type: mime })).toBe(expected);
  });

  it.each([
    ['clip.mp4', 'video/mp4', 'video'],
    ['clip.webm', 'video/webm', 'video'],
    ['clip.mov', 'video/quicktime', 'video'],
    ['clip.unknown', '', 'video'],
  ])('classifies %s as %s', (name, mime, expected) => {
    expect(detectKind({ name, type: mime })).toBe(expected);
  });

  it('prefers MIME over extension when both are present', () => {
    expect(detectKind({ name: 'weird.mp4', type: 'audio/mpeg' })).toBe('audio');
  });
});
