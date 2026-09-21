/**
 * ABLoopControls
 *
 * Three buttons under the video: "设 A 点", "设 B 点", "循环 A-B". Also has
 * a clear button. Uses an effect to monitor `currentTime` and snap back to
 * point A once playback reaches point B.
 *
 * The "set A / set B" rules:
 *   - If A is unset OR currentTime < A → set A (clear B)
 *   - Else if B is unset and currentTime > A → set B
 *   - Else → reset and start over (set A at current time)
 *
 * Loop OFF means "play once, stop at B": the playhead is held at B and the
 * markers are cleared so a later manual play is not dragged back. The
 * stop-at-B branch is gated on the playhead having actually been observed
 * *before* B since the current pair was installed (see `enteredSegmentRef`).
 * Placing B at the playhead stores `pointB === currentTime`, which is NOT the
 * same fact as "playback reached B" — without the latch the stop fires on the
 * very next frame, pauses the video and wipes the markers the user just set.
 * Do not "simplify" that latch away.
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
  // True once this marker pair has stopped playback at B and been cleared —
  // guards against re-clearing every rAF frame until new markers arrive.
  const stopDisarmedRef = useRef(false);
  // True once the playhead has been observed *before* B since the current
  // marker pair was installed. Placing B at the playhead (currentTime ===
  // pointB) must not count as "reaching" B — otherwise the stop-at-B branch
  // fires on the very next frame, pauses the video and clears both markers the
  // user just set. A pair the playhead has not entered yet has not been played
  // through, so it cannot have been "reached". This is the fix for the
  // "setting B wipes A and B" bug — keep the latch.
  const enteredSegmentRef = useRef(false);
  // Previous marker VALUES, used to detect a genuine A/B change: the `loop`
  // object identity also changes on unrelated updates (e.g. the enabled
  // toggle), and those must NOT re-arm the stop.
  const markersRef = useRef<{ a: number | null; b: number | null }>({
    a: loop.pointA,
    b: loop.pointB,
  });
  useEffect(() => {
    loopRef.current = loop;
    // Fresh markers re-arm the stop-at-B behaviour.
    if (loop.pointA !== null || loop.pointB !== null) {
      stopDisarmedRef.current = false;
    }
    // A new marker PAIR invalidates the "playhead entered the segment" latch:
    // the pair has not been played through yet, so it cannot be "reached".
    if (
      markersRef.current.a !== loop.pointA ||
      markersRef.current.b !== loop.pointB
    ) {
      markersRef.current = { a: loop.pointA, b: loop.pointB };
      enteredSegmentRef.current = false;
      // …unless the playhead already sits strictly *before* B the moment the
      // pair is installed, in which case the segment HAS been entered. Arming
      // here — rather than waiting for the next rAF/timeupdate frame — matters
      // for scripted cue replay: App seeks to cue.start and a caller may jump
      // the playhead straight past B before any frame observes the in-segment
      // position. Placing B at the playhead still cannot arm it, because then
      // currentTime === pointB and the `< pointB - 0.05` guard is false.
      const video = videoRef.current;
      if (
        video !== null &&
        loop.pointA !== null &&
        loop.pointB !== null &&
        video.currentTime < loop.pointB - 0.05
      ) {
        enteredSegmentRef.current = true;
      }
    }
  }, [loop]);

  // Effect: when playback reaches B, jump back to A and continue playing.
  // The <video> element is conditionally rendered (only with a loaded
  // source), so we must NOT capture it once here — read videoRef.current
  // on every frame and attach event listeners lazily as soon as it mounts.
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
        video.addEventListener('seeked', checkAndLoopBack);
      }

      const liveLoop = loopRef.current;
      // Loop disabled: if markers exist, stop at B instead of looping
      // (segment study relies on this "play once, stop at end" semantic).
      if (!liveLoop.enabled) {
        if (liveLoop.pointA !== null && liveLoop.pointB !== null) {
          if (video.currentTime < liveLoop.pointB - 0.05) {
            // Playback is genuinely inside the segment — arm the stop. This
            // must happen BEFORE B can fire, so merely placing B at the
            // playhead (currentTime === pointB) does not count as reaching it.
            enteredSegmentRef.current = true;
          } else if (
            enteredSegmentRef.current &&
            video.currentTime >= liveLoop.pointB
          ) {
            video.currentTime = liveLoop.pointB;
            video.pause();
            // Disarm the stop: clear the markers so a manual play afterwards
            // is not dragged back to B forever. The next scoped replay
            // (重听这句 / 原声 / segment play) re-arms them itself.
            if (!stopDisarmedRef.current) {
              stopDisarmedRef.current = true;
              onLoopChange(clearABLoop());
            }
          }
        }
        return;
      }
      if (liveLoop.pointA === null || liveLoop.pointB === null) return;
      const now = video.currentTime;
      // Snap back when reaching or passing B. We also bail when now is very
      // small (just jumped back) to prevent an infinite re-seek loop.
      if (now < liveLoop.pointB) return;
      if (now < liveLoop.pointA + 0.05) return;
      video.currentTime = liveLoop.pointA;
      if (video.paused) {
        void video.play();
      }
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
      video?.removeEventListener('seeked', checkAndLoopBack);
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
