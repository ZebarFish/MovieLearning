/**
 * useDownloads.test.ts
 *
 * The hook is a poller, and the two ways a poller goes wrong are polling when
 * there is nothing to watch and polling after it has been torn down. Both are
 * asserted here, along with the mutation passthrough and the rule that a failed
 * command must leave a readable message behind.
 *
 * The API module is mocked (rather than `fetch`) so the tests can dictate task
 * states directly; timers are faked so a full poll cycle costs no wall time.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/downloader', () => {
  class DownloadApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'DownloadApiError';
      this.status = status;
    }
  }
  return {
    DownloadApiError,
    isDownloadAvailable: vi.fn(() => true),
    listDownloads: vi.fn(),
    startDownload: vi.fn(),
    pauseDownload: vi.fn(),
    resumeDownload: vi.fn(),
    cancelDownload: vi.fn(),
    removeDownload: vi.fn(),
  };
});

import { useDownloads } from './useDownloads';
import * as api from '../utils/downloader';
import type { DownloadTask } from '../utils/downloader';

const POLL_MS = 800;

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: 'dl_1',
    url: 'https://example.com/a.mp4',
    filename: 'a.mp4',
    bytesTotal: 1000,
    bytesDone: 100,
    status: 'downloading',
    speedBps: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const listing = (tasks: DownloadTask[]): { dir: string; tasks: DownloadTask[] } => ({
  dir: '/tmp/downloads',
  tasks,
});

/** Let pending microtasks settle under fake timers. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.isDownloadAvailable).mockReturnValue(true);
  vi.mocked(api.listDownloads).mockResolvedValue(listing([]));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useDownloads — availability', () => {
  it('never talks to the server when the local service is unavailable', async () => {
    vi.mocked(api.isDownloadAvailable).mockReturnValue(false);
    const { result } = renderHook(() => useDownloads());
    await advance(POLL_MS * 4);

    expect(api.listDownloads).not.toHaveBeenCalled();
    expect(result.current.available).toBe(false);
    // "Unavailable" must not look like "still loading".
    expect(result.current.loading).toBe(false);
  });
});

describe('useDownloads — loading', () => {
  it('loads the list once on mount', async () => {
    vi.mocked(api.listDownloads).mockResolvedValue(listing([task()]));
    const { result } = renderHook(() => useDownloads());
    await settle();

    expect(api.listDownloads).toHaveBeenCalledTimes(1);
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.dir).toBe('/tmp/downloads');
    expect(result.current.loading).toBe(false);
  });

  it('keeps a load failure readable and does not retry it in a tight loop', async () => {
    vi.mocked(api.listDownloads).mockRejectedValue(
      new api.DownloadApiError(0, '无法连接本机下载服务，请确认应用正在运行。'),
    );
    const { result } = renderHook(() => useDownloads());
    await settle();

    expect(result.current.error).toBe('无法连接本机下载服务，请确认应用正在运行。');
    // Nothing is downloading, so there is nothing to poll for.
    await advance(POLL_MS * 3);
    expect(api.listDownloads).toHaveBeenCalledTimes(1);
  });
});

describe('useDownloads — polling', () => {
  it('polls while something is downloading, and stops once it finishes', async () => {
    vi.mocked(api.listDownloads)
      .mockResolvedValueOnce(listing([task({ status: 'downloading' })]))
      .mockResolvedValue(listing([task({ status: 'done' })]));

    const { result } = renderHook(() => useDownloads());
    await settle();
    expect(result.current.tasks[0]?.status).toBe('downloading');

    await advance(POLL_MS);
    await advance(POLL_MS);
    expect(vi.mocked(api.listDownloads).mock.calls.length).toBeGreaterThanOrEqual(2);

    // The second call saw a finished task, so the timer must now be gone.
    const idleCalls = vi.mocked(api.listDownloads).mock.calls.length;
    await advance(POLL_MS * 5);
    expect(vi.mocked(api.listDownloads).mock.calls.length).toBe(idleCalls);
  });

  it('stops polling once unmounted', async () => {
    vi.mocked(api.listDownloads).mockResolvedValue(listing([task()]));
    const { unmount } = renderHook(() => useDownloads());
    await settle();
    expect(api.listDownloads).toHaveBeenCalledTimes(1);

    unmount();
    await advance(POLL_MS * 5);

    // A timer that outlives its component would keep hitting the server (and
    // calling setState on a dead component).
    expect(api.listDownloads).toHaveBeenCalledTimes(1);
  });
});

describe('useDownloads — mutations', () => {
  it('forwards start() and refreshes the list afterwards', async () => {
    vi.mocked(api.startDownload).mockResolvedValue(task({ id: 'dl_new' }));
    const { result } = renderHook(() => useDownloads());
    await settle();
    const before = vi.mocked(api.listDownloads).mock.calls.length;

    let ok = false;
    await act(async () => {
      ok = await result.current.start('https://example.com/v.mp4', 'v.mp4');
    });

    expect(api.startDownload).toHaveBeenCalledWith('https://example.com/v.mp4', 'v.mp4');
    expect(ok).toBe(true);
    expect(vi.mocked(api.listDownloads).mock.calls.length).toBeGreaterThan(before);
  });

  it('reports a failed command as false AND keeps the reason on screen', async () => {
    vi.mocked(api.startDownload).mockRejectedValue(
      new api.DownloadApiError(400, '请填写视频直链地址。'),
    );
    const { result } = renderHook(() => useDownloads());
    await settle();

    let ok = true;
    await act(async () => {
      ok = await result.current.start('');
    });

    expect(ok).toBe(false);
    // The refresh that follows a command must not swallow this message.
    expect(result.current.error).toBe('请填写视频直链地址。');
  });

  it('routes pause / resume / cancel / remove to their endpoints', async () => {
    vi.mocked(api.pauseDownload).mockResolvedValue(task({ status: 'paused' }));
    vi.mocked(api.resumeDownload).mockResolvedValue(task());
    vi.mocked(api.cancelDownload).mockResolvedValue(task({ status: 'canceled' }));
    vi.mocked(api.removeDownload).mockResolvedValue(undefined);

    const { result } = renderHook(() => useDownloads());
    await settle();

    await act(async () => {
      await result.current.pause('dl_1');
      await result.current.resume('dl_1');
      await result.current.cancel('dl_1');
      await result.current.remove('dl_1');
    });

    expect(api.pauseDownload).toHaveBeenCalledWith('dl_1');
    expect(api.resumeDownload).toHaveBeenCalledWith('dl_1');
    expect(api.cancelDownload).toHaveBeenCalledWith('dl_1');
    expect(api.removeDownload).toHaveBeenCalledWith('dl_1');
  });
});
