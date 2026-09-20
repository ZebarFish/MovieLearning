/**
 * speechRecognition
 *
 * Thin wrapper around the browser's Web Speech API (SpeechRecognition) for
 * live mic transcription during shadowing practice. Chromium-based browsers
 * (Chrome / Edge) implement it as `webkitSpeechRecognition`; Firefox does
 * not — callers must handle `null` (unsupported) gracefully.
 *
 * The recognition runs in parallel with the existing MediaRecorder stream;
 * both just read the microphone. Note: Chrome performs recognition on its
 * servers, so it needs network access.
 */

interface SRAlternative {
  transcript: string;
  confidence: number;
}

interface SRResult {
  isFinal: boolean;
  0: SRAlternative;
  length: number;
}

interface SREvent {
  resultIndex: number;
  results: { length: number; [index: number]: SRResult };
}

interface SRErrorEvent {
  error: string;
}

interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SRConstructor = new () => SRInstance;

export interface Recognizer {
  /** Ask for a final result and release the mic; `onDone` fires afterwards. */
  stop(): void;
}

export interface RecognizerOptions {
  /** BCP-47 language of the target sentence, e.g. 'en-US'. */
  lang: string;
  /** Called once per finalized phrase from the recognition service. */
  onFinal: (transcript: string) => void;
  /** Called when the recognizer is finished (after stop or service end). */
  onDone: () => void;
  /** Called on recognition failures (e.g. 'network', 'not-allowed'). */
  onError?: (error: string) => void;
}

/** Returns a recognizer, or null when the browser has no Web Speech API. */
export function createRecognizer(options: RecognizerOptions): Recognizer | null {
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = options.lang;
  rec.continuous = true;
  rec.interimResults = false;

  let stopped = false;
  let doneFired = false;
  const fireDoneOnce = (): void => {
    if (!doneFired) {
      doneFired = true;
      options.onDone();
    }
  };
  rec.onresult = (e: SREvent): void => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (result && result.isFinal && result.length > 0) {
        options.onFinal(result[0].transcript);
      }
    }
  };
  rec.onerror = (e: SRErrorEvent): void => {
    options.onError?.(e.error);
  };
  rec.onend = (): void => {
    if (stopped) fireDoneOnce();
  };

  try {
    rec.start();
  } catch {
    // start() can throw if the mic is already claimed in some engines.
    return null;
  }

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      // stop() flushes pending final results; abort() would drop them.
      try {
        rec.stop();
      } catch {
        fireDoneOnce();
      }
      // Safety net: some engines never fire onend (e.g. network hangs).
      window.setTimeout(() => {
        try {
          rec.abort();
        } catch {
          /* already dead */
        }
        fireDoneOnce();
      }, 3000);
    },
  };
}
