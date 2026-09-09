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
  useEffect(() => {
    loopRef.current = loop;
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
        if (
          liveLoop.pointA !== null &&
          liveLoop.pointB !== null &&
          video.currentTime >= liveLoop.pointB
        ) {
          video.currentTime = liveLoop.pointB;
          video.pause();
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
