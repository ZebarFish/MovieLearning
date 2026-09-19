/**
 * dictionary.mjs — the offline ECDICT lookup service, mounted on the Vite
 * dev/preview server. This is the "level 0" word source: a hit returns
 * instantly from disk with zero network round-trips, so the page can show a
 * definition the moment the user clicks a word instead of spinning on the
 * online dictionaryapi/Youdao/Datamuse chain.
 *
 * Why a plain .mjs (same reasoning as downloader.mjs)
 * ------------------------------------------------
 * The project deliberately does not install `@types/node`; a `.ts` file here
 * would need those globals. A `.mjs` is not type-checked at all, and
 * `dictionary.d.mts` gives `vite.config.ts` a typed handle to the one export.
 *
 * How it stays cheap
 * ------------------
 * At startup we load ONLY `ecdict.off` — a ~13.6 MB table of byte offsets, one
 * per record. The 222 MB `ecdict.dat` of record text is NEVER read into memory;
 * a query binary-searches the offset table, seeks to the one record it needs,
 * reads a few hundred bytes, and that is all. If the index is missing the
 * server still boots — every endpoint degrades to a JSON error instead of
 * throwing through Vite.
 *
 * Endpoints (all JSON, never throw into the middleware)
 * ----------------------------------------------------
 *   GET /dict/offline/status        → { ready, count, builtAt }
 *   GET /dict/offline?w=<word>      → hit: 200 { word, phonetic, translation,
 *                                       definition, pos, collins, oxford, tag,
 *                                       bnc, frq, exchange }
 *                                     miss: 404 { found: false }
 *                                     empty w: 400
 *                                     no index: 503 { error: "index-not-built" }
 *
 * Note on routing: this mounts at `/dict`. The existing proxy rules
 * (`/dict/api`, `/dict/youdao`, `/dict/datamuse`, `/dict/mymemory`) do not
 * match `/dict/offline`, so they are unaffected; for any `/dict/*` path we do
 * not own we call `next()` and let the proxy handle it.
 */
import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX_DIR = new URL('../data/ecdict/index/', import.meta.url);
const DAT_URL = new URL('ecdict.dat', INDEX_DIR);
const OFF_URL = new URL('ecdict.off', INDEX_DIR);
const META_URL = new URL('meta.json', INDEX_DIR);

const NL = 0x0a;
const CR = 0x0d;

/**
 * @type {{
 *   loaded: boolean,
 *   ready: boolean,
 *   off: Uint32Array | null,
 *   fh: import('node:fs/promises').FileHandle | null,
 *   count: number,
 *   builtAt: string | null,
 * }}
 */
const state = {
  loaded: false,
  ready: false,
  off: null,
  fh: null,
  count: 0,
  builtAt: null,
};

let loadPromise = null;

/** RFC-4180-ish CSV line parser, shared with the index builder. */
function parseCsvLine(input) {
  const line = typeof input === 'string' ? input : input.toString('utf8');
  const fields = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/** Load the offset table once. Missing index is not fatal — it just disables lookups. */
async function loadIndex() {
  let offBuf;
  try {
    offBuf = await readFile(OFF_URL);
  } catch {
    state.loaded = true;
    state.ready = false;
    // eslint-disable-next-line no-console
    console.warn(
      '[dictionary] 离线词典索引未构建，已回退到在线查词。先跑 `npm run dict:index` 生成索引。',
    );
    return;
  }
  const off = new Uint32Array(offBuf.buffer, offBuf.byteOffset, offBuf.byteLength / 4);
  let fh = null;
  try {
    fh = await open(DAT_URL, 'r');
  } catch {
    state.loaded = true;
    state.ready = false;
    console.warn('[dictionary] 离线词典索引不完整（缺 ecdict.dat），先跑 `npm run dict:index`。');
    return;
  }
  let meta = null;
  try {
    meta = JSON.parse(await readFile(META_URL, 'utf8'));
  } catch {
    meta = null;
  }
  state.off = off;
  state.fh = fh;
  state.count = off.length;
  state.builtAt = meta?.builtAt ?? null;
  state.ready = true;
  state.loaded = true;
}

function ensureIndex() {
  if (!loadPromise) loadPromise = loadIndex();
  return loadPromise;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** Read the raw record text for row `i` straight from disk (no full-file load). */
async function readFullLine(i) {
  const off = state.off;
  const start = off[i];
  const next = i + 1 < off.length ? off[i + 1] : (await stat(DAT_URL)).size;
  const len = next - start;
  const buf = Buffer.alloc(len);
  const { bytesRead } = await state.fh.read(buf, 0, len, start);
  let end = bytesRead;
  if (end > 0 && buf[end - 1] === NL) end -= 1;
  if (end > 0 && buf[end - 1] === CR) end -= 1;
  return buf.subarray(0, end);
}

/** Read just the `word` field of row `i` for the binary-search comparison. */
async function readWordAt(i) {
  const start = state.off[i];
  const WINDOW = 16384;
  const buf = Buffer.alloc(WINDOW);
  const { bytesRead } = await state.fh.read(buf, 0, WINDOW, start);
  const sub = buf.subarray(0, bytesRead);
  const nl = sub.indexOf(NL);
  let end = nl >= 0 ? nl : sub.length;
  if (end > 0 && sub[end - 1] === CR) end -= 1;
  return (parseCsvLine(sub.subarray(0, end))[0] || '').toLowerCase();
}

/** Standard binary search over the offset table (sorted by lowercase word). */
async function findRow(target) {
  const off = state.off;
  const n = off.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const w = await readWordAt(mid);
    if (w < target) lo = mid + 1;
    else if (w > target) hi = mid - 1;
    else return mid;
  }
  return -1;
}

async function handle(req, res, next) {
  const parsed = new URL(String(req.url ?? ''), 'http://localhost');
  // NOTE: connect strips the mount prefix (`/dict`) from `req.url`, so what we
  // see here is relative to it: `/offline/status`, `/offline?w=...`, and the
  // proxy routes arrive as `/api/...`, `/youdao/...`, etc.
  const pathname = parsed.pathname.replace(/\/+$/, '');
  const method = String(req.method ?? 'GET').toUpperCase();

  if (method !== 'GET') {
    next();
    return;
  }

  if (pathname === '/offline/status') {
    sendJson(res, 200, { ready: state.ready, count: state.count, builtAt: state.builtAt });
    return;
  }

  if (pathname === '/offline') {
    if (!state.ready) {
      sendJson(res, 503, { error: 'index-not-built' });
      return;
    }
    const w = (parsed.searchParams.get('w') ?? '').trim();
    if (!w) {
      sendJson(res, 400, { error: 'missing-word' });
      return;
    }
    const idx = await findRow(w.toLowerCase());
    if (idx < 0) {
      sendJson(res, 404, { found: false });
      return;
    }
    const fields = parseCsvLine(await readFullLine(idx));
    sendJson(res, 200, {
      word: fields[0] ?? '',
      phonetic: fields[1] ?? '',
      translation: fields[3] ?? '',
      definition: fields[2] ?? '',
      pos: fields[4] ?? '',
      collins: fields[5] ?? '',
      oxford: fields[6] ?? '',
      tag: fields[7] ?? '',
      bnc: fields[8] ?? '',
      frq: fields[9] ?? '',
      exchange: fields[10] ?? '',
    });
    return;
  }

  // Anything else under /dict (e.g. /api, /youdao, the proxies) — let Vite handle it.
  next();
}

/**
 * Mount the offline dictionary on a Vite dev or preview server. Called from
 * `vite.config.ts` for both, so it works in `vite dev` and in the `vite preview`
 * build that `start.bat` launches.
 */
export function registerDictionaryService(server) {
  void ensureIndex();
  server.middlewares.use('/dict', (req, res, next) => {
    void ensureIndex()
      .then(() => handle(req, res, next))
      .catch(() => {
        if (!res.headersSent) sendJson(res, 500, { error: 'server-error' });
      });
  });
}
