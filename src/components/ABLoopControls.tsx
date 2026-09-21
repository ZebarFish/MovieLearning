/**
 * ABLoopControls
 *
 * Three buttons under the video: "设 A 点", "设 B 点", "循环 A-B". Also has a
 * clear button. An effect watches the playhead and polices the segment.
 *
 * The "set A / set B" rules:
 *   - If A is unset OR currentTime < A → set A (clear B)
 *   - Else if B is unset and currentTime > A → set B
 *   - Else → reset and start over (set A at current time)
 *
 * 循环 A-B OFF — "play once, stop at B", and the markers are KEPT:
 *   - playback reaching B parks the playhead on B and pauses;
 *   - pressing play while parked on B restarts the segment from A;
 *   - dragging the playhead past B is the user escaping the segment, so
 *     nothing grabs it back until the markers change or the playhead returns.
 * Only a pair flagged `oneShot` — installed by the app for a single scoped cue
 * replay (听写「重听这句」 / 跟读「原声」) — is dropped once it stops at B;
 * user-set markers are never one-shot.
 *
 * 循环 A-B ON — unchanged: reaching B jumps back to A and keeps playing.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import {
  Button,
  ButtonGroup,
  Paper,
  Stack,
  Switch,
  Tooltip,
  Typography,
  FormControlLabel,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import RepeatIcon from '@mui/icons-material/Repeat';
import type { ABLoopState, VideoSource } from '../types';
import { clearABLoop, nextABState } from '../utils/abLoop';
import { formatTime } from '../utils/subtitleParser';

interface ABLoopControlsProps {
  source: VideoSource | null;
  videoRef: RefObject<HTMLMediaElement>;
  currentTime: number;
  loop: ABLoopState;
  onLoopChange: (next: ABLoopState) => void;
}

export function ABLoopControls({
  source,
  videoRef,
  currentTime,
  loop,
  onLoopChange,
}: ABLoopControlsProps): JSX.Element {
  const hasVideo = source !== null;

  const handleSetMarker = useCallback(() => {
    if (!hasVideo) return;
    // Use the live video time to avoid stale React state during seeks/drags.
    const liveTime = videoRef.current?.currentTime ?? currentTime;
    onLoopChange(nextABState(loop, liveTime));
  }, [hasVideo, loop, currentTime, onLoopChange, videoRef]);

  const handleToggleLoop = useCallback(
    (_: unknown, enabled: boolean) => {
      onLoopChange({ ...loop, enabled });
    },
    [loop, onLoopChange],
  );

  const handleClear = useCallback(() => {
    onLoopChange(clearABLoop());
  }, [onLoopChange]);

  // Keep the latest loop state in a ref so the timeupdate handler (registered
  // once) always reads fresh values without re-binding every state change.
  const loopRef = useRef<ABLoopState>(loop);
  // Previous marker VALUES, used to detect a genuine A/B change: the `loop`
  // object identity also changes on unrelated updates (e.g. the enabled
  // toggle), and those must not be mistaken for a new segment.
  const markersRef = useRef<{ a: number | null; b: number | null }>({
    a: loop.pointA,
    b: loop.pointB,
  });
  // True while the playhead sits deliberately *past* B (the user dragged the
  // progress bar beyond the segment). The segment must not grab it back then:
  // no hold-at-B, no "restart from A" on play. Cleared when the marker pair
  // changes or the playhead returns to/inside the segment.
  const pastBRef = useRef(false);
  useEffect(() => {
    loopRef.current = loop;
    // A new marker PAIR starts a fresh segment: forget any previous escape.
    if (
      markersRef.current.a !== loop.pointA ||
      markersRef.current.b !== loop.pointB
    ) {
      markersRef.current = { a: loop.pointA, b: loop.pointB };
      pastBRef.current = false;
    }
  }, [loop]);

  // Effect: police the segment as the playhead moves. The <video> element is
  // conditionally rendered (only with a loaded source), so we must NOT capture
  // it once here — read videoRef.current on every frame and attach event
  // listeners lazily as soon as it mounts.
  useEffect(() => {
    let rafId: number | null = null;
    let video: HTMLMediaElement | null = null;
    let listenersBound = false;

    const checkAndLoopBack = (): void => {
      video = videoRef.current;
      if (!video) return;

      // Bind real events once the element exists (cheaper than RAF-only).
      if (!listenersBound) {
        listenersBound = true;
        video.addEventListener('timeupdate', checkAndLoopBack);
        video.addEventListener('seeked', handleSeeked);
        video.addEventListener('play', handlePlay);
      }

      const liveLoop = loopRef.current;
      const { pointA, pointB } = liveLoop;
      if (pointA === null || pointB === null) return;

      if (liveLoop.enabled) {
        const now = video.currentTime;
        // Guard against an infinite re-seek loop: only fire once B is actually
        // reached, and bail right after jumping back to A.
        if (now < pointB) return;
        if (now < pointA + 0.05) return;
        video.currentTime = pointA;
        pastBRef.current = false;
        if (video.paused) void video.play();
        return;
      }

      // Loop off: "play once, stop at B". The markers are KEPT — pressing play
      // while parked at B restarts the segment from A (see handlePlay).
      if (pastBRef.current) return;
      if (video.currentTime < pointB) return;
      video.currentTime = pointB;
      video.pause();
      if (liveLoop.oneShot === true) {
        // App-installed pair (听写「重听这句」 / 跟读「原声」): it belongs to the
        // scoped replay, not to the user, so drop it once the cue is done.
        // Clearing makes this branch unreachable on the following frames.
        onLoopChange(clearABLoop());
      }
    };

    // The user dragged the progress bar beyond the segment: let go of it.
    const handleSeeked = (): void => {
      const el = videoRef.current;
      if (!el) return;
      const liveLoop = loopRef.current;
      if (liveLoop.pointB === null) {
        pastBRef.current = false;
        return;
      }
      pastBRef.current = el.currentTime > liveLoop.pointB + 0.05;
    };

    // Parked at/after B with a user-set pair: play the segment again from A.
    const handlePlay = (): void => {
      const el = videoRef.current;
      if (!el) return;
      const liveLoop = loopRef.current;
      if (liveLoop.enabled) return;
      if (liveLoop.pointA === null || liveLoop.pointB === null) return;
      if (pastBRef.current) return;
      if (el.currentTime < liveLoop.pointB) return;
      el.currentTime = liveLoop.pointA;
    };

    const tick = (): void => {
      checkAndLoopBack();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      video?.removeEventListener('timeupdate', checkAndLoopBack);
      video?.removeEventListener('seeked', handleSeeked);
      video?.removeEventListener('play', handlePlay);
    };
  }, [videoRef]);

  const buttonLabel =
    loop.pointA === null ||
    (loop.pointB !== null && currentTime >= loop.pointB)
      ? '设 A 点'
      : loop.pointB === null
        ? '设 B 点'
        : '重新设 A';

  const disableSwitch =
    !hasVideo || loop.pointA === null || loop.pointB === null;

  const aLabel = loop.pointA !== null ? formatTime(loop.pointA) : '未设置';
  const bLabel = loop.pointB !== null ? formatTime(loop.pointB) : '未设置';

  return (
    <Paper
      elevation={2}
      sx={{ px: 1.5, py: 0.75, mt: 0.75, borderRadius: 1 }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        sx={{ minHeight: 36 }}
      >
        <Typography variant="subtitle2" sx={{ whiteSpace: 'nowrap' }}>
          A-B 循环
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ whiteSpace: 'nowrap', minWidth: 140 }}
        >
          A: {aLabel} · B: {bLabel}
        </Typography>

        <ButtonGroup size="small" variant="outlined">
          <Tooltip
            title={
              !hasVideo
                ? '请先加载视频'
                : buttonLabel === '设 A 点'
                  ? '在当前位置设置 A 点'
                  : buttonLabel === '设 B 点'
                    ? '在当前位置设置 B 点 (B 必须晚于 A)'
                    : '重新从当前位置开始设置 A 点'
            }
          >
            <span>
              <Button
                size="small"
                onClick={handleSetMarker}
                color="primary"
                disabled={!hasVideo}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {buttonLabel}
              </Button>
            </span>
          </Tooltip>
          <Button
            size="small"
            onClick={handleClear}
            startIcon={<RestartAltIcon />}
            disabled={loop.pointA === null && loop.pointB === null}
            sx={{ whiteSpace: 'nowrap' }}
          >
            清除
          </Button>
        </ButtonGroup>

        <FormControlLabel
          sx={{ ml: 'auto' }}
          control={
            <Switch
              size="small"
              checked={loop.enabled}
              onChange={handleToggleLoop}
              disabled={disableSwitch}
            />
          }
          label={
            <Stack direction="row" spacing={0.5} alignItems="center">
              <RepeatIcon fontSize="small" />
              <Typography variant="caption">循环 A-B</Typography>
            </Stack>
          }
        />
      </Stack>
    </Paper>
  );
}
