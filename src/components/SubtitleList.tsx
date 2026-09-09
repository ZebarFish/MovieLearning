/**
 * SubtitleList
 *
 * Scrollable list of all cues. The currently active cue is highlighted. Click
 * on a cue to seek the video to its start time. Click any English word inside
 * the cue to open a detail card (phonetic, definition, example, TTS, collect).
 *
 * Words are split on whitespace and rendered as <span> elements. We keep
 * punctuation attached to the previous word to preserve sentence flow visually.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Box, Button, Chip, List, ListItemButton, Paper, Stack, Typography } from '@mui/material';
import type { StudySegment, SubtitleCue, SubtitleDisplayMode, SubtitleLang, VocabWord } from '../types';
import { findCueAtTime, formatTime } from '../utils/subtitleParser';
import { filterCueText } from '../utils/textDiff';

interface SubtitleListProps {
  cues: SubtitleCue[];
  trackLang: SubtitleLang;
  currentTime: number;
  videoName: string;
  vocab: VocabWord[];
  onSeek: (time: number) => void;
  onSelectWord: (word: string, sentence: string, lang: SubtitleLang) => void;
  /** Cue indexes already studied at least once (persisted). */
  learnedSet?: Set<number>;
  /** Current guided-study segment (rows in range are outlined). */
  segment?: StudySegment | null;
  /** Provided during guided locate stage: pick segment start/end rows. */
  onPickSegment?: (cueIndex: number, boundary: 'start' | 'end') => void;
  /** 字幕显示模式:仅英/仅中会拆分双语字幕行的中英文部分。 */
  displayMode?: SubtitleDisplayMode;
}

const WORD_REGEX = /([A-Za-z][A-Za-z']*)/g;

function renderSubtitleWithClickableWords(
  text: string,
  vocabKeys: Set<string>,
  onSelectWord: (word: string, sentence: string, lang: SubtitleLang) => void,
  sentence: string,
  lang: SubtitleLang,
): JSX.Element[] {
  const parts: JSX.Element[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  // Reset regex state for each call.
  WORD_REGEX.lastIndex = 0;
  while ((match = WORD_REGEX.exec(text)) !== null) {
    const word = match[1];
    const start = match.index;
    const end = start + word.length;

    if (start > lastIndex) {
      parts.push(
        <span key={`text-${keyCounter++}`}>{text.slice(lastIndex, start)}</span>,
      );
    }

    const lower = word.toLowerCase();
    const isCollected = vocabKeys.has(lower);

    parts.push(
      <span
        key={`word-${keyCounter++}`}
        className={`subtitle-word${isCollected ? ' collected' : ''}`}
        title={isCollected ? `${word} (已收藏，点击查看详情)` : `点击查看: ${word}`}
        onClick={(e) => {
          e.stopPropagation();
          onSelectWord(word, sentence, lang);
        }}
      >
        {word}
      </span>,
    );
    lastIndex = end;
  }
  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-${keyCounter++}`}>{text.slice(lastIndex)}</span>,
    );
  }
  return parts;
}

export function SubtitleList({
  cues,
  trackLang,
  currentTime,
  videoName,
  vocab,
  onSeek,
  onSelectWord,
  learnedSet,
  segment,
  onPickSegment,
  displayMode = 'both',
}: SubtitleListProps): JSX.Element {
  const activeCue = useMemo(
    () => findCueAtTime(cues, currentTime),
    [cues, currentTime],
  );

  const vocabKeys = useMemo(
    () => new Set(vocab.map((v) => v.word)),
    [vocab],
  );

  // Auto-scroll the active cue into view as playback advances.
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeItemRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!activeItemRef.current || !listRef.current) {
      return;
    }
    activeItemRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'center',
    });
  }, [activeCue?.index]);

  if (cues.length === 0) {
    return (
      <Paper elevation={2} sx={{ p: 2, height: '100%' }}>
        <Typography variant="subtitle1" gutterBottom>
          字幕列表
        </Typography>
        <Typography variant="body2" color="text.secondary">
          还没有字幕。加载 .srt / .vtt 文件后会在这里显示。
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper elevation={2} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <Typography variant="subtitle1">
          字幕列表（{cues.length} 条）
        </Typography>
        <Typography variant="caption" color="text.secondary">
          点击行跳转时间，点击单词查看音标/释义/朗读
        </Typography>
      </Box>
      <Box ref={listRef} sx={{ flex: 1, overflowY: 'auto' }}>
        <List dense>
          {cues.map((cue) => {
            const isActive = activeCue?.index === cue.index;
            const isLearned = learnedSet?.has(cue.index) ?? false;
            const inSegment =
              segment != null &&
              cue.index >= segment.startIndex &&
              cue.index <= segment.endIndex;
            return (
              <ListItemButton
                key={cue.index}
                ref={isActive ? activeItemRef : undefined}
                onClick={() => onSeek(cue.start)}
                sx={{
                  backgroundColor: isActive
                    ? 'rgba(33, 150, 243, 0.2)'
                    : inSegment
                      ? 'rgba(103, 58, 183, 0.12)'
                      : 'transparent',
                  borderLeft: isActive
                    ? '4px solid #2196f3'
                    : inSegment
                      ? '4px solid #7e57c2'
                      : '4px solid transparent',
                  alignItems: 'flex-start',
                  py: 1,
                }}
              >
                <Box sx={{ width: '100%' }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'text.secondary',
                        fontFamily: 'monospace',
                      }}
                    >
                      {formatTime(cue.start)} → {formatTime(cue.end)}
                    </Typography>
                    {isLearned && (
                      <Chip
                        label="✓ 已学"
                        size="small"
                        color="success"
                        variant="outlined"
                        sx={{ height: 18, fontSize: '0.65rem' }}
                      />
                    )}
                    {onPickSegment && (
                      <Box sx={{ ml: 'auto' }} onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="small"
                          variant={
                            segment?.startIndex === cue.index
                              ? 'contained'
                              : 'text'
                          }
                          sx={{ minWidth: 0, px: 0.75, py: 0, fontSize: '0.7rem' }}
                          onClick={() => onPickSegment(cue.index, 'start')}
                        >
                          起
                        </Button>
                        <Button
                          size="small"
                          variant={
                            segment?.endIndex === cue.index ? 'contained' : 'text'
                          }
                          sx={{ minWidth: 0, px: 0.75, py: 0, fontSize: '0.7rem' }}
                          onClick={() => onPickSegment(cue.index, 'end')}
                        >
                          终
                        </Button>
                      </Box>
                    )}
                  </Stack>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}
                  >
                    {renderSubtitleWithClickableWords(
                      filterCueText(cue.text, displayMode),
                      vocabKeys,
                      onSelectWord,
                      cue.text,
                      trackLang,
                    )}
                  </Typography>
                </Box>
              </ListItemButton>
            );
          })}
        </List>
      </Box>
      <Box sx={{ p: 1, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <Typography variant="caption" color="text.secondary">
          当前视频：{videoName || '（未选择）'}
        </Typography>
      </Box>
    </Paper>
  );
}