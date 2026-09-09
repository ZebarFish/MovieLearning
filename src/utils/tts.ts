/**
 * tts.ts
 *
 * Thin wrapper around the browser's built-in SpeechSynthesis API so the
 * rest of the app can call `speak(text)` without worrying about feature
 * detection or voice enumeration.
 *
 * Browsers (Chrome / Edge / Safari / Firefox) all ship this; no network or
 * third-party TTS service is required.
 */

/** All voices available on this device. Empty array if not supported. */
export function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }
  return window.speechSynthesis.getVoices();
}

/** Filter listVoices() down to English voices with a non-empty lang tag. */
export function englishVoices(): SpeechSynthesisVoice[] {
  return listVoices().filter((v) => /^en[-_]/i.test(v.lang));
}

/** Stop any in-progress speech. */
export function cancelSpeech(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
}

export interface SpeakOptions {
  /** BCP-47 language tag, e.g. "en-US". Defaults to whatever voice provides. */
  lang?: string;
  /** 0.1 ~ 10. Default 1. */
  rate?: number;
  /** 0 ~ 2. Default 1. */
  pitch?: number;
  /** 0 ~ 1. Default 1. */
  volume?: number;
  /** Specific voice name to use. Takes precedence over lang. */
  voiceName?: string;
}

/**
 * Speak `text` immediately, cancelling anything currently being said.
 * No-op if SpeechSynthesis is not available.
 */
export function speak(text: string, options: SpeakOptions = {}): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const trimmed = text.trim();
  if (!trimmed) return;

  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(trimmed);
  if (options.voiceName) {
    const v = window.speechSynthesis
      .getVoices()
      .find((vv) => vv.name === options.voiceName);
    if (v) u.voice = v;
  } else if (options.lang) {
    u.lang = options.lang;
  }
  if (options.rate !== undefined) u.rate = options.rate;
  if (options.pitch !== undefined) u.pitch = options.pitch;
  if (options.volume !== undefined) u.volume = options.volume;

  window.speechSynthesis.speak(u);
}
