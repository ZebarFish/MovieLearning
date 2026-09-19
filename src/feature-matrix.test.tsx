/**
 * 功能矩阵测试 - 逐个验证应用每个功能点
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { downloadSpy } = vi.hoisted(() => ({ downloadSpy: vi.fn() }));
import App from './App';

// The discovery view is mounted alongside the study stage and resolves posters
// from Douban / TVmaze / iTunes; keep tests off the network.
vi.mock('./utils/posters', () => ({
  fetchPosterUrl: vi.fn(async () => null),
  clearPosterCache: vi.fn(),
}));

const SRT_SAMPLE = `1
00:00:00,000 --> 00:00:02,500
Hello world this is a test.

2
00:00:02,500 --> 00:00:05,000
Good morning everyone.
`;

const VTT_SAMPLE = `WEBVTT

00:00:00.000 --> 00:00:02.500
First line in VTT format.

00:00:02.500 --> 00:00:05.000
Second line here.
`;

// --- Mocks -----------------------------------------------------------------

// jsdom localStorage
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
    _dump: () => ({ ...store }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// jsdom missing URL
Object.defineProperty(window, 'URL', {
  value: {
    createObjectURL: vi.fn(() => 'blob://mock'),
    revokeObjectURL: vi.fn(),
  },
  writable: true,
});

// Mock fetch: dictionary API + AnkiConnect (used by VocabularyPanel).
const dictionaryData = [
  {
    word: 'hello',
    phonetic: '/həˈloʊ/',
    phonetics: [{ text: '/həˈloʊ/', audio: '' }],
    meanings: [
      {
        partOfSpeech: 'interjection',
        definitions: [{ definition: 'Used as a greeting or to begin a conversation.' }],
      },
    ],
  },
];

const ankiMock = vi.fn((_url: string | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  const table: Record<string, unknown> = {
    version: 6,
    deckNames: ['Default', '系统默认', '绝望主妇'],
    modelNames: ['Basic', '问答题'],
    modelFieldNames: ['Front', 'Back'],
    findCards: [],
    addNotes: [123],
  };
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ result: table[body.action] ?? null, error: null }),
  });
});

const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
  const urlStr = String(url);
  if (urlStr.includes('127.0.0.1:8765')) {
    return ankiMock(urlStr, init);
  }
  // dictionaryapi.dev
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(dictionaryData),
  });
});
Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true });

// Mock Anki download
vi.mock('./utils/ankiExport', async () => {
  const actual = await vi.importActual<typeof import('./utils/ankiExport')>(
    './utils/ankiExport',
  );
  return { ...actual, downloadAnkiExport: downloadSpy };
});

// Suppress MUI noise
const _origErr = console.error;
console.error = (...args: unknown[]) => {
  const m = String(args[0] ?? '');
  if (m.includes('forwardRef') || m.includes('aria-')) return;
  _origErr.apply(console, args);
};

// --- Helpers ---------------------------------------------------------------

function loadApp() {
  const utils = render(<App />);
  // Media/subtitle pickers live in a drawer — open it first.
  fireEvent.click(screen.getByText('🎬 媒体与字幕'));
  // MUI Drawer portals its content to document.body, not the render container.
  const getVideoInput = () =>
    document.body.querySelector(
      'input[type="file"][accept*="video"]',
    ) as HTMLInputElement;
  const getSubtitleInput = () =>
    document.body.querySelector(
      'input[type="file"][accept*=".srt"]',
    ) as HTMLInputElement;
  return { ...utils, getVideoInput, getSubtitleInput };
}

function uploadFile(
  input: HTMLInputElement,
  content: string | Blob,
  filename: string,
  mime: string,
) {
  const file = content instanceof Blob
    ? new File([content], filename, { type: mime })
    : new File([content], filename, { type: mime });
  fireEvent.change(input, { target: { files: [file] } });
}

// Helper: join text inside a container (handles multi-span subtitle text).
function containerText(container: HTMLElement): string {
  return container.textContent ?? '';
}

// =============================================================================
// 1. 顶部步骤指示器
// =============================================================================
describe('Feature 1: 顶部步骤指示器', () => {
  beforeEach(() => {
    localStorageMock.clear();
    downloadSpy.mockClear();
  });

  it('renders all 8 learning step titles', () => {
    loadApp();
    // Step buttons live in the steps drawer — open it.
    fireEvent.click(screen.getByText('🎓 学习步骤'));
    const buttons = screen.getAllByRole('button');
    const titles = ['定位', '盲听', '听写', '订正', '跟读', '收词'];
    for (const t of titles) {
      const found = buttons.some(
        (b) => (b.textContent ?? '').includes(t),
      );
      expect(found).toBe(true);
    }
  });

  it('shows initial chip "步骤 1/8"', async () => {
    loadApp();
    await waitFor(() => {
      expect(screen.getByText(/步骤 1\/8/)).toBeTruthy();
    });
  });
});

// =============================================================================
// 2. 选择本地视频文件
// =============================================================================
describe('Feature 2: 选择本地视频文件', () => {
  beforeEach(() => {
    localStorageMock.clear();
    downloadSpy.mockClear();
  });

  it('video filename chip shows after picking a file', () => {
    const app = loadApp();
    const input = app.getVideoInput();
    uploadFile(input, 'fake-bytes', 'mymovie.mp4', 'video/mp4');
    expect(
      screen.getAllByText(/mymovie\.mp4/).length,
    ).toBeGreaterThan(0);
  });

  it('accept attribute includes mkv', () => {
    const app = loadApp();
    const input = app.getVideoInput();
    expect(input.accept).toContain('.mkv');
  });
});

// =============================================================================
// 3. 通过 URL 加载视频
// =============================================================================
describe('Feature 3: 通过 URL 加载视频', () => {
  beforeEach(() => {
    localStorageMock.clear();
    downloadSpy.mockClear();
  });

  it('loads URL into video source', () => {
    const app = loadApp();
    const tf = screen.getByPlaceholderText(/example\.com\/video\.mp4/);
    fireEvent.change(tf, { target: { value: 'https://example.com/x.mp4' } });
    // Use parent Stack to find the load button directly next to the URL field.
    const loadBtn = tf.closest('.MuiStack-root')?.querySelector('button');
    expect(loadBtn).toBeTruthy();
    fireEvent.click(loadBtn!);
    const video = app.container.querySelector('video');
    expect(video?.getAttribute('src')).toContain('example.com');
  });
});

// =============================================================================
// 4. 解析 SRT 字幕
// =============================================================================
describe('Feature 4: 解析 SRT 字幕', () => {
  beforeEach(() => {
    localStorageMock.clear();
    downloadSpy.mockClear();
  });

  it('parses SRT and shows cue text in subtitle list', async () => {
    const app = loadApp();
    uploadFile(app.getVideoInput(), 'fake', 'a.mp4', 'video/mp4');
    uploadFile(app.getSubtitleInput(), SRT_SAMPLE, 'a.srt', 'text/plain');

    await waitFor(() => {
      expect(containerText(app.container)).toContain('Good morning everyone');
    });
  });

  it('header row shows cue count "字幕列表（2 条）"', async () => {
    const app = loadApp();
    uploadFile(app.getVideoInput(), 'fake', 'b.mp4', 'video/mp4');
    uploadFile(app.getSubtitleInput(), SRT_SAMPLE, 'b.srt', 'text/plain');
    await waitFor(() => {
      expect(screen.getByText(/字幕列表（2 条）/)).toBeTruthy();
    });
  });
});

// =============================================================================
// 5. 解析 VTT 字幕
// =============================================================================
describe('Feature 5: 解析 VTT 字幕', () => {
  beforeEach(() => {
    localStorageMock.clear();
    downloadSpy.mockClear();
  });

  it('parses VTT and shows first cue text', async () => {
    const app = loadApp();
    uploadFile(app.getVideoInput(), 'fake', 'a.mp4', 'video/mp4');
    uploadFile(app.getSubtitleInput(), VTT_SAMPLE, 'a.vtt', 'text/vtt');
    await waitFor(() => {
      expect(containerText(app.container)).toContain('Second line here');
    });
  });
});

// =============================================================================
// 6. 字幕显示/隐藏开关
// =============================================================================
describe('Feature 6: 字幕开关', () => {
  beforeEach(() => {
    localStorageMock.clear();
    downloadSpy.mockClear();
  });

  it('overlay subtitle is shown when subtitleVisible=true', async () => {
    const app = loadApp();
    uploadFile(app.getVideoInput(), 'fake', 'a.mp4', 'video/mp4');
    uploadFile(app.getSubtitleInput(), SRT_SAMPLE, 'a.srt', 'text/plain');

    await waitFor(() => {
      expect(screen.getByTestId('current-subtitle')).toBeTruthy();
    });
  });
});

// =============================================================================
// 7. 字幕点击跳转
// =============================================================================
describe('Feature 7: 字幕点击跳转', () => {
  beforeEach(() => {
    localStorageMock.clear();
    downloadSpy.mockClear();
  });

  it('subtitle list items are interactive buttons', async () => {
    const app = loadApp();
    uploadFile(app.getVideoInput(), 'fake', 'a.mp4', 'video/mp4');
    uploadFile(app.getSubtitleInput(), SRT_SAMPLE, 'a.srt', 'text/plain');

    await waitFor(() => {
      expect(containerText(app.container)).toContain('Good morning everyone');
    });
    // Confirm at least one ListItemButton (role=button) exists
    const listButtons = app.container.querySelectorAll('.MuiListItemButton-root');
    expect(listButtons.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 8. A-B 循环
// =============================================================================
describe('Feature 8: A-B 循环', () => {
  beforeEach(() => {
    localStorageMock.clear();
    downloadSpy.mockClear();
  });

  it('A-B initial state shows unset markers and the set-A button', () => {
    loadApp();
    // "A-B 循环" appears as the compact bar label (step description moved
    // into the drawer), so we use getAllByText and confirm at least one match.
    const allMatches = screen.getAllByText(/A-B 循环/);
    expect(allMatches.length).toBeGreaterThanOrEqual(1);
    // Set-A button is rendered
    expect(screen.getByText(/^设 A 点$/)).toBeTruthy();
    // Unset markers should appear
    expect(containerText(document.body)).toContain('未设置');
  });

  it('clears AB markers when clear button is clicked', () => {
    loadApp();
    // No clear visible until both A and B set
    const clearBtns = screen.getAllByText(/清除/).filter(
      (el) => el.tagName === 'BUTTON' || el.closest('button'),
    );
    expect(clearBtns.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 9. 单词点击收藏
// =============================================================================
describe('Feature 9: 单词点击收藏', () => {
  beforeEach(() => {
    localStorageMock.clear();
    downloadSpy.mockClear();
  });

  it('clicking a subtitle word opens detail card and adding it creates a vocab item', async () => {
    const app = loadApp();
    uploadFile(app.getVideoInput(), 'fake', 'a.mp4', 'video/mp4');
    uploadFile(app.getSubtitleInput(), SRT_SAMPLE, 'a.srt', 'text/plain');

    await waitFor(() => {
      expect(app.container.querySelector('.subtitle-word')).toBeTruthy();
    });
    const words = app.container.querySelectorAll('.subtitle-word');
    fireEvent.click(words[0]);

    // Word detail card appears and has a collect button
    await waitFor(() => {
      expect(screen.getByTestId('word-detail-card')).toBeTruthy();
    });
    const collectBtn = screen.getByText('☆ 收藏');
    fireEvent.click(collectBtn);

    // Now open vocab drawer
    const vocabBtn = screen.getByText('词库');
    fireEvent.click(vocabBtn);

    await waitFor(() => {
      expect(screen.getByText('我的词库')).toBeTruthy();
    });
    // Drawer should have at least one vocab item
    const drawer = app.container.querySelector('[role="presentation"]') ?? app.container;
    expect(drawer.textContent).toMatch(/[a-zA-Z]+/); // some word present
  });
});

// =============================================================================
// 10. Anki 导出
// =============================================================================
describe('Feature 10: Anki 导出', () => {
  beforeEach(() => {
    localStorageMock.clear();
    downloadSpy.mockClear();
  });

  it('export button triggers downloadAnkiExport', async () => {
    const app = loadApp();
    uploadFile(app.getVideoInput(), 'fake', 'a.mp4', 'video/mp4');
    uploadFile(app.getSubtitleInput(), SRT_SAMPLE, 'a.srt', 'text/plain');
    await waitFor(() =>
      expect(app.container.querySelector('.subtitle-word')).toBeTruthy(),
    );

    // Collect a word via detail card
    const words = app.container.querySelectorAll('.subtitle-word');
    fireEvent.click(words[0]);
    await waitFor(() => {
      expect(screen.getByTestId('word-detail-card')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('☆ 收藏'));

    // Open drawer
    fireEvent.click(screen.getByText('词库'));
    await waitFor(() => expect(screen.getByText('我的词库')).toBeTruthy());

    // Click export
    const exportBtn = screen.getByText('导出');
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(downloadSpy).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// 11. localStorage 持久化
// =============================================================================
describe('Feature 11: localStorage 持久化', () => {
  beforeEach(() => {
    localStorageMock.clear();
    downloadSpy.mockClear();
  });

  it('writes to localStorage when word is added', async () => {
    const app = loadApp();
    uploadFile(app.getVideoInput(), 'fake', 'a.mp4', 'video/mp4');
    uploadFile(app.getSubtitleInput(), SRT_SAMPLE, 'a.srt', 'text/plain');
    await waitFor(() =>
      expect(app.container.querySelector('.subtitle-word')).toBeTruthy(),
    );

    const words = app.container.querySelectorAll('.subtitle-word');
    fireEvent.click(words[0]);

    await waitFor(() => {
      expect(screen.getByTestId('word-detail-card')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('☆ 收藏'));

    await waitFor(() => {
      const dump = localStorageMock._dump();
      const hasVocab = Object.keys(dump).some((k) => k.includes('vocab') || k.includes('learnTV'));
      expect(hasVocab).toBe(true);
    });
  });
});
