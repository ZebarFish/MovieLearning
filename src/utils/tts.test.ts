import { describe, expect, it, vi } from 'vitest';
import { listVoices, englishVoices, speak, cancelSpeech } from './tts';

// Install a minimal mock for `SpeechSynthesisUtterance` global. jsdom v22+
// intentionally leaves it undefined.
class MockUtterance implements Partial<SpeechSynthesisUtterance> {
  text = '';
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  volume = 1;
  rate = 1;
  pitch = 1;
  onstart: ((this: SpeechSynthesisUtterance, ev: Event) => unknown) | null = null;
  onend: ((this: SpeechSynthesisUtterance, ev: Event) => unknown) | null = null;
  onerror: ((this: SpeechSynthesisUtterance, ev: SpeechSynthesisErrorEvent) => unknown) | null = null;
  constructor(text?: string) {
    if (text !== undefined) this.text = text;
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).SpeechSynthesisUtterance = MockUtterance;

// Helper: replace window.speechSynthesis with a fresh fake implementation.
function installSpeechSynthesisMock(impl: Partial<SpeechSynthesis>): void {
  const def: Partial<SpeechSynthesis> = {
    getVoices: () => [],
    cancel: () => undefined,
    speak: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    ...impl,
  };
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    writable: true,
    value: def,
  });
}

describe('tts', () => {
  describe('listVoices', () => {
    it('returns the voices array', () => {
      const fakeVoices = [
        { name: 'Alex', lang: 'en-US' } as SpeechSynthesisVoice,
        { name: 'Mei', lang: 'zh-CN' } as SpeechSynthesisVoice,
      ];
      installSpeechSynthesisMock({ getVoices: () => fakeVoices });
      expect(listVoices()).toHaveLength(2);
      expect(listVoices().map((v) => v.name)).toEqual(['Alex', 'Mei']);
    });

    it('returns [] when getVoices returns empty', () => {
      installSpeechSynthesisMock({ getVoices: () => [] });
      expect(listVoices()).toEqual([]);
    });
  });

  describe('englishVoices', () => {
    it('filters to entries whose lang starts with en- or en_ (case-insensitive)', () => {
      const fakeVoices = [
        { name: 'Alex', lang: 'en-US' } as SpeechSynthesisVoice,
        { name: 'Samantha', lang: 'en_GB' } as SpeechSynthesisVoice,
        { name: 'Mei', lang: 'zh-CN' } as SpeechSynthesisVoice,
        { name: 'English', lang: 'EN-AU' } as SpeechSynthesisVoice,
      ];
      installSpeechSynthesisMock({ getVoices: () => fakeVoices });
      const ev = englishVoices();
      expect(ev.map((v) => v.name)).toEqual(['Alex', 'Samantha', 'English']);
    });
  });

  describe('speak', () => {
    it('cancels prior speech and speaks new utterance with resolved voice', () => {
      const cancel = vi.fn();
      const speakFn = vi.fn();
      let lastUtterance: MockUtterance | null = null;
      installSpeechSynthesisMock({
        getVoices: () =>
          [{ name: 'Alex', lang: 'en-US' }] as SpeechSynthesisVoice[],
        cancel,
        speak: (u: SpeechSynthesisUtterance) => {
          speakFn(u);
          lastUtterance = u as unknown as MockUtterance;
        },
      });

      speak('hello world', { voiceName: 'Alex' });
      expect(cancel).toHaveBeenCalled();
      expect(speakFn).toHaveBeenCalledTimes(1);
      expect(lastUtterance!.text).toBe('hello world');
      expect(lastUtterance!.voice?.name).toBe('Alex');

      cancelSpeech();
      expect(cancel).toHaveBeenCalledTimes(2);
    });

    it('uses lang when no voiceName matches', () => {
      let lastUtterance: MockUtterance | null = null;
      installSpeechSynthesisMock({
        speak: (u: SpeechSynthesisUtterance) => {
          lastUtterance = u as unknown as MockUtterance;
        },
      });

      speak('bonjour', { lang: 'fr-FR' });
      expect(lastUtterance!.lang).toBe('fr-FR');
    });

    it('applies rate / pitch / volume options', () => {
      let lastUtterance: MockUtterance | null = null;
      installSpeechSynthesisMock({
        speak: (u: SpeechSynthesisUtterance) => {
          lastUtterance = u as unknown as MockUtterance;
        },
      });

      speak('speed test', { rate: 1.5, pitch: 0.5, volume: 0.8 });
      expect(lastUtterance!.rate).toBe(1.5);
      expect(lastUtterance!.pitch).toBe(0.5);
      expect(lastUtterance!.volume).toBe(0.8);
    });

    it('does not call speak when text is empty / whitespace', () => {
      const speakFn = vi.fn();
      installSpeechSynthesisMock({ speak: speakFn as unknown as SpeechSynthesis['speak'] });
      speak('   ');
      speak('');
      expect(speakFn).not.toHaveBeenCalled();
    });
  });

  describe('cancelSpeech', () => {
    it('invokes cancel on speechSynthesis', () => {
      const cancel = vi.fn();
      installSpeechSynthesisMock({ cancel });
      cancelSpeech();
      expect(cancel).toHaveBeenCalledTimes(1);
    });
  });
});
