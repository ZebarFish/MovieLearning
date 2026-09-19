/**
 * DownloadPanel.test.tsx
 *
 * The panel is a thin skin over `useDownloads`, so these tests pin down what
 * the user actually sees and presses: the state label, the progress line, the
 * per-status buttons, the "hand it to the study stage" action, and the
 * degraded mode when the local service is not there.
 *
 * Only the network-touching exports are stubbed; the formatters stay real so
 * the assertions are about genuine output rather than a mock echo.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../utils/downloader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/downloader')>();
  return {
    ...actual,
    isDownloadAvailable: vi.fn(() => true),
    listDownloads: vi.fn(),
    startDownload: vi.fn(),
    pauseDownload: vi.fn(),
    resumeDownload: vi.fn(),
    cancelDownload: vi.fn(),
    removeDownload: vi.fn(),
    revealDownload: vi.fn(),
  };
});

import { DownloadPanel } from './DownloadPanel';
import * as api from '../utils/downloader';
import type { DownloadTask } from '../utils/downloader';

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: 'dl_1',
    url: 'https://example.com/a.mp4',
    filename: 'a.mp4',
    bytesTotal: 1000,
    bytesDone: 250,
    status: 'downloading',
    speedBps: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const listing = (tasks: DownloadTask[]): { dir: string; tasks: DownloadTask[] } => ({
  dir: 'C:\\proj\\downloads',
  tasks,
});

beforeEach(() => {
  vi.mocked(api.isDownloadAvailable).mockReturnValue(true);
  vi.mocked(api.listDownloads).mockResolvedValue(listing([]));
  vi.mocked(api.startDownload).mockResolvedValue(task());
  vi.mocked(api.pauseDownload).mockResolvedValue(task({ status: 'paused' }));
  vi.mocked(api.resumeDownload).mockResolvedValue(task());
  vi.mocked(api.cancelDownload).mockResolvedValue(task({ status: 'canceled' }));
  vi.mocked(api.removeDownload).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DownloadPanel — empty and heading', () => {
  it('shows the download directory and an empty state once loaded', async () => {
    render(<DownloadPanel />);

    expect(screen.getByTestId('download-panel')).toBeTruthy();
    expect(screen.getByText('下载中心')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/还没有下载任务/)).toBeTruthy();
    });
    // The user should be able to find the files afterwards.
    expect(screen.getByText(/C:\\proj\\downloads/)).toBeTruthy();
  });
});

describe('DownloadPanel — starting a download', () => {
  it('forwards the pasted link and the "save as" name', async () => {
    render(<DownloadPanel />);
    await waitFor(() => expect(api.listDownloads).toHaveBeenCalled());

    fireEvent.change(screen.getByTestId('download-url-input'), {
      target: { value: 'https://example.com/movie.mp4' },
    });
    fireEvent.change(screen.getByTestId('download-filename-input'), {
      target: { value: 'movie.mp4' },
    });
    fireEvent.click(screen.getByTestId('download-start'));

    await waitFor(() => {
      expect(api.startDownload).toHaveBeenCalledWith('https://example.com/movie.mp4', 'movie.mp4');
    });
  });

  it('refuses an empty link with a hint instead of calling the server', async () => {
    render(<DownloadPanel />);
    await waitFor(() => expect(api.listDownloads).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('download-start'));

    expect(await screen.findByText('请先粘贴视频直链。')).toBeTruthy();
    expect(api.startDownload).not.toHaveBeenCalled();
  });
});

describe('DownloadPanel — task rows', () => {
  it('renders progress and offers pause for a running download', async () => {
    vi.mocked(api.listDownloads).mockResolvedValue(listing([task()]));
    render(<DownloadPanel />);

    await waitFor(() => {
      expect(screen.getByTestId('download-task-dl_1')).toBeTruthy();
    });
    expect(screen.getByTestId('download-task-status-dl_1').textContent).toBe('下载中');
    expect(screen.getByText(/已下载 250 B \/ 1000 B/)).toBeTruthy();
    expect(screen.getByText(/25%/)).toBeTruthy();

    fireEvent.click(screen.getByText('暂停'));
    await waitFor(() => expect(api.pauseDownload).toHaveBeenCalledWith('dl_1'));
  });

  it('offers resume for a paused download', async () => {
    vi.mocked(api.listDownloads).mockResolvedValue(listing([task({ status: 'paused' })]));
    render(<DownloadPanel />);

    await waitFor(() => expect(screen.getByTestId('download-task-dl_1')).toBeTruthy());
    fireEvent.click(screen.getByText('继续'));
    await waitFor(() => expect(api.resumeDownload).toHaveBeenCalledWith('dl_1'));
  });

  it('surfaces the reason a download failed', async () => {
    vi.mocked(api.listDownloads).mockResolvedValue(
      listing([task({ status: 'error', error: '服务器返回 404。' })]),
    );
    render(<DownloadPanel />);

    expect(await screen.findByText('服务器返回 404。')).toBeTruthy();
    expect(screen.getByTestId('download-task-status-dl_1').textContent).toBe('出错');
  });

  it('offers "用来学习" only for a finished, playable file, and reports the task', async () => {
    const onUseForStudy = vi.fn();
    const done = task({ status: 'done', bytesDone: 1000, filename: 'ep1.mp4' });
    vi.mocked(api.listDownloads).mockResolvedValue(listing([done]));
    render(<DownloadPanel onUseForStudy={onUseForStudy} />);

    const useButton = await screen.findByTestId('download-use-dl_1');
    fireEvent.click(useButton);
    expect(onUseForStudy).toHaveBeenCalledWith(done);
  });

  it('hides "用来学习" while the file is still downloading', async () => {
    vi.mocked(api.listDownloads).mockResolvedValue(listing([task()]));
    render(<DownloadPanel onUseForStudy={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('download-task-dl_1')).toBeTruthy());
    expect(screen.queryByTestId('download-use-dl_1')).toBeNull();
  });

  it('deletes a task through the row button', async () => {
    vi.mocked(api.listDownloads).mockResolvedValue(listing([task({ status: 'canceled' })]));
    render(<DownloadPanel />);

    await waitFor(() => expect(screen.getByTestId('download-task-dl_1')).toBeTruthy());
    fireEvent.click(screen.getByText('删除'));
    await waitFor(() => expect(api.removeDownload).toHaveBeenCalledWith('dl_1'));
  });
});

describe('DownloadPanel — degraded mode', () => {
  it('explains that the local service is required and disables starting', async () => {
    vi.mocked(api.isDownloadAvailable).mockReturnValue(false);
    render(<DownloadPanel />);

    expect(screen.getByText(/start\.bat/)).toBeTruthy();
    expect((screen.getByTestId('download-start') as HTMLButtonElement).disabled).toBe(true);
    // A page without the local service must not pretend it can download.
    expect(api.listDownloads).not.toHaveBeenCalled();
  });
});
