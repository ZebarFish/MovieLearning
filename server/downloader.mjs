/**
 * downloader.mjs — the server half of the download centre.
 *
 * Why this runs on the server, not in the page
 * -------------------------------------------
 * "Download it in the background" is impossible to honour from a browser tab.
 * A client-side <a download> or fetch+Blob dies the moment the user navigates
 * away, and a multi-gigabyte film cannot be held in memory anyway. So the
 * transfer happens here, in the Vite dev/preview process, and the page is only
 * a control surface that polls progress. Closing the tab, switching to the
 * discovery view, or reloading all leave the transfer running.
 *
 * Why a plain .mjs and not TypeScript
 * -----------------------------------
 * The project deliberately does not install `@types/node` — it is what keeps
 * Node globals out of the `src` typecheck (see tsconfig.node.json). A `.ts`
 * file here would need those types. A `.mjs` file is not type-checked at all;
 * `downloader.d.mts` gives `vite.config.ts` a typed handle to the one export
 * it needs.
 *
 * Endpoints (all under `/dl`, all JSON, all errors turned into JSON)
 * -----------------------------------------------------------------
 *   GET  /dl/list                  → { ok, dir, tasks }
 *   POST /dl/start   { url, filename? }
 *   POST /dl/pause   { id }        POST /dl/resume { id }
 *   POST /dl/cancel  { id }        POST /dl/remove { id, deleteFile? }
 *   POST /dl/reveal  { id }
 *   GET  /dl/file/<name>           → byte stream with HTTP Range support
 *
 * The Range support on `/dl/file` is not a nicety: without it a <video> can
 * play the file but cannot seek, which would make the A-B loop and the
 * click-a-subtitle-to-jump feature useless on downloaded media.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOWNLOAD_DIR = path.join(PROJECT_ROOT, 'downloads');
const MANIFEST_PATH = path.join(DOWNLOAD_DIR, '.tasks.json');

/** Plenty of CDNs refuse requests without one. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** How often the smoothed speed estimate is recomputed. */
const SPEED_SAMPLE_MS = 250;
/** Weight of the newest sample in the speed EMA (higher = twitchier). */
const SPEED_SMOOTHING = 0.4;

/** Manifest writes are debounced: progress changes on every chunk. */
const PERSIST_DEBOUNCE_MS = 400;

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.mpd': 'application/dash+xml',
};

const EXT_BY_MIME = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/flac': '.flac',
};

// --- state ------------------------------------------------------------------

/**
 * The public task records, exactly as the client sees them. Runtime-only
 * handles (abort controllers, speed samples) live in `runtime` so this object
 * stays JSON-serialisable for the manifest.
 *
 * @type {Map<string, Record<string, unknown>>}
 */
const tasks = new Map();

/**
 * @type {Map<string, {
 *   controller: AbortController | null,
 *   intent: 'pause' | 'cancel' | null,
 *   speedAt: number,
 *   speedBytes: number,
 *   speedBps: number,
 * }>}
 */
const runtime = new Map();

/** Serialises the manifest so two concurrent writes cannot interleave. */
let persistTimer = null;
let persistInFlight = Promise.resolve();
let readyPromise = null;

// --- small helpers ----------------------------------------------------------

const message = (err) => (err instanceof Error ? err.message : String(err));

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** A request failure the user should see, with the HTTP status to answer with. */
class ApiError extends Error {
  constructor(status, text) {
    super(text);
    this.status = status;
  }
}

async function fileSize(name) {
  try {
    const info = await stat(path.join(DOWNLOAD_DIR, name));
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

/**
 * Strip anything that could escape the downloads directory or upset Windows'
 * filesystem, then drop leading/trailing dots and spaces (Windows silently
 * eats those, which would make the manifest and the disk disagree).
 */
function sanitizeName(input) {
  const stripped = String(input ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  return stripped.slice(0, 180);
}

function nameFromUrl(rawUrl) {
  try {
    const parts = new URL(rawUrl).pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] ?? '');
  } catch {
    return '';
  }
}

/** `filename*=UTF-8''x%20y.mp4` wins over the legacy quoted form. */
function nameFromDisposition(value) {
  const header = String(value ?? '');
  if (!header) return '';
  const extended = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (extended) {
    const raw = extended[1].trim().replace(/^["']|["']$/g, '');
    const encoded = raw.split("''").slice(1).join("''") || raw;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(header);
  return plain ? (plain[1] ?? plain[2] ?? '').trim() : '';
}

function extFromMime(contentType) {
  const base = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  return EXT_BY_MIME[base] ?? '';
}

function mimeFor(name) {
  return MIME_BY_EXT[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

const hasExtension = (name) => /\.[a-z0-9]{2,5}$/i.test(name);

/** Names handed out but not yet on disk — see `allocateName`. */
const reservedNames = new Set();

/**
 * Pick a free filename, appending " (2)" rather than silently clobbering.
 *
 * Three things can already own a name: a file on disk (a previous run, or a
 * finished task), another live task whose first byte has not landed yet, and
 * a concurrent call to this very function. The last one is why the candidate
 * is reserved BEFORE the disk check awaits: two requests started in the same
 * tick would otherwise both observe an empty name, both pick it, and write
 * their streams into one file — a silent corruption.
 */
async function allocateName(desired) {
  const parsed = path.parse(sanitizeName(desired) || 'download');
  const base = parsed.name || 'download';
  const ext = parsed.ext;
  const claimedByTask = (name) =>
    [...tasks.values()].some((task) => task.filename === name && task.status !== 'canceled');
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`;
    if (reservedNames.has(candidate) || claimedByTask(candidate)) continue;
    reservedNames.add(candidate);
    if ((await fileSize(candidate)) === 0) return candidate;
    // A stale file of that name is in the way; the claim stands and we look on.
  }
}

// --- manifest ---------------------------------------------------------------

function touchManifest() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistInFlight = persistInFlight.then(persistManifest).catch(() => undefined);
  }, PERSIST_DEBOUNCE_MS);
}

async function persistManifest() {
  try {
    await mkdir(DOWNLOAD_DIR, { recursive: true });
    const payload = { version: 1, tasks: [...tasks.values()] };
    await writeFile(MANIFEST_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // A failed manifest write is not worth failing a download over.
  }
}

/**
 * Rebuild the task list from disk. A task that was mid-transfer when the
 * server died comes back as `paused` — resumable, not lost.
 */
async function loadManifest() {
  let parsed = null;
  try {
    parsed = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    return;
  }
  const stored = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
  for (const raw of stored) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.filename !== 'string') continue;
    const task = {
      id: raw.id,
      url: String(raw.url ?? ''),
      filename: raw.filename,
      bytesTotal: Number.isFinite(raw.bytesTotal) ? raw.bytesTotal : null,
      bytesDone: Number.isFinite(raw.bytesDone) ? raw.bytesDone : 0,
      status: raw.status === 'canceled' ? 'canceled' : 'paused',
      error: typeof raw.error === 'string' ? raw.error : undefined,
      speedBps: 0,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      updatedAt: Date.now(),
    };
    if (raw.status === 'done') {
      const size = await fileSize(task.filename);
      if (size > 0) {
        task.status = 'done';
        task.bytesDone = size;
        task.bytesTotal = Number.isFinite(raw.bytesTotal) ? raw.bytesTotal : size;
      } else {
        task.status = 'error';
        task.error = '本地文件已不在，需要重新下载。';
      }
    } else {
      // Resumable: trust what is actually on disk over what we remembered.
      task.bytesDone = await fileSize(task.filename);
    }
    tasks.set(task.id, task);
  }
}

function ready() {
  if (!readyPromise) {
    readyPromise = mkdir(DOWNLOAD_DIR, { recursive: true })
      .then(loadManifest)
      .catch(() => undefined);
  }
  return readyPromise;
}

// --- the transfer -----------------------------------------------------------

function newId() {
  return `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function runtimeOf(id) {
  let rt = runtime.get(id);
  if (!rt) {
    rt = { controller: null, intent: null, speedAt: 0, speedBytes: 0, speedBps: 0 };
    runtime.set(id, rt);
  }
  return rt;
}

/** Exponentially smoothed bytes/second — raw per-chunk numbers are unreadable. */
function noteProgress(task, rt) {
  const now = Date.now();
  if (!rt.speedAt) {
    rt.speedAt = now;
    rt.speedBytes = task.bytesDone;
    return;
  }
  const elapsed = now - rt.speedAt;
  if (elapsed < SPEED_SAMPLE_MS) return;
  const instant = ((task.bytesDone - rt.speedBytes) / elapsed) * 1000;
  rt.speedBps = rt.speedBps
    ? rt.speedBps * (1 - SPEED_SMOOTHING) + instant * SPEED_SMOOTHING
    : instant;
  task.speedBps = Math.max(0, Math.round(rt.speedBps));
  rt.speedAt = now;
  rt.speedBytes = task.bytesDone;
  task.updatedAt = now;
  touchManifest();
}

function settle(task, status, errorText) {
  task.status = status;
  task.error = errorText;
  task.speedBps = 0;
  task.updatedAt = Date.now();
  const rt = runtime.get(task.id);
  if (rt) {
    rt.controller = null;
    rt.intent = null;
  }
  touchManifest();
}

/** Total size, from `Content-Range` when present, else `Content-Length`+offset. */
function totalFrom(res, offset) {
  const range = /\/\s*(\d+)\s*$/.exec(String(res.headers.get('content-range') ?? ''));
  if (range) return Number(range[1]);
  const length = res.headers.get('content-length');
  if (length === null) return null;
  const parsed = Number(length);
  return Number.isFinite(parsed) ? parsed + offset : null;
}

/** A request with a specific byte offset. `redirect: 'follow'` is the default. */
async function open(url, offset, signal) {
  const headers = { 'User-Agent': USER_AGENT };
  if (offset > 0) headers.Range = `bytes=${offset}-`;
  return fetch(url, { headers, signal });
}

/**
 * Run (or resume) one transfer, from its current offset through to the end.
 *
 * The subtle part is what a server does with our `Range` header. A 206 means
 * it honoured the offset and we APPEND. A 200 means it ignored the header
 * entirely and is about to send the whole file from byte zero — appending then
 * would corrupt the file with a duplicate prefix, so we truncate and restart.
 */
async function transfer(task, resume) {
  const rt = runtimeOf(task.id);
  const controller = new AbortController();
  rt.controller = controller;
  rt.intent = null;
  rt.speedAt = 0;
  rt.speedBytes = 0;
  rt.speedBps = 0;

  task.status = 'downloading';
  task.error = undefined;
  task.updatedAt = Date.now();
  touchManifest();

  let offset = 0;
  if (resume) {
    const onDisk = await fileSize(task.filename);
    const complete = task.bytesTotal !== null && onDisk >= task.bytesTotal;
    if (onDisk > 0 && !complete) offset = onDisk;
  }

  let res;
  try {
    res = await open(task.url, offset, controller.signal);
  } catch (err) {
    if (controller.signal.aborted) return;
    settle(task, 'error', `无法连接下载地址：${message(err)}`);
    return;
  }

  if (offset > 0 && res.status !== 206) {
    // The server ignored Range; start over rather than corrupt the file.
    try {
      await res.body?.cancel();
    } catch {
      // the body was already gone; nothing to release
    }
    offset = 0;
    try {
      res = await open(task.url, 0, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return;
      settle(task, 'error', `无法连接下载地址：${message(err)}`);
      return;
    }
  }

  if (!res.ok) {
    settle(task, 'error', `下载地址返回 ${res.status}${res.statusText ? ` ${res.statusText}` : ''}。`);
    return;
  }
  if (!res.body) {
    settle(task, 'error', '下载地址没有返回文件内容。');
    return;
  }

  // The URL often carries no usable name (`…/download?id=7`); now that the
  // headers are in, prefer what the server says the file is called.
  if (!hasExtension(task.filename)) {
    const suggested = sanitizeName(nameFromDisposition(res.headers.get('content-disposition')));
    const ext = extFromMime(res.headers.get('content-type'));
    if (suggested) {
      task.filename = await allocateName(hasExtension(suggested) ? suggested : suggested + ext);
    } else if (ext) {
      task.filename = await allocateName(task.filename + ext);
    }
  }

  task.bytesTotal = totalFrom(res, offset);
  task.bytesDone = offset;
  const absolute = path.join(DOWNLOAD_DIR, task.filename);
  // 'a' appends at the current end of file, which is exactly our offset.
  const out = createWriteStream(absolute, { flags: offset > 0 ? 'a' : 'w' });

  try {
    for await (const chunk of res.body) {
      if (controller.signal.aborted) break;
      const buffer = Buffer.from(chunk);
      if (!out.write(buffer)) await once(out, 'drain');
      task.bytesDone += buffer.length;
      noteProgress(task, rt);
    }
    out.end();
    await finished(out);
  } catch (err) {
    out.destroy();
    if (controller.signal.aborted) {
      // pause / cancel — the handler has already set the terminal status
      const intent = rt.intent;
      rt.controller = null;
      rt.intent = null;
      if (intent === 'cancel') {
        await safeUnlink(absolute);
        settle(task, 'canceled', undefined);
      } else {
        task.bytesDone = await fileSize(task.filename);
        settle(task, 'paused', undefined);
      }
      return;
    }
    settle(task, 'error', `下载中断：${message(err)}`);
    return;
  }

  if (controller.signal.aborted) {
    if (rt.intent === 'cancel') {
      await safeUnlink(absolute);
      settle(task, 'canceled', undefined);
    } else {
      task.bytesDone = await fileSize(task.filename);
      settle(task, 'paused', undefined);
    }
    return;
  }

  const written = await fileSize(task.filename);
  task.bytesDone = written;
  if (task.bytesTotal !== null && written < task.bytesTotal) {
    settle(task, 'error', `下载不完整：只收到 ${written} / ${task.bytesTotal} 字节。`);
    return;
  }
  if (task.bytesTotal === null) task.bytesTotal = written;
  settle(task, 'done', undefined);
}

async function safeUnlink(abs) {
  try {
    await unlink(abs);
  } catch {
    // already gone
  }
}

// --- request handling -------------------------------------------------------

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const publicTask = (task) => ({ ...task });

async function handleStart(body) {
  const url = String(body.url ?? '').trim();
  if (!url) throw new ApiError(400, '请填写视频直链地址。');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError(400, '这不是一个有效的网址。');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError(400, '只支持 http / https 直链。');
  }

  const existing = [...tasks.values()].find(
    (t) => t.url === url && (t.status === 'downloading' || t.status === 'paused'),
  );
  if (existing) throw new ApiError(409, '这个地址已经在下载列表里了。');

  const finished = [...tasks.values()].find((t) => t.url === url && t.status === 'done');
  if (finished && (await fileSize(finished.filename)) > 0) {
    return finished;
  }

  const requested = sanitizeName(body.filename ?? '');
  const derived = requested || sanitizeName(nameFromUrl(url)) || 'download';
  const task = {
    id: newId(),
    url,
    filename: await allocateName(derived),
    bytesTotal: null,
    bytesDone: 0,
    status: 'downloading',
    error: undefined,
    speedBps: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.set(task.id, task);
  touchManifest();
  void transfer(task, false);
  return task;
}

function findTask(id) {
  const task = tasks.get(String(id ?? ''));
  if (!task) throw new ApiError(404, '找不到这个下载任务。');
  return task;
}

function handlePause(body) {
  const task = findTask(body.id);
  if (task.status !== 'downloading') return task;
  const rt = runtime.get(task.id);
  if (rt?.controller) {
    rt.intent = 'pause';
    rt.controller.abort();
  } else {
    settle(task, 'paused', undefined);
  }
  return task;
}

function handleResume(body) {
  const task = findTask(body.id);
  if (task.status === 'downloading') return task;
  void transfer(task, true);
  return task;
}

function handleCancel(body) {
  const task = findTask(body.id);
  if (task.status === 'downloading') {
    const rt = runtime.get(task.id);
    if (rt?.controller) rt.intent = 'cancel';
    // `transfer` observes the abort and performs the unlink + status change.
    rt?.controller?.abort();
    return task;
  }
  void safeUnlink(path.join(DOWNLOAD_DIR, task.filename)).then(() =>
    settle(task, 'canceled', undefined),
  );
  return task;
}

async function handleRemove(body) {
  const task = findTask(body.id);
  const rt = runtime.get(task.id);
  if (task.status === 'downloading' && rt?.controller) {
    rt.intent = 'cancel';
    rt.controller.abort();
  }
  if (body.deleteFile !== false) {
    await safeUnlink(path.join(DOWNLOAD_DIR, task.filename));
    reservedNames.delete(task.filename);
  }
  tasks.delete(task.id);
  runtime.delete(task.id);
  touchManifest();
}

/**
 * `Range: bytes=0-99` | `bytes=100-` | `bytes=-500` (suffix). Returns null for
 * "no range asked for" and the string 'invalid' for a range we must answer 416.
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return 'invalid';

  let start;
  let end;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
  if (start >= size || end < start) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

function pipeFile(abs, res, start, end) {
  const stream =
    start === undefined ? createReadStream(abs) : createReadStream(abs, { start, end });
  stream.on('error', () => {
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  // Without this the read stream keeps the file handle alive after the
  // browser aborts a seek.
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

async function serveFile(req, res, encodedName) {
  let name;
  try {
    name = decodeURIComponent(encodedName);
  } catch {
    name = encodedName;
  }
  // Reject anything that is not a plain filename: no separators, no traversal,
  // and no dotfiles (which is what keeps `.tasks.json` unreadable from here).
  if (!name || name.startsWith('.') || path.basename(name) !== name) {
    res.statusCode = 403;
    sendJson(res, 403, { ok: false, error: '不允许访问该文件。' });
    return;
  }
  const abs = path.resolve(DOWNLOAD_DIR, name);
  const relative = path.relative(DOWNLOAD_DIR, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    sendJson(res, 403, { ok: false, error: '不允许访问该文件。' });
    return;
  }

  let info;
  try {
    info = await stat(abs);
  } catch {
    sendJson(res, 404, { ok: false, error: '文件不存在。' });
    return;
  }
  if (!info.isFile()) {
    sendJson(res, 404, { ok: false, error: '文件不存在。' });
    return;
  }

  const size = info.size;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeFor(name));

  const range = parseRange(req.headers?.range, size);
  if (range === 'invalid') {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${size}`);
    res.end();
    return;
  }
  if (!range) {
    res.statusCode = 200;
    res.setHeader('Content-Length', String(size));
    pipeFile(abs, res, undefined, undefined);
    return;
  }
  res.statusCode = 206;
  res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  res.setHeader('Content-Length', String(range.end - range.start + 1));
  pipeFile(abs, res, range.start, range.end);
}

/** Best-effort "show me the folder"; the answer is `ok` either way. */
function handleReveal(body) {
  const task = findTask(body.id);
  const abs = path.join(DOWNLOAD_DIR, task.filename);
  try {
    const child = spawn('explorer', [abs], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // ignore — the UI only uses this as a convenience
  }
}

async function handle(req, res) {
  const parsed = new URL(String(req.url ?? ''), 'http://localhost');
  const route = parsed.pathname.replace(/\/+$/, '') || '/';
  const method = String(req.method ?? 'GET').toUpperCase();

  if (route === '/list' && method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      dir: DOWNLOAD_DIR,
      tasks: [...tasks.values()].map(publicTask),
    });
    return;
  }
  if (route.startsWith('/file/') && method === 'GET') {
    await serveFile(req, res, route.slice('/file/'.length));
    return;
  }

  if (method === 'POST') {
    const body = await readJsonBody(req);
    if (route === '/start') {
      sendJson(res, 200, { ok: true, task: publicTask(await handleStart(body)) });
      return;
    }
    if (route === '/pause') {
      sendJson(res, 200, { ok: true, task: publicTask(handlePause(body)) });
      return;
    }
    if (route === '/resume') {
      sendJson(res, 200, { ok: true, task: publicTask(handleResume(body)) });
      return;
    }
    if (route === '/cancel') {
      sendJson(res, 200, { ok: true, task: publicTask(handleCancel(body)) });
      return;
    }
    if (route === '/remove') {
      await handleRemove(body);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (route === '/reveal') {
      handleReveal(body);
      sendJson(res, 200, { ok: true });
      return;
    }
  }

  sendJson(res, 404, { ok: false, error: '未知的下载接口。' });
}

/**
 * Mount the whole thing on a Vite dev or preview server. Called from
 * `vite.config.ts` for both, so the feature works in `vite dev` and in the
 * `vite preview` build that `start.bat` launches.
 */
export function registerDownloadService(server) {
  void ready();
  server.middlewares.use('/dl', (req, res) => {
    void ready()
      .then(() => handle(req, res))
      .catch((err) => {
        if (err instanceof ApiError) {
          sendJson(res, err.status, { ok: false, error: err.message });
          return;
        }
        sendJson(res, 500, { ok: false, error: `服务器内部错误：${message(err)}` });
      });
  });
}
