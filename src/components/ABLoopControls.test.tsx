/**
 * Contract tests for ABLoopControls' segment policing.
 *
 * The frozen contract (fifth round of user feedback):
 *   A1  loop OFF, user-set A+B: playback reaching B parks on B and pauses, and
 *       the markers are KEPT (this is the "setting B wipes A/B" regression).
 *   A2  parked on B, pressing play restarts the segment from A.
 *   A3  the user dragging the playhead past B escapes the segment: no
 *       hold-at-B, no play-jump back to A.
 *   A4  a lone A (no B) or no markers never intervenes.
 *   B   loop ON: reaching B jumps back to A and keeps playing.
 *   C   a one-shot pair (听写「重听这句」/ 跟读「原声」) is dropped at B.
 *
 * rAF is stubbed so the frame-driven check runs only when we say so; jsdom
 * fires no real media events, so `play`/`seeked` are dispatched by hand.
 */
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
  /** jsdom media never really plays; flip this to model a playing element. */
  setPaused: (paused: boolean) => void;
}

function makeVideo(): FakeVideo {
  const video = document.createElement('video');
  let fakeTime = 0;
  let fakePaused = true;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => fakeTime,
    set: (value: number) => {
      fakeTime = value;
    },
  });
  // jsdom media is always "paused"; playback control is asserted via spies.
  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => fakePaused,
  });
  const play = vi.fn();
  const pause = vi.fn();
  video.play = play as unknown as HTMLMediaElement['play'];
  video.pause = pause as unknown as HTMLMediaElement['pause'];
  return {
    video,
    play,
    pause,
    setTime: (t: number) => {
      fakeTime = t;
    },
    setPaused: (paused: boolean) => {
      fakePaused = paused;
    },
  };
}

function Harness({
  video,
  onChange,
  initialLoop,
}: {
  video: HTMLMediaElement;
  onChange: (next: ABLoopState) => void;
  initialLoop?: ABLoopState;
}): JSX.Element {
  const [loop, setLoop] = useState<ABLoopState>(
    initialLoop ?? {
      pointA: null,
      pointB: null,
      enabled: false,
      oneShot: false,
    },
  );
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

/** Install a user-set A=10 / B=20 pair through the real button flow. */
function installUserPair(media: FakeVideo): void {
  media.setTime(10);
  clickSetMarker('设 A 点');
  runFrame();
  media.setTime(20);
  clickSetMarker('设 B 点');
  runFrame();
}

describe('ABLoopControls contract', () => {
  it('A1: setting B at the playhead keeps both markers and parks on B', () => {
    const media = makeVideo();
    const onChange = vi.fn();
    render(<Harness video={media.video} onChange={onChange} />);
    runFrame();

    installUserPair(media);
    runFrame();

    // The core user complaint: neither marker may ever be cleared.
    const emitted = onChange.mock.calls.map((c) => c[0] as ABLoopState);
    expect(emitted.length).toBeGreaterThan(0);
    for (const state of emitted) {
      expect(state.pointA === null && state.pointB === null).toBe(false);
    }
    expect(screen.getByTestId('a').textContent).toBe('10');
    expect(screen.getByTestId('b').textContent).toBe('20');

    // Stopping at B is expected and normal: the playhead parks there.
    expect(media.pause).toHaveBeenCalled();
    expect(media.video.currentTime).toBe(20);
  });

  it('A2: pressing play while parked on B restarts the segment from A', () => {
    const media = makeVideo();
    const onChange = vi.fn();
    render(<Harness video={media.video} onChange={onChange} />);
    runFrame();

    installUserPair(media);
    expect(media.video.currentTime).toBe(20);
    expect(screen.getByTestId('a').textContent).toBe('10');

    // jsdom fires no real media events — drive `play` by hand.
    media.video.dispatchEvent(new Event('play'));
    expect(media.video.currentTime).toBe(10);
  });

  it('A2b: one click on 播放 is enough to get the segment actually playing', () => {
    const media = makeVideo();
    render(
      <Harness
        video={media.video}
        onChange={vi.fn()}
        initialLoop={{
          pointA: 10,
          pointB: 20,
          enabled: false,
          oneShot: false,
        }}
      />,
    );
    runFrame();

    // Park on B (the frame loop holds it there).
    media.setTime(20);
    runFrame();
    expect(media.video.currentTime).toBe(20);

    // Healthy resume: the element is already playing when the 'play' event
    // fires, so the handler must NOT issue a redundant play().
    media.setPaused(false);
    media.video.dispatchEvent(new Event('play'));
    expect(media.video.currentTime).toBe(10);
    expect(media.play).not.toHaveBeenCalled();

    // Raced resume: a frame slid in between play() and the 'play' event and
    // paused the element again. Reported by the user as "跳到 A 点但不播放，
    // 要再点一次播放". The handler must re-issue play() so a single click
    // starts the segment.
    media.setTime(20);
    runFrame();
    media.setPaused(true);
    media.video.dispatchEvent(new Event('play'));
    expect(media.video.currentTime).toBe(10);
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  it('A3: dragging past B escapes the segment — no grab-back, no play-jump', () => {
    const media = makeVideo();
    render(
      <Harness
        video={media.video}
        onChange={vi.fn()}
        initialLoop={{ pointA: 10, pointB: 20, enabled: false, oneShot: false }}
      />,
    );
    runFrame();

    media.setTime(25);
    media.video.dispatchEvent(new Event('seeked'));
    runFrame();
    // The segment must not pull the playhead back to B.
    expect(media.video.currentTime).toBe(25);

    media.video.dispatchEvent(new Event('play'));
    // …nor jump back to A when the user resumes.
    expect(media.video.currentTime).toBe(25);
  });

  it('A4: a lone A (no B) never intervenes with playback', () => {
    const media = makeVideo();
    render(
      <Harness
        video={media.video}
        onChange={vi.fn()}
        initialLoop={{ pointA: 10, pointB: null, enabled: false, oneShot: false }}
      />,
    );
    runFrame();

    media.setTime(15);
    runFrame();
    media.video.dispatchEvent(new Event('play'));
    expect(media.pause).not.toHaveBeenCalled();
    expect(media.video.currentTime).toBe(15);
  });

  it('B: with the loop on, reaching B jumps back to A and continues', () => {
    const media = makeVideo();
    render(
      <Harness
        video={media.video}
        onChange={vi.fn()}
        initialLoop={{ pointA: 10, pointB: 20, enabled: true, oneShot: false }}
      />,
    );
    runFrame();

    media.setTime(20.2);
    runFrame();
    expect(media.video.currentTime).toBe(10);
    expect(media.play).toHaveBeenCalled();
  });

  it('C: a one-shot pair is dropped once it stops at the cue end', () => {
    const media = makeVideo();
    render(
      <Harness
        video={media.video}
        onChange={vi.fn()}
        initialLoop={{ pointA: 30, pointB: 32, enabled: false, oneShot: true }}
      />,
    );
    runFrame();

    media.setTime(32.2);
    runFrame();
    expect(media.pause).toHaveBeenCalled();
    expect(media.video.currentTime).toBe(32);
    // The scoped pair belongs to the replay, not the user: it is cleared.
    expect(screen.getByTestId('a').textContent).toBe('null');
    expect(screen.getByTestId('b').textContent).toBe('null');
  });
});
