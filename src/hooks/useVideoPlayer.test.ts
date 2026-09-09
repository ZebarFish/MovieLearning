/**
 * Tests for useVideoPlayer's playbackRate behavior.
 */
import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideoPlayer } from './useVideoPlayer';

function buildFakeMedia(): HTMLMediaElement {
  // jsdom does not implement playbackRate assignment fully — stub it.
  const media = document.createElement('video');
  let rate = 1;
  Object.defineProperty(media, 'playbackRate', {
    get: () => rate,
    set: (v: number) => {
      rate = v;
    },
    configurable: true,
  });
  return media;
}

describe('useVideoPlayer — playback rate', () => {
  it('starts at 1x', () => {
    const { result } = renderHook(() => useVideoPlayer());
    expect(result.current.playbackRate).toBe(1);
  });

  it('reflects the media element rate after setPlaybackRate', () => {
    const { result } = renderHook(() => useVideoPlayer());
    // Attach fake media so the ref resolves.
    (result.current.videoRef as { current: HTMLMediaElement }).current =
      buildFakeMedia();

    act(() => result.current.setPlaybackRate(0.5));
    expect(result.current.playbackRate).toBe(0.5);

    act(() => result.current.setPlaybackRate(2));
    expect(result.current.playbackRate).toBe(2);
  });

  it('is a no-op when the media element ref is null (rate stays at 1)', () => {
    const { result } = renderHook(() => useVideoPlayer());
    expect(() => result.current.setPlaybackRate(1.25)).not.toThrow();
    // Without an element to assign onto, hook state stays at default.
    expect(result.current.playbackRate).toBe(1);
  });

  it('updates when the element raises a ratechange event', () => {
    const { result } = renderHook(() => useVideoPlayer());
    const media = buildFakeMedia();
    (result.current.videoRef as { current: HTMLMediaElement }).current =
      media;

    act(() => {
      media.dispatchEvent(new Event('ratechange'));
    });
    expect(result.current.playbackRate).toBe(1);
  });
});
