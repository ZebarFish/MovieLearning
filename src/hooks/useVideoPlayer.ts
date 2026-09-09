/**
 * useVideoPlayer
 *
 * Encapsulates everything related to the <video> element: a ref, currentTime,
 * playing state, and helpers to seek / play / pause. Consumers can subscribe
 * to the time via the returned `currentTime` value (updates ~4x/second while
 * playing) or wire up their own listeners via the ref.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface UseVideoPlayerResult {
  /** Ref to attach to the <video> or <audio> element. */
  videoRef: RefObject<HTMLMediaElement>;
  /** Current playback time in seconds. */
  currentTime: number;
  /** Whether the media is currently playing. */
  isPlaying: boolean;
  /** Seek to a specific time (in seconds). */
  seek: (time: number) => void;
  /** Toggle play/pause. */
  togglePlay: () => void;
  /** Set the playback rate (0.25..4). */
  setPlaybackRate: (rate: number) => void;
  /** Current playback rate. */
  playbackRate: number;
}

export function useVideoPlayer(): UseVideoPlayerResult {
  // Mutable ref for imperative access (videoRef.current.currentTime etc.).
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  // State mirror so effects can re-run when the element mounts/unmounts —
  // the <video> element is conditionally rendered (only when a source is
  // loaded), so binding listeners once on mount would miss it entirely.
  const [mediaEl, setMediaEl] = useState<HTMLMediaElement | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRateState] = useState<number>(1);

  // Callback ref: keep the mutable ref in sync AND trigger the listener
  // binding effect below whenever the element appears/disappears.
  // The returned value is a callable function (so React can use it as a ref)
  // WITH a live `.current` getter — many consumers read videoRef.current
  // imperatively (play/pause/loop monitoring), which a bare callback lacks.
  const videoRef = useCallback((el: HTMLMediaElement | null): void => {
    mediaRef.current = el;
    setMediaEl(el);
  }, []) as unknown as RefObject<HTMLMediaElement>;
  Object.defineProperty(videoRef, 'current', {
    get: () => mediaRef.current,
    configurable: true,
  });

  // Track time updates from the media element. We listen to the native event
  // rather than running our own RAF loop so we don't fight the browser.
  useEffect(() => {
    const video = mediaEl;
    if (!video) {
      return;
    }

    const onTimeUpdate = (): void => setCurrentTime(video.currentTime);
    const onPlay = (): void => setIsPlaying(true);
    const onPause = (): void => setIsPlaying(false);
    const onSeeked = (): void => setCurrentTime(video.currentTime);
    const onRateChange = (): void => setPlaybackRateState(video.playbackRate);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ratechange', onRateChange);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ratechange', onRateChange);
    };
  }, [mediaEl]);

  const seek = useCallback((time: number) => {
    const video = mediaRef.current;
    if (!video) {
      return;
    }
    video.currentTime = Math.max(0, time);
  }, []);

  const togglePlay = useCallback(() => {
    const video = mediaRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const video = mediaRef.current;
    if (!video) {
      return;
    }
    video.playbackRate = rate;
    setPlaybackRateState(rate);
  }, []);

  return {
    videoRef: videoRef as unknown as RefObject<HTMLMediaElement>,
    currentTime,
    isPlaying,
    seek,
    togglePlay,
    setPlaybackRate,
    playbackRate,
  };
}