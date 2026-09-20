/**
 * Guided learning UI: the top stepper bar plus one right-column panel per
 * stage (盲听 / 听写·订正 / 跟读 / 收词). App owns the stage state and
 * renders the matching panel in place of the subtitle list.
 */
import { useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  List,
  ListItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CloseIcon from '@mui/icons-material/Close';
import type { StudySegment, StudyStage, SubtitleCue, SubtitleDisplayMode } from '../types';
import type { WrongWordRecord } from '../hooks/useStudyProgress';
import { diffDictation, filterCueText } from '../utils/textDiff';
import type { DiffResult } from '../utils/textDiff';
import { scorePronunciation } from '../utils/pronunciationScore';
import type { PronunciationResult } from '../utils/pronunciationScore';
import { createRecognizer } from '../utils/speechRecognition';
import type { Recognizer } from '../utils/speechRecognition';

const STAGES: { key: StudyStage; label: string; hint: string }[] = [
  { key: 'locate', label: '1 定位', hint: '在右侧字幕列表用每行的「起」「终」选择要学习的片段' },
  { key: 'blind', label: '2 盲听', hint: '字幕已隐藏。开了「循环 A-B」就循环播放，否则播到结尾自动停' },
  { key: 'dictation', label: '3 听写', hint: '右侧逐句听写：每句一个输入框，提交后逐句订正（可开关字幕）' },
  { key: 'verify', label: '4 回听', hint: '订正后逐句回听：播放原声，对照自己的听写，确认每句都听清了' },
  { key: 'shadow', label: '5 跟读', hint: '右侧逐句跟读：播放原声 → 录音 → 回放对比 + 朗读打分（可开关字幕）' },
  { key: 'collect', label: '6 收词', hint: '右侧把之前写错的词手动收入词库（再点一次取消），完成后标记已学' },
];

/** Shared subtitle on/off toggle used by dictation & shadow panels.
 *  Controls whether the subtitle text is displayed inside the panel rows. */
function SubtitleToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <Tooltip
      title={visible ? '隐藏字幕文本（只听/只读）' : '显示字幕文本'}
    >
      <Chip
        size="small"
        label={visible ? '字幕:开' : '字幕:关'}
        color={visible ? 'default' : 'primary'}
        variant="outlined"
        onClick={onToggle}
      />
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Stepper bar (top, under the app bar)
// ---------------------------------------------------------------------------

interface GuidedLearningBarProps {
  stage: StudyStage;
  onStageChange: (s: StudyStage) => void;
  onExit: () => void;
  onStartBlind: () => void;
  segment: StudySegment | null;
  segmentCount: number;
}

export function GuidedLearningBar({
  stage,
  onStageChange,
  onExit,
  onStartBlind,
  segment,
  segmentCount,
}: GuidedLearningBarProps): JSX.Element {
  const stageIndex = STAGES.findIndex((s) => s.key === stage);
  const hint = STAGES[stageIndex]?.hint ?? '';
  return (
    <Paper
      elevation={4}
      sx={{
        mx: 1.5,
        mt: 1,
        p: 1,
        px: 1.5,
        borderRadius: 1,
        backgroundColor: 'rgba(103, 58, 183, 0.10)',
        border: '1px solid rgba(103, 58, 183, 0.35)',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {STAGES.map((s, idx) => (
          <Chip
            key={s.key}
            size="small"
            label={s.label}
            color={idx === stageIndex ? 'primary' : 'default'}
            variant={idx === stageIndex ? 'filled' : 'outlined'}
            onClick={idx < stageIndex ? () => onStageChange(s.key) : undefined}
            sx={{ cursor: idx < stageIndex ? 'pointer' : 'default' }}
          />
        ))}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          {hint}
          {stage === 'locate' &&
            (segment
              ? `（已选:第 ${segment.startIndex}~${segment.endIndex} 句,共 ${segmentCount} 条）`
              : '（未选择）')}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {stage === 'locate' && (
          <Button
            size="small"
            variant="contained"
            disabled={!segment}
            onClick={onStartBlind}
          >
            下一步：开始盲听 →
          </Button>
        )}
        <Tooltip title="退出引导学习(不标记已学)">
          <Button size="small" startIcon={<CloseIcon />} onClick={onExit}>
            退出
          </Button>
        </Tooltip>
      </Stack>
    </Paper>
  );
}

/** Shared panel chrome so stage panels visually replace the subtitle list. */
function PanelShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Paper
      elevation={2}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ p: 1.5, borderBottom: '1px solid rgba(255,255,255,0.1)' }}
      >
        <Typography variant="subtitle1">{title}</Typography>
        <Box sx={{ flexGrow: 1 }} />
        {actions}
      </Stack>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5 }}>{children}</Box>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// 盲听
// ---------------------------------------------------------------------------

export function BlindPanel({
  playCount,
  loopEnabled,
  onReplay,
  onDone,
}: {
  playCount: number;
  loopEnabled: boolean;
  onReplay: () => void;
  onDone: () => void;
}): JSX.Element {
  return (
    <PanelShell title="🎧 盲听">
      <Stack spacing={1.5}>
        <Typography variant="body2">
          第 {playCount + 1} 遍 · 字幕已隐藏。
          {loopEnabled
            ? '片段循环播放中。'
            : '播放到结尾会自动停止(打开下方「循环 A-B」开关可循环)。'}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" onClick={onReplay}>
            🔁 再听一遍
          </Button>
          <Button size="small" variant="contained" onClick={onDone}>
            听懂了，进入听写 →
          </Button>
        </Stack>
      </Stack>
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// 听写(逐句) + 订正:每句一个输入框,提交后该句下方显示红/绿差异
// ---------------------------------------------------------------------------

/** Shared correction view: what the user typed, diff-colored against the
 *  original (green = correct, red strikethrough/wavy = wrong, with the
 *  correct form on hover). Used by both 听写订正 and 回听验证. */
function CorrectionView({ result }: { result: DiffResult }): JSX.Element {
  return (
    <Box sx={{ mt: 0.5 }}>
      {result.wrongWords.length === 0 && result.extraTyped.length === 0 ? (
        <Typography variant="caption" sx={{ color: '#66bb6a' }}>
          ✓ 本句全对
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ lineHeight: 1.8 }}>
          {result.tokens.map((t, idx) =>
            t.status === 'ok' ? (
              <span key={idx} style={{ color: '#66bb6a' }}>
                {t.text}{' '}
              </span>
            ) : (
              <Tooltip key={idx} title={`正确写法:${t.text}`}>
                <span
                  style={{
                    color: '#ef5350',
                    fontWeight: 600,
                    textDecoration: t.typed
                      ? 'line-through'
                      : 'underline wavy',
                    cursor: 'help',
                  }}
                >
                  {t.typed ?? `(${t.text})`}{' '}
                </span>
              </Tooltip>
            ),
          )}
          {result.extraTyped.length > 0 && (
            <Typography
              component="span"
              variant="caption"
              sx={{
                fontStyle: 'italic',
                color: 'text.secondary',
                ml: 0.5,
              }}
            >
              (多写:{result.extraTyped.join(' / ')})
            </Typography>
          )}
        </Typography>
      )}
    </Box>
  );
}

export function DictationPanel({
  cues,
  typed,
  results,
  onChangeCue,
  onReplayCue,
  onSubmitAll,
  onRetry,
  onNext,
  subtitleVisible,
  onToggleSubtitle,
  displayMode = 'both',
}: {
  cues: SubtitleCue[];
  /** cueIndex -> typed text */
  typed: Record<number, string>;
  /** cueIndex -> diff result (present after submission) */
  results: Record<number, DiffResult> | null;
  onChangeCue: (cueIndex: number, value: string) => void;
  onReplayCue: (cue: SubtitleCue) => void;
  onSubmitAll: () => void;
  onRetry: () => void;
  onNext: () => void;
  subtitleVisible: boolean;
  onToggleSubtitle: () => void;
  displayMode?: SubtitleDisplayMode;
}): JSX.Element {
  const submitted = results !== null;
  const allFilled = cues.every((c) => (typed[c.index] ?? '').trim() !== '');
  return (
    <PanelShell
      title="✍️ 听写(逐句)"
      actions={<SubtitleToggle visible={subtitleVisible} onToggle={onToggleSubtitle} />}
    >
      <Stack spacing={1}>
        <List dense disablePadding>
          {cues.map((cue) => {
            const result = results?.[cue.index];
            return (
              <ListItem
                key={cue.index}
                sx={{
                  display: 'block',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  py: 1,
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    第 {cue.index} 句
                  </Typography>
                  {subtitleVisible && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                      {filterCueText(cue.text, displayMode)}
                    </Typography>
                  )}
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<PlayArrowIcon />}
                    onClick={() => onReplayCue(cue)}
                    sx={{ minWidth: 0, px: 0.5 }}
                  >
                    重听这句
                  </Button>
                </Stack>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="输入你听到的这句英文…"
                  value={typed[cue.index] ?? ''}
                  onChange={(e) => onChangeCue(cue.index, e.target.value)}
                  disabled={submitted}
                  error={submitted ? (result?.wrongWords.length ?? 0) > 0 : false}
                />
                {result && <CorrectionView result={result} />}
              </ListItem>
            );
          })}
        </List>
        <Stack direction="row" spacing={1}>
          {submitted ? (
            <>
              <Button size="small" variant="outlined" onClick={onRetry}>
                重新听写
              </Button>
              <Button size="small" variant="contained" onClick={onNext}>
                下一步：回听验证 →
              </Button>
            </>
          ) : (
            <Button
              size="small"
              variant="contained"
              disabled={!allFilled}
              onClick={onSubmitAll}
            >
              提交订正 →
            </Button>
          )}
        </Stack>
      </Stack>
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// 回听验证(逐句):订正后逐句重听原声,对照自己的听写确认
// ---------------------------------------------------------------------------

export function VerifyPanel({
  cues,
  typed,
  results,
  onReplayCue,
  onRetry,
  onNext,
  subtitleVisible,
  onToggleSubtitle,
  displayMode = 'both',
}: {
  cues: SubtitleCue[];
  /** cueIndex -> what the user typed during dictation */
  typed: Record<number, string>;
  /** cueIndex -> diff result (present after dictation submission) */
  results: Record<number, DiffResult> | null;
  onReplayCue: (cue: SubtitleCue) => void;
  onRetry: () => void;
  onNext: () => void;
  subtitleVisible: boolean;
  onToggleSubtitle: () => void;
  displayMode?: SubtitleDisplayMode;
}): JSX.Element {
  const [confirmed, setConfirmed] = useState<Record<number, boolean>>({});
  const confirmedCount = cues.filter((c) => confirmed[c.index]).length;
  const allConfirmed = cues.length > 0 && confirmedCount === cues.length;
  const toggle = (cueIndex: number): void =>
    setConfirmed((prev) => ({ ...prev, [cueIndex]: !prev[cueIndex] }));
  return (
    <PanelShell
      title="👂 回听验证"
      actions={<SubtitleToggle visible={subtitleVisible} onToggle={onToggleSubtitle} />}
    >
      <Stack spacing={1}>
        <Typography variant="caption" color="text.secondary">
          逐句回听原声，对照自己的听写。都听清了就打 ✓，有疑问可以回去重新听写。
        </Typography>
        <List dense disablePadding>
          {cues.map((cue) => {
            const result = results?.[cue.index];
            const ok = !!confirmed[cue.index];
            return (
              <ListItem
                key={cue.index}
                sx={{
                  display: 'block',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  py: 1,
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    第 {cue.index} 句
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<PlayArrowIcon />}
                    onClick={() => onReplayCue(cue)}
                    sx={{ minWidth: 0, px: 0.5 }}
                  >
                    重听这句
                  </Button>
                  <Button
                    size="small"
                    variant={ok ? 'contained' : 'outlined'}
                    color={ok ? 'success' : 'inherit'}
                    data-testid={`verify-confirm-${cue.index}`}
                    onClick={() => toggle(cue.index)}
                  >
                    {ok ? '✓ 已确认' : '听清了，确认'}
                  </Button>
                </Stack>
                <Typography variant="body2" sx={{ mb: result ? 0 : 0.5 }}>
                  你的听写:{typed[cue.index]?.trim() || '(空)'}
                </Typography>
                {result && <CorrectionView result={result} />}
              </ListItem>
            );
          })}
        </List>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color="text.secondary">
            已确认 {confirmedCount}/{cues.length}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Button size="small" variant="outlined" onClick={onRetry}>
            重新听写
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!allConfirmed}
            onClick={onNext}
          >
            下一步：跟读 →
          </Button>
        </Stack>
      </Stack>
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// 跟读(逐句)
// ---------------------------------------------------------------------------

type ShadowFeedback =
  | { kind: 'unsupported' }
  | { kind: 'no-speech' }
  | { kind: 'error'; message: string }
  | { kind: 'score'; result: PronunciationResult };

function ShadowFeedbackView({ feedback }: { feedback: ShadowFeedback }): JSX.Element {
  if (feedback.kind === 'unsupported') {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
        当前浏览器不支持语音识别打分（需 Chrome / Edge，且需联网）；录音回放不受影响。
      </Typography>
    );
  }
  if (feedback.kind === 'no-speech') {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
        没有识别到朗读内容，再试一次吧。
      </Typography>
    );
  }
  if (feedback.kind === 'error') {
    return (
      <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
        打分失败:{feedback.message}
      </Typography>
    );
  }
  const { result } = feedback;
  const tokenColor = (status: 'ok' | 'wrong' | 'missed'): string =>
    status === 'ok' ? 'success.main' : status === 'wrong' ? 'error.main' : 'text.disabled';
  return (
    <Box sx={{ mt: 0.75 }}>
      <Typography
        variant="caption"
        sx={{ color: result.score >= 80 ? 'success.main' : result.score >= 50 ? 'warning.main' : 'error.main' }}
        data-testid="shadow-score"
      >
        朗读得分 {result.score} 分
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', mt: 0.5 }}>
        {result.tokens.map((t, idx) => (
          <Typography
            key={idx}
            variant="body2"
            data-testid={`shadow-word-${t.status}`}
            sx={{
              color: tokenColor(t.status),
              textDecoration: t.status === 'missed' ? 'line-through' : 'none',
            }}
          >
            {t.text}
            {t.status === 'wrong' && t.heard ? `（读到:${t.heard}）` : ''}
          </Typography>
        ))}
        {result.extraSpoken.map((w, idx) => (
          <Typography key={`x${idx}`} variant="body2" sx={{ color: 'warning.main' }}>
            ＋{w}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

function ShadowCueRow({
  cue,
  showText,
  displayMode = 'both',
}: {
  cue: SubtitleCue;
  showText: boolean;
  displayMode?: SubtitleDisplayMode;
}): JSX.Element {
  const [recording, setRecording] = useState<boolean>(false);
  const [recordUrl, setRecordUrl] = useState<string | null>(null);
  const [micError, setMicError] = useState<string>('');
  const [scoring, setScoring] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<ShadowFeedback | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const heardRef = useRef<string>('');
  const srErrorRef = useRef<string>('');

  // The scoring target is always the English part of the line.
  const targetText = filterCueText(cue.text, 'en');

  const finalizeScore = (): void => {
    setScoring(false);
    const heard = heardRef.current.trim();
    if (!heard) {
      if (srErrorRef.current === 'not-allowed' || srErrorRef.current === 'service-not-allowed') {
        setFeedback({ kind: 'error', message: '麦克风权限被拒绝' });
      } else if (srErrorRef.current === 'network' || srErrorRef.current === 'language-not-supported') {
        setFeedback({ kind: 'unsupported' });
      } else {
        setFeedback({ kind: 'no-speech' });
      }
      return;
    }
    setFeedback({ kind: 'score', result: scorePronunciation(targetText, heard) });
  };

  const stop = (): void => {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
    // Stop recognition too; its onDone callback computes the score once the
    // engine flushes the pending final transcript (bounded by a 3s fallback).
    const hadRecognizer = recognizerRef.current !== null;
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    if (hadRecognizer) setScoring(true);
  };

  const start = async (): Promise<void> => {
    setMicError('');
    setFeedback(null);
    setScoring(false);
    heardRef.current = '';
    srErrorRef.current = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e): void => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = (): void => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (recordUrl) URL.revokeObjectURL(recordUrl);
        setRecordUrl(URL.createObjectURL(blob));
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      // Run live recognition in parallel with the recording. It uses its own
      // mic access; both only read the microphone.
      recognizerRef.current = createRecognizer({
        lang: 'en-US',
        onFinal: (transcript) => {
          heardRef.current += ` ${transcript}`;
        },
        onError: (err) => {
          srErrorRef.current = err;
        },
        onDone: finalizeScore,
      });
      if (!recognizerRef.current) {
        // Recording still works; scoring is just unavailable.
        setFeedback({ kind: 'unsupported' });
      }
    } catch (err) {
      setMicError(`麦克风不可用:${(err as Error).message}`);
    }
  };

  return (
    <ListItem
      sx={{
        display: 'block',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        py: 1,
      }}
    >
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {showText ? filterCueText(cue.text, displayMode) : `第 ${cue.index} 句`}
      </Typography>
      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          variant="text"
          startIcon={<PlayArrowIcon />}
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('study-play-cue', { detail: cue }),
            );
          }}
        >
          原声
        </Button>
        {recording ? (
          <Button size="small" color="error" startIcon={<StopIcon />} onClick={stop}>
            停止
          </Button>
        ) : (
          <Button size="small" startIcon={<MicIcon />} onClick={() => void start()}>
            录音
          </Button>
        )}
        {recordUrl && (
          <Button
            size="small"
            startIcon={<PlayArrowIcon />}
            onClick={() => {
              const audio = new Audio(recordUrl);
              void audio.play();
            }}
          >
            我的录音
          </Button>
        )}
        {micError && (
          <Typography variant="caption" color="error">
            {micError}
          </Typography>
        )}
      </Stack>
      {scoring && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          正在识别朗读内容…
        </Typography>
      )}
      {feedback && <ShadowFeedbackView feedback={feedback} />}
    </ListItem>
  );
}

export function ShadowPanel({
  cues,
  onNext,
  subtitleVisible,
  onToggleSubtitle,
  displayMode = 'both',
}: {
  cues: SubtitleCue[];
  onNext: () => void;
  subtitleVisible: boolean;
  onToggleSubtitle: () => void;
  displayMode?: SubtitleDisplayMode;
}): JSX.Element {
  return (
    <PanelShell
      title="🗣️ 跟读(逐句)"
      actions={<SubtitleToggle visible={subtitleVisible} onToggle={onToggleSubtitle} />}
    >
      <Stack spacing={1}>
        <List dense disablePadding>
          {cues.map((cue) => (
            <ShadowCueRow
              key={cue.index}
              cue={cue}
              showText={subtitleVisible}
              displayMode={displayMode}
            />
          ))}
        </List>
        <Button size="small" variant="contained" onClick={onNext} sx={{ mt: 1 }}>
          下一步：收词 →
        </Button>
      </Stack>
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// 收词(点击收藏,再点一次取消)
// ---------------------------------------------------------------------------

export function CollectPanel({
  wrongWords,
  vocabHas,
  onToggleCollect,
  onFinish,
}: {
  wrongWords: WrongWordRecord[];
  vocabHas: (word: string) => boolean;
  onToggleCollect: (word: string, sentence: string) => void;
  onFinish: () => void;
}): JSX.Element {
  return (
    <PanelShell title="📖 收词">
      <Stack spacing={1}>
        <Typography variant="body2">
          之前写错/漏写的词：点击收入词库，再点一次取消收藏。
        </Typography>
        {wrongWords.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            本视频还没有错词记录 —— 太棒了！直接完成本段学习吧。
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {wrongWords.map((w) => (
              <Chip
                key={`${w.word}-${w.video}`}
                label={
                  vocabHas(w.word)
                    ? `✓ ${w.word}`
                    : `${w.word} ×${w.count}`
                }
                color={vocabHas(w.word) ? 'success' : 'default'}
                onClick={() => onToggleCollect(w.word, w.sentence)}
                sx={{ cursor: 'pointer' }}
              />
            ))}
          </Stack>
        )}
        <Box>
          <Button size="small" variant="contained" color="success" onClick={onFinish}>
            ✅ 完成本段学习（标记已学）
          </Button>
        </Box>
      </Stack>
    </PanelShell>
  );
}
