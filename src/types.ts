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