/**
 * VideoPlayer
 *
 * Renders the <video> element and the floating subtitle overlay. When the
 * parent supplies multiple subtitle tracks, the overlay can render one or
 * two lines (e.g. bilingual English + Chinese) depending on `displayMode`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Tooltip,
  Typography,
  Stack,
  ToggleButtonGroup,
  ToggleButton,
  Slider,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import SubtitleOffIcon from '@mui/icons-material/ClosedCaptionOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import SpeedIcon from '@mui/icons-material/Speed';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import type { RefObject } from 'react';
import type {
  SubtitleDisplayMode,
  SubtitleTrack,
  VideoSource,
} from '../types';
import { findCueAtTime, formatTime } from '../utils/subtitleParser';
import { filterCueText } from '../utils/textDiff';

interface VideoPlayerProps {
  source: VideoSource | null;
  videoRef: RefObject<HTMLMediaElement>;
  tracks: SubtitleTrack[];
  displayMode: SubtitleDisplayMode;
  onDisplayModeChange: (m: SubtitleDisplayMode) => void;
  currentTime: number;
  subtitleVisible: boolean;
  onToggleSubtitleVisible: () => void;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  /** Opens the local file picker directly — used by the empty-state CTA. */
  onPickLocalFile: () => void;
}

const PLAYBACK_RATES: { value: number; label: string }[] = [
  { value: 0.5, label: '0.5x' },
  { value: 0.75, label: '0.75x' },
  { value: 1, label: '1x' },
  { value: 1.25, label: '1.25x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
];

function describeMediaError(code: number): string {
  switch (code) {
    case 1:
      return '媒体加载被中止。';
    case 2:
      return '网络错误: 文件下载失败,请检查 URL 或网络。';
    case 3:
      return '解码失败: 文件可能已损坏或不兼容。';
    case 4:
      return (
        '当前文件无法在浏览器中播放。\n\n' +
        '最常见的原因:\n' +
        '  1. 视频容器格式不支持 (例如 .mkv / .avi / .flv)\n' +
        '  2. 视频编码不支持 (推荐 H.264)\n' +
        '  3. 音频编码不支持 (推荐 AAC)\n\n' +
        '解决方案 —— 一行 ffmpeg 命令即可:\n' +
        '  • 快速转封装 (不重新编码,秒级):\n' +
        '    ffmpeg -i input.mkv -c copy output.mp4\n' +
        '  • 重新编码 (兼容性最好):\n' +
        '    ffmpeg -i input.mkv -c:v libx264 -c:a aac output.mp4\n\n' +
        '提取外挂字幕 (供本应用使用):\n' +
        '  ffmpeg -i input.mkv -map 0:s:0 output.srt'
      );
    default:
      return '媒体加载失败。';
  }
}

export function VideoPlayer({
  source,
  videoRef,
  tracks,
  displayMode,
  onDisplayModeChange,
  currentTime,
  subtitleVisible,
  onToggleSubtitleVisible,
  playbackRate,
  onPlaybackRateChange,
  onPickLocalFile,
}: VideoPlayerProps): JSX.Element {
  const [errorMsg, setErrorMsg] = useState<string>('');
  const isAudio = source?.kind === 'audio';

  // ---- Audio diagnostics ---------------------------------------------------
  // Browsers will silently auto-mute a <video> that started without user
  // gesture (autoplay policy). Detect this and surface a one-click fix.
  // (No "missing audio track" heuristic — browser counters are unreliable
  // and produced false positives; the user can hear whether audio exists.)
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const lastHeardVolumeRef = useRef<number>(1);

  // Sync ref -> element on each render so user changes are picked up.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = isMuted;
  }, [volume, isMuted, source?.src, videoRef]);

  // ---- video error handling -------------------------------------------------
  const handleError = (
    e: React.SyntheticEvent<HTMLVideoElement, Event>,
  ): void => {
    const v = e.currentTarget;
    setErrorMsg(describeMediaError(v.error?.code ?? 0));
  };

  // Detect muted-on-load issues once metadata is available, so we can warn
  // the user with actionable guidance.
  const handleLoadedMetadata = (
    e: React.SyntheticEvent<HTMLMediaElement, Event>,
  ): void => {
    const el = e.currentTarget;
    // 1) muted?
    if (el.muted) {
      setIsMuted(true);
    }
    // 2) video info summary. Some browsers expose dims / duration.
    const dur = Number.isFinite(el.duration) ? `${el.duration.toFixed(1)}s` : '?';
    // eslint-disable-next-line no-console
    console.debug('[media]', isAudio ? 'audio' : 'video', dur);

    // 3) Record the volume the user *wants* (default 1) so we can restore it
    //    after an auto-mute.
    lastHeardVolumeRef.current = el.volume || 1;
  };

  useEffect(() => {
    setErrorMsg('');
    setIsMuted(false);
    setVolume(1);
  }, [source?.src]);

  // Tracks filtered by display mode. Capability is judged by TEXT CONTENT,
  // not the track lang tag: bilingual files downloaded by URL are tagged
  // 'other', yet can still render their English/Chinese part separately.
  const hasCJK = (s: string): boolean => /[\u4e00-\u9fff]/.test(s);
  const canEn = useCallback(
    (t: SubtitleTrack): boolean =>
      t.lang === 'en' ||
      t.cues.slice(0, 5).some((c) => /[A-Za-z]/.test(c.text)),
    [],
  );
  const canZh = useCallback(
    (t: SubtitleTrack): boolean =>
      t.lang === 'zh' || t.cues.slice(0, 5).some((c) => hasCJK(c.text)),
    [],
  );
  const visibleTracks = useMemo<SubtitleTrack[]>(() => {
    if (displayMode === 'none') return [];
    if (displayMode === 'en') return tracks.filter(canEn);
    if (displayMode === 'zh') return tracks.filter(canZh);
    // both: english first, then chinese, then everything else
    const en = tracks.filter((t) => t.lang === 'en');
    const zh = tracks.filter((t) => t.lang === 'zh');
    const rest = tracks.filter(
      (t) => t.lang !== 'en' && t.lang !== 'zh',
    );
    return [...en, ...zh, ...rest];
  }, [tracks, displayMode, canEn, canZh]);

  const hasAnyTrack = tracks.length > 0;
  const showNoSubtitleHint =
    subtitleVisible && !!source && !hasAnyTrack && !errorMsg;

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Audio diagnostic banner — only shows up when something looks wrong.
          Dismissible: the detection heuristic can false-positive on some
          codecs, so the user always has the final say. */}
      {source && !errorMsg && isMuted && (
        <Box
          role="alert"
          sx={{
            mb: 1,
            p: 1.25,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            backgroundColor: 'warning.light',
            color: 'warning.contrastText',
            borderRadius: 1,
          }}
        >
          <Typography
            aria-hidden
            sx={{
              fontSize: '1.4rem',
              lineHeight: 1,
              fontWeight: 700,
            }}
          >
            🔇
          </Typography>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              🔇 浏览器已自动静音了视频(autoplay 策略)。
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', opacity: 0.85 }}>
              点下面按钮取消静音;或点击视频原生控件右下角的小喇叭图标。
            </Typography>
          </Box>
          <Button
            size="small"
            variant="contained"
            color="warning"
            onClick={() => {
              setIsMuted(false);
              setVolume(lastHeardVolumeRef.current || 1);
              // Re-call play() so some browsers lift the autoplay gate.
              const el = videoRef.current;
              if (el) {
                el.muted = false;
                el.volume = lastHeardVolumeRef.current || 1;
                void el.play().catch(() => undefined);
              }
            }}
          >
            取消静音
          </Button>
        </Box>
      )}

      <Box
        sx={{
          position: 'relative',
          width: '100%',
          backgroundColor: 'black',
          borderRadius: 2,
          overflow: 'hidden',
          flex: 1,
          minHeight: 0,
          ...(isAudio
            ? {
                // Audio: no video picture, hero panel fills available space.
                backgroundImage:
                  'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
              }
            : {}),
        }}
        data-testid={isAudio ? 'audio-stage' : 'video-stage'}
      >
        {source ? (
          isAudio ? (
            // Audio mode: hero icon + native audio control bar.
            <Stack
              alignItems="center"
              spacing={2}
              sx={{ width: '100%', maxWidth: 520 }}
              data-testid="audio-hero"
            >
              <Box
                sx={{
                  width: 96,
                  height: 96,
                  borderRadius: '50%',
                  background:
                    'linear-gradient(135deg, #6a5cff 0%, #a855f7 50%, #ec4899 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 32px rgba(168,85,247,0.45)',
                }}
              >
                <GraphicEqIcon sx={{ fontSize: 48, color: 'white' }} />
              </Box>
              <Typography
                variant="h6"
                sx={{
                  color: 'white',
                  fontWeight: 500,
                  textAlign: 'center',
                  wordBreak: 'break-all',
                  px: 2,
                }}
              >
                {source.name}
              </Typography>
              {/* Native audio controls = best browser volume/seek UX. */}
              <audio
                ref={videoRef as RefObject<HTMLAudioElement>}
                src={source.src}
                controls
                preload="metadata"
                onLoadedMetadata={handleLoadedMetadata}
                onError={(e) => {
                  // Re-use the same error message; <audio>.error.code mirrors
                  // <video>.error.code (it implements HTMLMediaElement).
                  const el = e.currentTarget as unknown as {
                    error?: { code: number } | null;
                  };
                  setErrorMsg(describeMediaError(el.error?.code ?? 0));
                }}
                style={{ width: '100%' }}
              />
            </Stack>
          ) : (
            <video
              ref={videoRef as RefObject<HTMLVideoElement>}
              src={source.src}
              controls
              preload="metadata"
              playsInline
              onLoadedMetadata={handleLoadedMetadata}
              onError={handleError}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                objectFit: 'contain',
              }}
            />
          )
        ) : (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              height: '100%',
              width: '100%',
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            <Button
              variant="contained"
              size="large"
              startIcon={<UploadFileIcon />}
              onClick={onPickLocalFile}
              sx={{ whiteSpace: 'nowrap' }}
            >
              选择视频或音频文件
            </Button>
            <Typography variant="body2" sx={{ color: 'inherit' }}>
              点击按钮直接选择本地文件;视频 URL 请点顶部「🎬 媒体与字幕」
            </Typography>
          </Box>
        )}

        <Tooltip title={subtitleVisible ? '隐藏字幕' : '显示字幕'}>
          <IconButton
            onClick={onToggleSubtitleVisible}
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              color: 'white',
              backgroundColor: 'rgba(0,0,0,0.5)',
              '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
              zIndex: 3,
            }}
          >
            {subtitleVisible ? (
              <VisibilityIcon />
            ) : (
              <VisibilityOffIcon />
            )}
          </IconButton>
        </Tooltip>

        {errorMsg && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 3,
              backgroundColor: 'rgba(0,0,0,0.88)',
              color: 'white',
              textAlign: 'left',
              overflow: 'auto',
              zIndex: 2,
            }}
          >
            <Box sx={{ maxWidth: 720 }}>
              <Typography variant="h6" gutterBottom color="error.main">
                ⚠️ 无法播放此{isAudio ? '音频' : '视频'}
              </Typography>
              <Typography
                variant="body2"
                sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}
              >
                {errorMsg}
              </Typography>
            </Box>
          </Box>
        )}

        {showNoSubtitleHint && !isAudio && (
          <Box
            sx={{
              position: 'absolute',
              top: 50,
              left: 8,
              right: 56,
              padding: '8px 12px',
              backgroundColor: 'rgba(0,0,0,0.6)',
              color: 'white',
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              fontSize: '0.85rem',
              zIndex: 1,
            }}
          >
            <SubtitleOffIcon fontSize="small" />
            <span>
              视频已加载,但尚未挂载字幕。请在上方「字幕文件」处选择 .srt 或 .vtt 文件。
            </span>
          </Box>
        )}

        {showNoSubtitleHint && isAudio && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              right: 56,
              padding: '6px 10px',
              backgroundColor: 'rgba(0,0,0,0.55)',
              color: 'white',
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              fontSize: '0.8rem',
              zIndex: 1,
            }}
          >
            <MusicNoteIcon fontSize="small" />
            <span>加载字幕以同步显示对应文本。</span>
          </Box>
        )}

        {/* Subtitle overlay (1 or 2 lines) — only meaningful for video. For
            audio we place the active cue text directly in the hero area via
            SubtitleOverlayAudio below. */}
        {subtitleVisible && visibleTracks.length > 0 && !isAudio && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 48,
              left: '50%',
              transform: 'translateX(-50%)',
              maxWidth: '90%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1,
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            {visibleTracks.map((t, idx) => {
              const cue = findCueAtTime(t.cues, currentTime);
              if (!cue) return null;
              const isEnglish = t.lang === 'en';
              const isFirst = idx === 0;
              return (
                <Box
                  key={t.id}
                  data-testid={
                    isEnglish && isFirst ? 'current-subtitle' : undefined
                  }
                  sx={{
                    padding: '6px 14px',
                    backgroundColor: 'rgba(0,0,0,0.72)',
                    color: isEnglish
                      ? 'white'
                      : t.lang === 'zh'
                        ? '#ffd54f'
                        : 'rgba(255,255,255,0.85)',
                    borderRadius: 1,
                    textAlign: 'center',
                    fontSize: '1.1rem',
                    lineHeight: 1.4,
                    maxWidth: '100%',
                  }}
                >
                  {filterCueText(cue.text, displayMode)}
                </Box>
              );
            })}
          </Box>
        )}

        {/* Audio-only cue display: large center text, one or two lines. */}
        {subtitleVisible && visibleTracks.length > 0 && isAudio && (
          <Box
            sx={{
              width: '100%',
              maxWidth: 720,
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              px: 2,
              pointerEvents: 'none',
            }}
          >
            {visibleTracks.map((t, idx) => {
              const cue = findCueAtTime(t.cues, currentTime);
              if (!cue) return null;
              const isEnglish = t.lang === 'en';
              const isFirst = idx === 0;
              return (
                <Typography
                  key={t.id}
                  data-testid={
                    isEnglish && isFirst ? 'current-subtitle' : undefined
                  }
                  variant={isFirst ? 'h5' : 'body1'}
                  sx={{
                    color: isEnglish
                      ? 'white'
                      : t.lang === 'zh'
                        ? '#ffd54f'
                        : 'rgba(255,255,255,0.85)',
                    lineHeight: 1.5,
                    fontWeight: isFirst ? 600 : 400,
                    textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                  }}
                >
                  {filterCueText(cue.text, displayMode)}
                </Typography>
              );
            })}
          </Box>
        )}

        {subtitleVisible && !isAudio && (
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              padding: '2px 8px',
              backgroundColor: 'rgba(0,0,0,0.5)',
              color: 'rgba(255,255,255,0.7)',
              borderRadius: 1,
              fontSize: '0.75rem',
              fontFamily: 'monospace',
              zIndex: 1,
            }}
          >
            {formatTime(currentTime)}
          </Box>
        )}
      </Box>

      {/* Subtitle display mode + playback controls — below the stage. */}
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{
          p: 0.75,
          px: 1.5,
          mt: 0.75,
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderRadius: 1,
          flexWrap: 'wrap',
        }}
      >
        <Tooltip title="字幕显示模式:控制视频画面上的字幕浮层和右侧字幕列表(仅英/仅中需加载对应语言的字幕)">
          <ToggleButtonGroup
            size="small"
            value={displayMode}
            exclusive
            onChange={(_, v: SubtitleDisplayMode | null) => {
              if (v) onDisplayModeChange(v);
            }}
            aria-label="字幕显示模式"
          >
          <ToggleButton value="none">全关</ToggleButton>
          <ToggleButton value="en" disabled={!tracks.some(canEn)}>
            仅英
          </ToggleButton>
          <ToggleButton value="zh" disabled={!tracks.some(canZh)}>
            仅中
          </ToggleButton>
          <ToggleButton value="both">
            双语
          </ToggleButton>
          </ToggleButtonGroup>
        </Tooltip>

        {/* Playback speed — single most-used audio-learning control. */}
        <Tooltip title="变速播放 (语言学习核心功能)">
          <Stack direction="row" spacing={0.5} alignItems="center">
            <SpeedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            <ToggleButtonGroup
              size="small"
              exclusive
              value={playbackRate}
              onChange={(_, v: number | null) => {
                if (v) onPlaybackRateChange(v);
              }}
              aria-label="播放速度"
              disabled={!source}
            >
              {PLAYBACK_RATES.map((r) => (
                <ToggleButton key={r.value} value={r.value}>
                  {r.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
        </Tooltip>

        {/* Volume slider — visible even though native controls exist, so users
            can fix autoplay-policy mute without hunting through the scrubber. */}
        <Tooltip title="音量">
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 160 }}>
            <Tooltip title={isMuted ? '取消静音' : '静音'}>
              <IconButton
                size="small"
                onClick={() => {
                  // Toggling out of mute also restores the user's last volume.
                  if (isMuted) {
                    setVolume(lastHeardVolumeRef.current || 1);
                  }
                  setIsMuted((v) => !v);
                }}
                color={isMuted ? 'warning' : 'default'}
                data-testid="mute-toggle"
              >
                <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                  <VolumeUpIcon
                    sx={{ opacity: isMuted ? 0.4 : 1 }}
                  />
                  {isMuted && (
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.1rem',
                        fontWeight: 700,
                        color: 'warning.main',
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </Box>
                  )}
                </Box>
              </IconButton>
            </Tooltip>
            <Slider
              size="small"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(_, v) => {
                const next = Array.isArray(v) ? v[0]! : v;
                if (next > 0) {
                  lastHeardVolumeRef.current = next;
                  setIsMuted(false);
                }
                setVolume(next);
              }}
              aria-label="音量"
              sx={{ width: 100 }}
              disabled={!source}
            />
          </Stack>
        </Tooltip>
      </Stack>
    </Box>
  );
}
