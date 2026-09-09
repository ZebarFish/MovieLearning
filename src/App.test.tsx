import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

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
