import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

// The discovery view is mounted alongside the study stage, and it resolves
// posters from Douban / TVmaze / iTunes. Tests must not touch the network.
vi.mock('./utils/posters', () => ({
  fetchPosterUrl: vi.fn(async () => null),
  clearPosterCache: vi.fn(),
  isDoubanBlocked: vi.fn(() => false),
  resetPosterSources: vi.fn(),
}));

// jsdom has no getUserMedia; mock it so the video element tests don't crash.
Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  writable: true,
  value: {},
});

// Mock localStorage
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

// MUI + emotion can generate a lot of warnings in jsdom; suppress noisy ones.
const originalError = console.error;
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (
    msg.includes('aria-') ||
    msg.includes('forwardRef') ||
    msg.includes('Unknown event handler property')
  ) {
    return;
  }
  originalError.apply(console, args);
};

describe('App renders without crashing', () => {
  it('shows video selector and player placeholders', async () => {
    const { container } = render(<App />);

    // The top learning steps should render
    await waitFor(() => {
      expect(
        screen.getByText(/点击按钮直接选择本地文件/),
      ).toBeTruthy();
    });

    // Subtitle list placeholder
    expect(
      screen.getByText(/加载 \.srt \/ \.vtt 文件后会在这里显示/),
    ).toBeTruthy();

    // AB loop controls should be somewhere
    expect(container.textContent).toContain('A-B');
  });
});

describe('App — discover view toggle', () => {
  it('keeps the study stage mounted while the discover view is open', async () => {
    render(<App />);

    // The learning stage is mounted to begin with.
    expect(screen.getByTestId('study-stage')).toBeTruthy();

    // Switch to the discovery view.
    fireEvent.click(screen.getByTestId('nav-discover'));

    // The discovery view is now on screen …
    expect(screen.getByTestId('movie-grid')).toBeTruthy();

    // … but the study stage must NOT have been unmounted. Unmounting it would
    // destroy the <video> element, resetting playback to 0:00 while
    // `currentTime` still held the old value — the user would lose their
    // place and the subtitle highlight would desync from the picture. The
    // stage is hidden with CSS instead, so it has to stay in the document.
    expect(screen.getByTestId('study-stage')).toBeTruthy();

    // Switching back restores the study UI.
    fireEvent.click(screen.getByTestId('nav-study'));
    await waitFor(() => {
      expect(screen.queryByTestId('movie-grid')).toBeNull();
    });
    expect(screen.getByTestId('study-stage')).toBeTruthy();
  });
});

describe('App — download view toggle', () => {
  it('keeps the study stage mounted while the download centre is open', async () => {
    render(<App />);
    expect(screen.getByTestId('study-stage')).toBeTruthy();

    fireEvent.click(screen.getByTestId('nav-download'));

    // The download centre is on screen …
    expect(screen.getByTestId('download-panel')).toBeTruthy();

    // … and the study stage is still in the document for the same reason as in
    // the discover view: unmounting it would destroy the <video> and lose the
    // playback position (see the discover-view test above).
    expect(screen.getByTestId('study-stage')).toBeTruthy();

    fireEvent.click(screen.getByTestId('nav-study'));
    await waitFor(() => {
      expect(screen.queryByTestId('download-panel')).toBeNull();
    });
    expect(screen.getByTestId('study-stage')).toBeTruthy();
  });
});
