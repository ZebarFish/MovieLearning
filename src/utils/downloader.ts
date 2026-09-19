/**
 * downloader.ts — browser-side client for the server's download service.
 *
 * The transfer itself runs in the Vite dev/preview process (`server/downloader.mjs`),
 * so these calls only ever start, steer and poll it. That is what makes a
 * "background" download meaningful: closing the tab does not stop it.
 *
 * Everything here is therefore only usable when the page is served from this
 * machine — the downloads live on this machine's disk. `isDownloadAvailable()`
 * reports that, and the UI explains the situation rather than failing obscurely.
 */
import { USE_LOCAL_PROXY } from './localProxy';

export type DownloadStatus = 'downloading' | 'paused' | 'done' | 'error' | 'canceled';

export interface DownloadTask {
  id: string;
  url: string;
  /** Name of the file inside the downloads directory. */
  filename: string;
  /** `null` while the server has not told us a size yet. */
  bytesTotal: number | null;
  bytesDone: number;
  status: DownloadStatus;
  error?: string;
  speedBps: number;
  createdAt: number;
  updatedAt: number;
}

export interface DownloadListing {
  dir: string;
  tasks: DownloadTask[];
}

const BASE = '/dl';

/** An error carrying the status the server answered with, message in Chinese. */
export class DownloadApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'DownloadApiError';
    this.status = status;
  }
}

/** True when the local server can handle `/dl/*` (i.e. we're on localhost). */
export function isDownloadAvailable(): boolean {
  return USE_LOCAL_PROXY;
}

/**
 * What a request means when the answer is not our JSON at all: the request did
 * reach *a* server, but not the download service.
 *
 * This is not hypothetical — `vite preview` reads its config once at startup,
 * so an app launched before this feature existed keeps serving `/dl/*` from the
 * SPA fallback and hands back `index.html`. The user gets a "download is
 * broken" panel after an update unless we say what actually happened.
 */
const SERVICE_NOT_READY =
  '本机服务的下载接口未就绪。请关闭应用后重新启动（双击 start.bat），再试一次。';

/** Read the body as JSON, or `undefined` when it is not JSON at all. */
async function readJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorMessageFrom(body: unknown, fallback: string): string {
  const candidate = (body as { error?: unknown } | undefined)?.error;
  if (typeof candidate === 'string' && candidate.trim()) return candidate;
  return fallback;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isDownloadAvailable()) {
    throw new DownloadApiError(0, '下载功能需要本机服务支持。');
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new DownloadApiError(0, '无法连接本机下载服务，请确认应用正在运行。');
  }

  const body = await readJsonBody(res);
  if (!res.ok) {
    throw new DownloadApiError(res.status, errorMessageFrom(body, `请求失败（${res.status}）。`));
  }
  if (body === undefined) {
    throw new DownloadApiError(res.status, SERVICE_NOT_READY);
  }
  return body as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function listDownloads(): Promise<DownloadListing> {
  const data = await requestJson<{ dir?: unknown; tasks?: unknown }>('/list');
  return {
    dir: typeof data.dir === 'string' ? data.dir : '',
    tasks: Array.isArray(data.tasks) ? (data.tasks as DownloadTask[]) : [],
  };
}

export async function startDownload(url: string, filename?: string): Promise<DownloadTask> {
  const payload: { url: string; filename?: string } = { url };
  const trimmed = filename?.trim();
  if (trimmed) payload.filename = trimmed;
  const data = await post<{ task: DownloadTask }>('/start', payload);
  return data.task;
}

export async function pauseDownload(id: string): Promise<DownloadTask> {
  return (await post<{ task: DownloadTask }>('/pause', { id })).task;
}

export async function resumeDownload(id: string): Promise<DownloadTask> {
  return (await post<{ task: DownloadTask }>('/resume', { id })).task;
}

export async function cancelDownload(id: string): Promise<DownloadTask> {
  return (await post<{ task: DownloadTask }>('/cancel', { id })).task;
}

export async function removeDownload(id: string, deleteFile = true): Promise<void> {
  await post<{ ok: boolean }>('/remove', { id, deleteFile });
}

/** Open the file's folder in the OS file manager. Best-effort. */
export async function revealDownload(id: string): Promise<void> {
  await post<{ ok: boolean }>('/reveal', { id });
}

/**
 * The URL a downloaded file can be played from. The server answers with Range
 * support, so a `<video>` pointed here can seek like any other source.
 */
export function downloadFileUrl(filename: string): string {
  return `${BASE}/file/${encodeURIComponent(filename)}`;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** `—` for an unknown size, else a compact human figure (`1.2 MB`). */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** Transfer rate, or `—` when nothing is moving. */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
  return `${formatBytes(bytesPerSecond)}/s`;
}

const STATUS_LABELS: Record<DownloadStatus, string> = {
  downloading: '下载中',
  paused: '已暂停',
  done: '已完成',
  error: '出错',
  canceled: '已取消',
};

export function statusLabel(status: DownloadStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/** `已下载 12.0 MB / 80.0 MB` (or just the downloaded part when size is unknown). */
export function describeProgress(task: DownloadTask): string {
  const done = formatBytes(task.bytesDone);
  if (task.bytesTotal === null) return `已下载 ${done}`;
  return `已下载 ${done} / ${formatBytes(task.bytesTotal)}`;
}

/** 0–100, or null when the total is unknown (render an indeterminate bar). */
export function progressPercent(task: DownloadTask): number | null {
  if (task.bytesTotal === null || task.bytesTotal <= 0) return null;
  return Math.min(100, Math.round((task.bytesDone / task.bytesTotal) * 100));
}

/** True for media files we can hand straight to the study stage. */
export function isPlayableMedia(filename: string): boolean {
  return /\.(mp4|m4v|webm|mkv|mov|avi|flv|mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i.test(filename);
}
