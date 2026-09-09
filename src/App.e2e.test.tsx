import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const DEMO_SRT = `1
00:00:00,000 --> 00:00:02,500
Welcome to the listening practice demo.

2
00:00:02,500 --> 00:00:05,000
This short clip has a synthetic tone.

3
00:00:05,000 --> 00:00:07,500
Try the A B loop button to repeat segments.

4
00:00:07,500 --> 00:00:10,000
Click any English word to add it to vocabulary.
`;

// jsdom localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// createObjectURL / revokeObjectURL are not present in jsdom
Object.defineProperty(window, 'URL', {
  value: {
    createObjectURL: vi.fn(() => 'blob://mock-video-url'),
    revokeObjectURL: vi.fn(),
  },
  writable: true,
});

// Mock the Anki download to avoid actual file I/O.
vi.mock('./utils/ankiExport', async () => {
  const actual = await vi.importActual<typeof import('./utils/ankiExport')>(
    './utils/ankiExport',
  );
  return {
    ...actual,
    downloadAnkiExport: vi.fn(),
  };
});

const originalError = console.error;
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('forwardRef') || msg.includes('aria-')) return;
  originalError.apply(console, args);
};

describe('Full user flow in jsdom', () => {
  it('loads video + subtitles, collects a word, and shows vocab drawer', async () => {
    const { container } = render(<App />);

    // 0. Media/subtitle pickers live in a drawer — open it (portals to body).
    fireEvent.click(screen.getByText('🎬 媒体与字幕'));

    // 1. Verify picker UI is present (in the drawer, portaled to body)
    await waitFor(() => {
      expect(document.body.textContent).toContain('选择视频');
    });

    // 2. Simulate uploading a video file
    const videoInput = document.body.querySelector(
      'input[type="file"][accept*="video"]',
    ) as HTMLInputElement;
    expect(videoInput).toBeTruthy();

    const videoFile = new File(['fake-video'], 'demo.mp4', {
      type: 'video/mp4',
    });
    fireEvent.change(videoInput, { target: { files: [videoFile] } });

    // 3. Simulate uploading the SRT
    const subtitleInput = document.body.querySelector(
      'input[type="file"][accept*=".srt"]',
    ) as HTMLInputElement;
    expect(subtitleInput).toBeTruthy();

    const srtFile = new File([DEMO_SRT], 'demo.srt', { type: 'text/plain' });
    fireEvent.change(subtitleInput, { target: { files: [srtFile] } });

    // 4. Wait for subtitle list to populate
    await waitFor(() => {
      expect(screen.getByText(/Welcome to the listening practice demo/)).toBeTruthy();
    });

    // 5. Click a word inside the subtitle list
    const wordSpan = container.querySelector('.subtitle-word');
    expect(wordSpan).toBeTruthy();
    fireEvent.click(wordSpan!);

    // 6. Open the vocabulary drawer and verify the word is listed
    const vocabButton = screen.getByText('词库');
    fireEvent.click(vocabButton);

    await waitFor(() => {
      expect(screen.getByText('我的词库')).toBeTruthy();
    });

    // 7. Verify the collected word appears in the drawer
    const drawer = container.querySelector('[role="presentation"]') ?? container;
    expect(drawer.textContent).toMatch(/Welcome/i);

    // 8. Verify subtitle overlay shows current cue text
    const overlay = screen.getByTestId('current-subtitle');
    expect(overlay.textContent).toMatch(/Welcome to the listening practice demo/);
  });
});
