/**
 * App.tsx — top-level orchestrator.
 *
 * One-screen layout: the video player + subtitle list always fit the
 * viewport. Secondary content (learning steps, media/subtitle pickers) lives
 * in slide-in drawers so the main stage is visible immediately.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppBar,
  Badge,
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import CloseIcon from '@mui/icons-material/Close';
import Tooltip from '@mui/material/Tooltip';
import { VideoSelector } from './components/VideoSelector';
import { VideoPlayer } from './components/VideoPlayer';
import { SubtitleList } from './components/SubtitleList';
import { ABLoopControls } from './components/ABLoopControls';
import { VocabularyPanel } from './components/VocabularyPanel';
import { LearningSteps } from './components/LearningSteps';
import { SubtitleDownloader } from './components/SubtitleDownloader';
import { SubtitleFileLoader } from './components/SubtitleFileLoader';
import { SubtitleOffsetControl } from './components/SubtitleOffsetControl';
import { CollapsiblePanel } from './components/CollapsiblePanel';
import { AutoSubtitleMatch } from './components/AutoSubtitleMatch';
import { shiftTracks } from './utils/subtitleOffset';
import { WordDetailCard } from './components/WordDetailCard';
import { MovieDiscover } from './components/MovieDiscover';
import { useVideoPlayer } from './hooks/useVideoPlayer';
import { useVocabulary } from './hooks/useVocabulary';
import { useStudyProgress } from './hooks/useStudyProgress';
import {
  BlindPanel,
  CollectPanel,
  DictationPanel,
  GuidedLearningBar,
  ShadowPanel,
} from './components/GuidedLearning';
import { diffDictation, extractWordSentence } from './utils/textDiff';
import type { DiffResult } from './utils/textDiff';
import type {
  ABLoopState,
  LearningStep,
  StudySegment,
  StudyStage,
  SubtitleDisplayMode,
  SubtitleLang,
  SubtitleTrack,
  VideoSource,
} from './types';
import { detectKind, MEDIA_FILE_INPUT_ATTR } from './utils/mediaFile';

const LEARNING_STEPS: LearningStep[] = [
  {
    key: 'locate',
    title: '定位',
    description:
      '找到目标片段,记录大致时间点。可以用 A-B 循环精细定位到句子。',
  },
  {
    key: 'blind-listen-1',
    title: '盲听 1',
    description: '不看字幕完整听一遍,尝试抓住大意与生词的发音。',
  },
  {
    key: 'blind-listen-2',
    title: '盲听 2',
    description: '再听一遍,验证或修正第一遍的猜测,标记没听懂的部分。',
  },
  {
    key: 'dictation',
    title: '听写',
    description:
      '逐句暂停,反复听并写下听到的内容。允许拼写错误,重点是节奏。',
  },
  {
    key: 'correction',
    title: '订正',
    description:
      '打开字幕对照订正,标注跟原文不一致的地方,理解连读与弱读。',
  },
  {
    key: 'shadow-1',
    title: '跟读 1',
    description: '暂停后跟读一遍,关注语调、连读、重音。',
  },
  {
    key: 'shadow-2',
    title: '跟读 2',
    description: '原速跟读一遍,目标是与原声几乎同步。',
  },
  {
    key: 'vocab',
    title: '收词',
    description:
      '从字幕中点击不熟或精彩的单词加入收藏,然后同步到 Anki 复习。',
  },
];

const INITIAL_LOOP: ABLoopState = {
  pointA: null,
  pointB: null,
  enabled: false,
};

type DrawerKind = 'media' | 'steps' | null;

/**
 * Top-level view switch. 'study' is the original learning stage; 'discover'
 * is the full-screen movie discovery view. All study state lives in this
 * component and is preserved across the switch — we only swap which block of
 * JSX is rendered, never unmount the study stage's state.
 */
type AppView = 'study' | 'discover';

export default function App(): JSX.Element {
  const [view, setView] = useState<AppView>('study');
  const [videoSource, setVideoSource] = useState<VideoSource | null>(null);
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  /** Global subtitle timeline offset (seconds) for A/V sync nudging. */
  const [subtitleOffset, setSubtitleOffset] = useState<number>(0);
  const [displayMode, setDisplayMode] = useState<SubtitleDisplayMode>('en');
  const [subtitleVisible, setSubtitleVisible] = useState<boolean>(true);
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [loop, setLoop] = useState<ABLoopState>(INITIAL_LOOP);
  const [vocabOpen, setVocabOpen] = useState<boolean>(false);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [selectedWord, setSelectedWord] = useState<{
    word: string;
    sentence: string;
    lang: SubtitleLang;
  } | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [guided, setGuided] = useState<boolean>(false);
  const [segment, setSegment] = useState<StudySegment | null>(null);
  const [studyStage, setStudyStage] = useState<StudyStage>('locate');
  const [blindPlays, setBlindPlays] = useState<number>(0);
  /** cueIndex -> 听写输入 */
  const [typedByIndex, setTypedByIndex] = useState<Record<number, string>>({});
  /** cueIndex -> 订正结果(提交后) */
  const [diffByIndex, setDiffByIndex] = useState<Record<
    number,
    DiffResult
  > | null>(null);

  const {
    videoRef,
    currentTime,
    seek,
    setPlaybackRate,
    playbackRate,
  } = useVideoPlayer();
  const { vocab, addWord, updateWord, removeWord, clearAll, hasWord } = useVocabulary();

  const videoName = videoSource?.name ?? '';
  const study = useStudyProgress(videoName);
  const currentStep = LEARNING_STEPS[Math.min(stepIndex, LEARNING_STEPS.length - 1)]!;

  // Playback-facing tracks carry the sync offset (originals stay untouched
  // so repeated nudges never accumulate error). Track management UI keeps
  // using the original `tracks`.
  const playbackTracks = useMemo(
    () => shiftTracks(tracks, subtitleOffset),
    [tracks, subtitleOffset],
  );

  // Pick the primary track for the subtitle list, respecting the display
  // mode toggle (仅中 → show the Chinese track in the list, etc.).
  const primaryTrack = useMemo<SubtitleTrack | null>(() => {
    if (playbackTracks.length === 0) return null;
    const en = playbackTracks.find((t) => t.lang === 'en');
    const zh = playbackTracks.find((t) => t.lang === 'zh');
    if (displayMode === 'zh' && zh) return zh;
    if (displayMode === 'en' && en) return en;
    return en ?? playbackTracks[0];
  }, [playbackTracks, displayMode]);

  // Chinese cues of the same episode — used to fill the Anki card's
  // 例句释义 field with the subtitle the user actually watched.
  const zhCues = useMemo(
    () => playbackTracks.find((t) => t.lang === 'zh')?.cues,
    [playbackTracks],
  );

  const handleAddTrack = useCallback((track: SubtitleTrack): void => {
    setTracks((prev) => {
      // Avoid duplicates by lang: replace existing same-lang track.
      const filtered = prev.filter((p) => p.lang !== track.lang);
      return [...filtered, track];
    });
  }, []);

  const handleAddTrackFromFile = useCallback((track: SubtitleTrack): void => {
    // Loading a subtitle file replaces ALL previous tracks — the user
    // expects a fresh load, not an accumulation of stale overlays.
    setTracks([track]);
  }, []);

  const handleRemoveTrack = useCallback((id: string): void => {
    setTracks((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleSelectWord = useCallback(
    (word: string, sentence: string, lang: SubtitleLang): void => {
      setSelectedWord({ word, sentence, lang });
    },
    [],
  );

  const handleAddToVocab = useCallback(
    (
      word: string,
      sentence: string,
      lang: SubtitleLang,
      definition?: string,
    ): void => {
      addWord({
        word,
        sentence,
        video: videoName,
        time: currentTime,
        lang,
        definition,
      });
    },
    [addWord, currentTime, videoName],
  );

  const isSelectedCollected = selectedWord
    ? hasWord(selectedWord.word)
    : false;

  // Convert tracks into a flat cues array for the subtitle list (currently
  // shows the primary track). Future: a Tab UI to switch.
  const flatCues = primaryTrack?.cues ?? [];


  // ---- Guided learning -----------------------------------------------------

  const segmentCues = useMemo<SubtitleTrack['cues']>(
    () =>
      segment
        ? flatCues.filter(
            (c) => c.index >= segment.startIndex && c.index <= segment.endIndex,
          )
        : [],
    [flatCues, segment],
  );

  const handlePickSegment = useCallback(
    (cueIndex: number, boundary: 'start' | 'end'): void => {
      const cue = flatCues.find((c) => c.index === cueIndex);
      if (!cue) return;
      setSegment((prev) => {
        let next: StudySegment;
        if (boundary === 'start') {
          const end =
            prev && prev.endIndex >= cueIndex ? prev.endIndex : cueIndex;
          const endCue = flatCues.find((c) => c.index === end) ?? cue;
          next = {
            startIndex: cueIndex,
            endIndex: end,
            startTime: cue.start,
            endTime: endCue.end,
          };
        } else {
          const start =
            prev && prev.startIndex <= cueIndex ? prev.startIndex : cueIndex;
          const startCue = flatCues.find((c) => c.index === start) ?? cue;
          next = {
            startIndex: start,
            endIndex: cueIndex,
            startTime: startCue.start,
            endTime: cue.end,
          };
        }
        // Sync the segment bounds into the A-B loop markers immediately.
        // Whether it loops depends on the 循环 A-B switch; with the switch
        // off, playback simply stops at B (see ABLoopControls).
        setLoop((prevLoop) => ({
          ...prevLoop,
          pointA: next.startTime,
          pointB: next.endTime,
        }));
        return next;
      });
    },
    [flatCues],
  );

  const handleStartBlind = useCallback((): void => {
    if (!segment) return;
    // Keep the user's 循环 A-B switch state: on → loop; off → stop at B.
    setLoop((prev) => ({
      pointA: segment.startTime,
      pointB: segment.endTime,
      enabled: prev.enabled,
    }));
    setSubtitleVisible(false);
    setBlindPlays(0);
    seek(segment.startTime);
    void videoRef.current?.play();
    setStudyStage('blind');
  }, [segment, seek, videoRef]);

  const handlePlaySegment = useCallback((): void => {
    if (segment) {
      seek(segment.startTime);
      void videoRef.current?.play();
      setBlindPlays((n) => n + 1);
    }
  }, [segment, seek, videoRef]);

  const handleExitGuided = useCallback((): void => {
    setGuided(false);
    setSegment(null);
    setStudyStage('locate');
    setTypedByIndex({});
    setDiffByIndex(null);
    setSubtitleVisible(true);
    setLoop((prev) => ({ ...prev, enabled: false }));
  }, []);

  const markLearnedCues = useCallback(
    (indexes: number[]): void => {
      study.markLearned(videoName, indexes);
    },
    [study, videoName],
  );

  const handleFinishGuided = useCallback((): void => {
    if (segment) {
      const idx: number[] = [];
      for (let i = segment.startIndex; i <= segment.endIndex; i++) idx.push(i);
      markLearnedCues(idx);
    }
    handleExitGuided();
  }, [segment, markLearnedCues, handleExitGuided]);

  const handleDictationSubmit = useCallback((): void => {
    const results: Record<number, DiffResult> = {};
    for (const cue of segmentCues) {
      const r = diffDictation(cue.text, typedByIndex[cue.index] ?? '');
      results[cue.index] = r;
      for (const t of r.tokens) {
        if (t.status === 'missing') {
          study.addWrongWord(
            t.text,
            extractWordSentence(cue.text, t.text),
            videoName,
          );
        }
      }
    }
    setDiffByIndex(results);
  }, [segmentCues, typedByIndex, study, videoName]);

  const handleDictationRetry = useCallback((): void => {
    setTypedByIndex({});
    setDiffByIndex(null);
  }, []);

  // 跟读面板的「原声」按钮：监听每行的播放事件，跳到该句开头播放。
  useEffect(() => {
    const handler = (e: Event): void => {
      const cue = (e as CustomEvent<{ start: number }>).detail;
      if (cue && typeof cue.start === 'number') {
        seek(cue.start);
        void videoRef.current?.play();
      }
    };
    window.addEventListener('study-play-cue', handler);
    return () => window.removeEventListener('study-play-cue', handler);
  }, [seek, videoRef]);

  const closeDrawer = (): void => setDrawer(null);

  // Main-stage CTA: open the native file picker directly (no drawer hop).
  const handleStageMediaFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      if (!file) return;
      const objectUrl = URL.createObjectURL(file);
      setVideoSource({
        src: objectUrl,
        name: file.name,
        isRemote: false,
        kind: detectKind(file),
      });
      event.target.value = '';
    },
    [],
  );

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Hidden media input — the main-stage CTA opens this directly. */}
      <input
        ref={mediaInputRef}
        type="file"
        accept={MEDIA_FILE_INPUT_ATTR}
        hidden
        onChange={handleStageMediaFile}
      />
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <Typography variant="h6" sx={{ mr: 1 }}>
            听美剧学英语
          </Typography>
          {view === 'study' && (
            <>
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={`步骤 ${Math.min(stepIndex + 1, LEARNING_STEPS.length)}/${LEARNING_STEPS.length} · ${currentStep.title}`}
                onClick={() => setDrawer('steps')}
                sx={{ cursor: 'pointer' }}
              />
              <Button
                size="small"
                onClick={() => setDrawer('steps')}
              >
                🎓 学习步骤
              </Button>
              <Button
                size="small"
                onClick={() => setDrawer('media')}
              >
                🎬 媒体与字幕
              </Button>
              <Tooltip title="按「定位→盲听→听写→订正→跟读→收词」六步引导学习">
                <Button
                  size="small"
                  variant={guided ? 'contained' : 'text'}
                  onClick={() => setGuided((v) => !v)}
                >
                  🎯 引导学习
                </Button>
              </Tooltip>
              <Box sx={{ flexGrow: 1 }} />
              {!videoSource && (
                <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                  尚未加载媒体 — 点「媒体与字幕」选择文件
                </Typography>
              )}
              <Badge badgeContent={vocab.length} color="secondary">
                <Button
                  size="small"
                  startIcon={<MenuBookIcon />}
                  onClick={() => setVocabOpen(true)}
                >
                  词库
                </Button>
              </Badge>
            </>
          )}
          {view === 'discover' && <Box sx={{ flexGrow: 1 }} />}
          <Button
            size="small"
            variant={view === 'discover' ? 'contained' : 'outlined'}
            onClick={() => setView((v) => (v === 'study' ? 'discover' : 'study'))}
            data-testid={view === 'study' ? 'nav-discover' : 'nav-study'}
          >
            {view === 'study' ? '🎬 发现片单' : '📺 返回学习台'}
          </Button>
        </Toolbar>
      </AppBar>

      {/* Guided learning stepper bar (six-step study flow). */}
      {guided && view === 'study' && (
        <GuidedLearningBar
          stage={studyStage}
          onStageChange={setStudyStage}
          onExit={handleExitGuided}
          onStartBlind={handleStartBlind}
          segment={segment}
          segmentCount={segmentCues.length}
        />
      )}

      {/* Main stage: video column + subtitle column, both fit one screen. */}
      {view === 'study' ? (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          gap: 2,
          p: 1.5,
        }}
      >
        <Box
          sx={{
            flex: '0 0 58%',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            minHeight: 0,
          }}
        >
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <VideoPlayer
              source={videoSource}
              videoRef={videoRef}
              tracks={playbackTracks}
              displayMode={displayMode}
              onDisplayModeChange={setDisplayMode}
              currentTime={currentTime}
              subtitleVisible={subtitleVisible}
              onToggleSubtitleVisible={() => setSubtitleVisible((v) => !v)}
              playbackRate={playbackRate}
              onPlaybackRateChange={setPlaybackRate}
              onPickLocalFile={() => mediaInputRef.current?.click()}
            />
          </Box>
          <ABLoopControls
            source={videoSource}
            videoRef={videoRef}
            currentTime={currentTime}
            loop={loop}
            onLoopChange={setLoop}
          />
        </Box>

        <Box
          sx={{
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <CollapsiblePanel
            title="字幕配置"
            hint="加载字幕 · 时间轴对时(点此展开)"
          >
            <SubtitleFileLoader onAddTrack={handleAddTrackFromFile} />
            <SubtitleOffsetControl
              offset={subtitleOffset}
              onChange={setSubtitleOffset}
            />
          </CollapsiblePanel>
          <Box sx={{ flex: 1, minHeight: 0 }}>
          {guided && studyStage === 'blind' ? (
            <BlindPanel
              playCount={blindPlays}
              loopEnabled={loop.enabled}
              onReplay={handlePlaySegment}
              onDone={() => setStudyStage('dictation')}
            />
          ) : guided && studyStage === 'dictation' ? (
            <DictationPanel
              cues={segmentCues}
              typed={typedByIndex}
              results={diffByIndex}
              onChangeCue={(cueIndex, value) =>
                setTypedByIndex((prev) => ({ ...prev, [cueIndex]: value }))
              }
              onReplayCue={(cue) => {
                seek(cue.start);
                void videoRef.current?.play();
              }}
              onSubmitAll={handleDictationSubmit}
              onRetry={handleDictationRetry}
              onNext={() => setStudyStage('shadow')}
              subtitleVisible={subtitleVisible}
              onToggleSubtitle={() => setSubtitleVisible((v) => !v)}
              displayMode={displayMode}
            />
          ) : guided && studyStage === 'shadow' ? (
            <ShadowPanel
              cues={segmentCues}
              onNext={() => setStudyStage('collect')}
              subtitleVisible={subtitleVisible}
              onToggleSubtitle={() => setSubtitleVisible((v) => !v)}
              displayMode={displayMode}
            />
          ) : guided && studyStage === 'collect' ? (
            <CollectPanel
              wrongWords={study.wrongWords.filter(
                (w) =>
                  w.video === videoName && /^[A-Za-z][A-Za-z'’-]*$/.test(w.word),
              )}
              vocabHas={hasWord}
              onToggleCollect={(word, sentence) => {
                if (hasWord(word)) {
                  removeWord(word);
                } else {
                  addWord({
                    word,
                    sentence: extractWordSentence(sentence, word),
                    video: videoName,
                    time: segment?.startTime ?? currentTime,
                    lang: 'en',
                  });
                }
              }}
              onFinish={handleFinishGuided}
            />
          ) : (
            <SubtitleList
              cues={flatCues}
              trackLang={primaryTrack?.lang ?? 'en'}
              currentTime={currentTime}
              videoName={videoName}
              vocab={vocab}
              onSeek={seek}
              onSelectWord={handleSelectWord}
              learnedSet={study.learnedSet}
              segment={segment}
              onPickSegment={guided ? handlePickSegment : undefined}
              displayMode={displayMode}
            />
          )}
          </Box>
        </Box>
      </Box>
      ) : (
        <MovieDiscover />
      )}

      {view === 'study' && (
      <>
      {/* Secondary drawer: media + subtitle pickers. */}
      <Drawer
        anchor="left"
        open={drawer === 'media'}
        onClose={closeDrawer}
        PaperProps={{
          sx: { width: { xs: '100vw', sm: 520 }, maxWidth: '100%' },
        }}
      >
        <Box
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            backgroundColor: 'background.paper',
            zIndex: 1,
          }}
        >
          <Typography variant="h6">媒体与字幕</Typography>
          <IconButton onClick={closeDrawer}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ p: 2, overflowY: 'auto' }}>
          <VideoSelector
            videoName={videoName}
            onVideoChange={(s) => {
              setVideoSource(s);
              if (s) closeDrawer();
            }}
          />
          <AutoSubtitleMatch
            videoFile={
              videoSource && !videoSource.isRemote
                ? videoSource.file ?? null
                : null
            }
            onAddTrack={handleAddTrack}
          />
          <SubtitleDownloader
            tracks={tracks}
            videoName={videoName}
            onAddTrack={handleAddTrack}
            onRemoveTrack={handleRemoveTrack}
          />
        </Box>
      </Drawer>

      {/* Secondary drawer: learning steps. */}
      <Drawer
        anchor="left"
        open={drawer === 'steps'}
        onClose={closeDrawer}
        PaperProps={{
          sx: { width: { xs: '100vw', sm: 480 }, maxWidth: '100%' },
        }}
      >
        <Box
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography variant="h6">学习步骤</Typography>
          <IconButton onClick={closeDrawer}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ p: 2, overflowY: 'auto' }}>
          <LearningSteps
            steps={LEARNING_STEPS}
            currentIndex={stepIndex}
            onChange={(idx) => setStepIndex(idx)}
          />
        </Box>
      </Drawer>

      {selectedWord && (
        <WordDetailCard
          word={selectedWord.word}
          sentence={selectedWord.sentence}
          lang={selectedWord.lang}
          isCollected={isSelectedCollected}
          onClose={() => setSelectedWord(null)}
          onCollect={(definition) =>
            handleAddToVocab(
              selectedWord.word,
              selectedWord.sentence,
              selectedWord.lang,
              definition,
            )
          }
          onUncollect={() => removeWord(selectedWord.word)}
        />
      )}

      <VocabularyPanel
        open={vocabOpen}
        onClose={() => setVocabOpen(false)}
        vocab={vocab}
        onRemove={removeWord}
        onClearAll={clearAll}
        zhCues={zhCues}
        onUpdateWord={updateWord}
      />
      </>
      )}
    </Box>
  );
}
