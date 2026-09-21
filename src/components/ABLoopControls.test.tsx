/**
 * Regression tests for ABLoopControls' "stop at B when the loop is off" path.
 *
 * The user-reported bug: with the loop OFF, setting A and then setting B made
 * both markers vanish. Placing B stores `pointB === video.currentTime`, and
 * the old check treated "playhead is at/after B" as "playback reached B", so
 * the stop fired on the next frame, paused the video and cleared the markers.
 *
 * The fix requires the playhead to have actually been observed *before* B
 * since the current pair was installed. These tests assert BOTH halves of
 * that contract so the 9277d3b "play once, stop at B" behaviour is not
 * silently deleted while the false-fire is removed.
 *
 * rAF is stubbed so the frame-driven check runs only when we say so — this is
 * what makes the "does it fire on the next frame?" question deterministic.
 */
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ABLoopControls } from './ABLoopControls';
import type { ABLoopState, VideoSource } from '../types';

const SOURCE: VideoSource = {
  src: 'blob://demo',
  name: 'demo.mp4',
  isRemote: false,
  kind: 'video',
};

// ---------------------------------------------------------------------------
// Deterministic requestAnimationFrame: capture callbacks, run them on demand.
// ---------------------------------------------------------------------------
let rafQueue: FrameRequestCallback[] = [];

/** Run exactly one animation frame's worth of callbacks (wrapped in act). */
function runFrame(): void {
  const callbacks = rafQueue;
  rafQueue = [];
  act(() => {
    for (const cb of callbacks) cb(0);
  });
}

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// A controllable <video> + a small harness that owns the loop state, so the
// component behaves exactly as it does inside App (controlled `loop` prop).
// ---------------------------------------------------------------------------
interface FakeVideo {
  video: HTMLMediaElement;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  setTime: (t: number) => void;
}

function makeVideo(): FakeVideo {
  const video = document.createElement('video');
  let fakeTime = 0;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => fakeTime,
    set: (value: number) => {
      fakeTime = value;
    },
  });
  // jsdom media is always "paused"; playback control is asserted via spies.
  Object.defineProperty(video, 'paused', { configurable: true, get: () => true });
  const play = vi.fn();
  const pause = vi.fn();
  video.play = play as unknown as HTMLMediaElement['play'];
  video.pause = pause as unknown as HTMLMediaElement['pause'];
  return { video, play, pause, setTime: (t: number) => { fakeTime = t; } };
}

function Harness({
  video,
  onChange,
}: {
  video: HTMLMediaElement;
  onChange: (next: ABLoopState) => void;
}): JSX.Element {
  const [loop, setLoop] = useState<ABLoopState>({
    pointA: null,
    pointB: null,
    enabled: false,
  });
  const videoRef = useRef<HTMLMediaElement>(video);
  const handleLoopChange = (next: ABLoopState): void => {
    onChange(next);
    setLoop(next);
  };
  return (
    <div>
      <ABLoopControls
        source={SOURCE}
        videoRef={videoRef}
        currentTime={loop.pointA ?? 0}
        loop={loop}
        onLoopChange={handleLoopChange}
      />
      <span data-testid="a">{loop.pointA ?? 'null'}</span>
      <span data-testid="b">{loop.pointB ?? 'null'}</span>
    </div>
  );
}

/** Click the single set-marker button by its current label. */
function clickSetMarker(label: '设 A 点' | '设 B 点' | '重新设 A'): void {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

describe('ABLoopControls stop-at-B', () => {
  it('does not wipe the markers when B is placed at the current playhead', () => {
    const media = makeVideo();
    const onChange = vi.fn();
    render(<Harness video={media.video} onChange={onChange} />);

    // Bind the component's frame loop + listeners.
    runFrame();

    // 1. Set A at 10s.
    media.setTime(10);
    clickSetMarker('设 A 点');
    runFrame();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ pointA: 10, pointB: null }),
    );

    // 2. Move the playhead to 20s and set B *there* — the reported failure.
    onChange.mockClear();
    media.setTime(20);
    clickSetMarker('设 B 点');
    runFrame();
    runFrame();

    // Both markers must survive: no pause, and never a cleared state.
    expect(media.pause).not.toHaveBeenCalled();
    const emitted = onChange.mock.calls.map((c) => c[0] as ABLoopState);
    expect(emitted.length).toBeGreaterThan(0);
    for (const state of emitted) {
      expect(state.pointA).toBe(10);
      expect(state.pointB).toBe(20);
    }
    expect(screen.getByTestId('a').textContent).toBe('10');
    expect(screen.getByTestId('b').textContent).toBe('20');
  });

  it('still stops at B once playback has genuinely entered the segment', async () => {
    const media = makeVideo();
    const onChange = vi.fn();
    render(<Harness video={media.video} onChange={onChange} />);
    runFrame();

    // Install A=10 then B=20 (B placed at the playhead — must NOT stop).
    media.setTime(10);
    clickSetMarker('设 A 点');
    runFrame();
    media.setTime(20);
    clickSetMarker('设 B 点');
    runFrame();
    expect(media.pause).not.toHaveBeenCalled();

    // Playback runs inside the segment (15 < B): the latch arms, still no stop.
    media.setTime(15);
    runFrame();
    expect(media.pause).not.toHaveBeenCalled();

    // Reaching B now stops playback and clears the markers (9277d3b contract).
    media.setTime(20.2);
    runFrame();
    await waitFor(() => expect(media.pause).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('a').textContent).toBe('null'),
    );
    expect(screen.getByTestId('b').textContent).toBe('null');
  });
});
