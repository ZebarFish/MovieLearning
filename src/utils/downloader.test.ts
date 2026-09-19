/**
 * downloader.test.ts
 *
 * The client half of the download centre is a thin, well-behaved wrapper around
 * a local HTTP API, so what matters here is the contract: the right verb and
 * body reach `/dl/*`, a server-side refusal surfaces as a readable Chinese
 * message rather than a silent no-op, and the formatters the UI leans on stay
 * honest at their boundaries. `fetch` is stubbed per test — the real network is
 * never touched, and neither is the real /dl server.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `USE_LOCAL_PROXY` is derived from the runtime hostname, which is never
 * localhost under jsdom, and the client refuses to call anything when it is
 * false. Tests therefore need to control it — and since `vi.mock` factories are
 * hoisted above the imports, the flag has to be hoisted with them.
 */
const state = vi.hoisted(() => ({ localServer: true }));

vi.mock('./localProxy', () => ({
  IS_TEST: true,
  SERVED_LOCALLY: true,
  get USE_LOCAL_PROXY() {
    return state.localServer;
  },
}));

import {
  DownloadApiError,
  describeProgress,
  downloadFileUrl,
  formatBytes,
  formatSpeed,
  isDownloadAvailable,
  listDownloads,
  progressPercent,
  removeDownload,
  startDownload,
  statusLabel,
} from './downloader';
import type { DownloadTask } from './downloader';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: 'dl_1',
    url: 'https://example.com/a.mp4',
    filename: 'a.mp4',
    bytesTotal: 1000,
    bytesDone: 0,
    status: 'downloading',
    speedBps: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** Install a fetch stub, typed so `mock.calls` stays inspectable at the call site. */
function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock as unknown as typeof fetch);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  state.localServer = true;
});

describe('isDownloadAvailable', () => {
  it('follows the local-server decision, and refuses to call anything without it', async () => {
    state.localServer = false;
    expect(isDownloadAvailable()).toBe(false);

    const fetchMock = stubFetch(async () => jsonResponse({}));
    await expect(startDownload('https://example.com/a.mp4')).rejects.toThrow(
      '下载功能需要本机服务支持。',
    );
    // The refusal must happen before any request leaves the page.
    expect(fetchMock).not.toHaveBeenCalled();

    state.localServer = true;
    expect(isDownloadAvailable()).toBe(true);
  });
});

describe('startDownload', () => {
  it('POSTs the url as JSON and returns the created task', async () => {
    const created = task({ id: 'dl_new', filename: 'movie.mp4' });
    const fetchMock = stubFetch(async () => jsonResponse({ ok: true, task: created }));

    const result = await startDownload('https://example.com/v.mp4', '电影.mp4');

    expect(result).toEqual(created);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/dl/start');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      url: 'https://example.com/v.mp4',
      filename: '电影.mp4',
    });
  });

  it('omits a blank filename so the server can name the file itself', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ ok: true, task: task() }));
    await startDownload('https://example.com/v.mp4', '   ');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://example.com/v.mp4' });
  });

  it("surfaces the server's refusal as a typed, readable error", async () => {
    stubFetch(async () =>
      jsonResponse({ ok: false, error: '这个地址已经在下载列表里了。' }, 409),
    );

    await expect(startDownload('https://example.com/v.mp4')).rejects.toMatchObject({
      message: '这个地址已经在下载列表里了。',
      status: 409,
    });
  });

  it('falls back to a generic message when the failure is not JSON', async () => {
    stubFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    }) as unknown as Response);

    const failure = await startDownload('https://example.com/v.mp4').catch((e) => e);
    expect(failure).toBeInstanceOf(DownloadApiError);
    expect((failure as DownloadApiError).status).toBe(500);
    expect((failure as DownloadApiError).message).toContain('500');
  });

  it('explains a dead local server instead of throwing a bare TypeError', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(startDownload('https://example.com/v.mp4')).rejects.toThrow(
      '无法连接本机下载服务，请确认应用正在运行。',
    );
  });
});

describe('listDownloads', () => {
  it('returns the directory and the tasks', async () => {
    stubFetch(async () =>
      jsonResponse({ ok: true, dir: 'C:/p/downloads', tasks: [task(), task({ id: 'dl_2' })] }),
    );
    const listing = await listDownloads();
    expect(listing.dir).toBe('C:/p/downloads');
    expect(listing.tasks).toHaveLength(2);
  });

  it('degrades to an empty list rather than crashing on a malformed payload', async () => {
    stubFetch(async () => jsonResponse({ ok: true, tasks: 'nope' }));
    const listing = await listDownloads();
    expect(listing.tasks).toEqual([]);
    expect(listing.dir).toBe('');
  });
});

describe('removeDownload', () => {
  it('deletes the file by default, and can be told to keep it', async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ ok: true }));

    await removeDownload('dl_1');
    await removeDownload('dl_1', false);

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies[0]).toEqual({ id: 'dl_1', deleteFile: true });
    expect(bodies[1]).toEqual({ id: 'dl_1', deleteFile: false });
  });
});

describe('downloadFileUrl', () => {
  it('encodes the filename so spaces and CJK survive the round trip', () => {
    expect(downloadFileUrl('a b.mp4')).toBe('/dl/file/a%20b.mp4');
    expect(downloadFileUrl('电影.mp4')).toBe(`/dl/file/${encodeURIComponent('电影.mp4')}`);
  });
});

describe('formatBytes', () => {
  it('renders unknown sizes as an em dash rather than NaN', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });

  it('steps through the units at 1024', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
  });
});

describe('formatSpeed', () => {
  it('shows nothing useful as an em dash', () => {
    expect(formatSpeed(0)).toBe('—');
    expect(formatSpeed(-5)).toBe('—');
    expect(formatSpeed(Number.NaN)).toBe('—');
  });

  it('appends a per-second suffix', () => {
    expect(formatSpeed(2048)).toBe('2.0 KB/s');
  });
});

describe('progress helpers', () => {
  it('reports a percentage only when the total is known', () => {
    expect(progressPercent(task({ bytesDone: 250, bytesTotal: 1000 }))).toBe(25);
    expect(progressPercent(task({ bytesDone: 250, bytesTotal: null }))).toBeNull();
    // A runaway counter must not push the bar past 100%.
    expect(progressPercent(task({ bytesDone: 2000, bytesTotal: 1000 }))).toBe(100);
  });

  it('describes partial progress with and without a total', () => {
    expect(describeProgress(task({ bytesDone: 0, bytesTotal: 2048 }))).toBe('已下载 0 B / 2.0 KB');
    expect(describeProgress(task({ bytesDone: 2048, bytesTotal: null }))).toBe('已下载 2.0 KB');
  });

  it('labels every status the server can send, in Chinese', () => {
    expect(statusLabel('downloading')).toBe('下载中');
    expect(statusLabel('paused')).toBe('已暂停');
    expect(statusLabel('done')).toBe('已完成');
    expect(statusLabel('error')).toBe('出错');
    expect(statusLabel('canceled')).toBe('已取消');
  });
});
