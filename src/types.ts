/**
 * Global type definitions for the Learn English Through TV application.
 */

/** A single subtitle cue (one line) parsed from SRT/VTT files. */
export interface SubtitleCue {
  /** Sequential index (1-based) of the cue in the file. */
  index: number;
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  /** Subtitle text content (may contain line breaks). */
  text: string;
}

/** Information about a loaded media source. */
export interface VideoSource {
  /** Object URL or external URL for the <video>/<audio> element. */
  src: string;
  /** Display name (filename or URL). */
  name: string;
  /** Whether the source is a remote URL (true) or a local file blob (false). */
  isRemote: boolean;
  /** Whether the element is a video (with picture) or an audio (no picture). */
  kind: 'video' | 'audio';
  /** Original File handle when loaded from disk (enables hash-based subtitle lookup). */
  file?: File;
}

/** Semantic language tag used to drive UI flags & TTS voice selection. */
export type SubtitleLang = 'en' | 'zh' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'other';

/** Display label + parsed cues for a single subtitle file. */
export interface SubtitleTrack {
  /** Stable unique id, also used as React key. */
  id: string;
  /** Human-readable name shown in the track list (default: language name). */
  label: string;
  /** Original filename if loaded from a File. */
  filename: string;
  /** Semantic language tag. */
  lang: SubtitleLang;
  /** Parsed cues for this track. */
  cues: SubtitleCue[];
}

/** Which subtitle tracks are currently visible on the video overlay. */
export type SubtitleDisplayMode = 'none' | 'en' | 'zh' | 'both';

/** A single vocabulary entry collected by the user. */
export interface VocabWord {
  /** The English word (lowercase, normalized). */
  word: string;
  /** Original surface form as seen (preserves case). */
  surface: string;
  /** Sentence in which the word appears. */
  sentence: string;
  /** Source video name. */
  video: string;
  /** Timestamp (in seconds) where the word appears. */
  time: number;
  /** ISO timestamp when the word was added to the vocabulary. */
  addedAt: string;
  /** Which subtitle track the word was picked from (lang code). Optional. */
  lang?: SubtitleLang;
  /**
   * 单词释义 — definition of the word (part-of-speech prefixed). Filled from
   * the dictionary when the word is collected, or backfilled before an Anki
   * sync for entries collected before that.
   */
  definition?: string;
  /**
   * 例句释义 — Chinese translation of `sentence`. Taken from the Chinese
   * subtitle track when one is loaded, otherwise machine-translated.
   */
  translation?: string;
}

/** A-B loop marker state. */
export interface ABLoopState {
  /** Point A in seconds, or null if not set. */
  pointA: number | null;
  /** Point B in seconds, or null if not set. */
  pointB: number | null;
  /** Whether the loop is currently active. */
  enabled: boolean;
}

/** Step key identifier used in the learning step indicator. */
export type StepKey =
  | 'locate'
  | 'blind-listen-1'
  | 'blind-listen-2'
  | 'dictation'
  | 'correction'
  | 'shadow-1'
  | 'shadow-2'
  | 'vocab';

/** Description of a single step in the learning workflow. */
export interface LearningStep {
  key: StepKey;
  title: string;
  description: string;
}

/** A user-selected study segment (consecutive subtitle lines). */
export interface StudySegment {
  /** Index (into the flat cue list) of the first cue of the segment. */
  startIndex: number;
  /** Index of the last cue of the segment (inclusive). */
  endIndex: number;
  /** Segment start time in seconds. */
  startTime: number;
  /** Segment end time in seconds. */
  endTime: number;
}

/** Guided learning stage. */
export type StudyStage =
  | 'locate'
  | 'blind'
  | 'dictation'
  | 'correct'
  | 'shadow'
  | 'collect';

// ---------------------------------------------------------------------------
// Movie discovery (curated catalog + recommendation engine)
// ---------------------------------------------------------------------------

/** 影片题材标签 */
export type MovieGenre =
  | 'drama' | 'comedy' | 'crime' | 'thriller' | 'sci-fi' | 'animation'
  | 'documentary' | 'action' | 'romance' | 'fantasy' | 'adventure'
  | 'history' | 'music' | 'family' | 'mystery';

/** 媒体形态 */
export type MovieMediaType = 'movie' | 'series';

/** 学习向指标等级，1(易) ~ 5(难) */
export type Level1to5 = 1 | 2 | 3 | 4 | 5;

/** 一条影片/剧集条目 */
export interface MovieEntry {
  /** 稳定唯一 id（小写 slug），同时作为收藏/已看的存储键 */
  id: string;
  /** 中文标题 */
  title: string;
  /** 原文标题 */
  originalTitle: string;
  /** 首播年份 */
  year: number;
  /** 对白主要语言 */
  primaryLang: SubtitleLang;
  /** 出现的语言（多语种影片可多个），必须包含 primaryLang */
  langs: SubtitleLang[];
  /** 题材，至少一个 */
  genres: MovieGenre[];
  mediaType: MovieMediaType;
  /** 综合学习难度 1~5 */
  difficulty: Level1to5;
  /** 语速 1~5（5 最快） */
  speechRate: Level1to5;
  /** 词汇难度 1~5 */
  vocabulary: Level1to5;
  /** 对白密度 1~5（5 台词最密） */
  dialogueDensity: Level1to5;
  /** 口碑评分 0~10 */
  rating: number;
  /** 热度 0~100 */
  popularity: number;
  /** 一句话中文简介 */
  synopsis: string;
  /** 口语/文化标签，如 '美音' '英音' '情景喜剧' '职场' */
  tags: string[];
  /** 口音描述，可选 */
  accent?: string;
  /** TMDB id，用于可选的海报补图 */
  tmdbId?: number;
}

/** 发现页筛选条件 */
export interface MovieFilter {
  /** 选中语言；空数组 = 不限 */
  langs: SubtitleLang[];
  /** 选中题材；空数组 = 不限 */
  genres: MovieGenre[];
  /** 难度区间 [min, max]，闭区间，1~5 */
  difficulty: [Level1to5, Level1to5];
  /** 媒体形态；'all' = 不限 */
  mediaType: MovieMediaType | 'all';
  /** 关键字，匹配 title / originalTitle / tags / synopsis，大小写不敏感 */
  query: string;
}

/** 排序方式 */
export type MovieSortKey = 'match' | 'rating' | 'difficulty-asc' | 'difficulty-desc' | 'year';

/** 用户个性化偏好 */
export interface MoviePrefs {
  favorites: string[];
  watched: string[];
  hidden: string[];
}