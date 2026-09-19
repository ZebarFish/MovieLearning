/**
 * build-dict-index.mjs — turn the 222 MB ECDICT CSV into a seekable, offline
 * word index that `server/dictionary.mjs` can binary-search without loading
 * the whole thing into memory and without any native dependency.
 *
 * Why raw CSV lines (not JSONL)
 * -----------------------------
 * The source is one record per line. Keeping `ecdict.dat` as the *original*
 * CSV line (no re-serialisation, no quoting churn) keeps it at ~222 MB. Going
 * through JSONL would blow that up to ~1.4 GB for no benefit, since the
 * reader already ships a CSV parser it reuses for both the probe and the hit.
 *
 * Why an external sort
 * --------------------
 * 3.4M rows must never all live in the heap as objects. So we:
 *   1. Stream the CSV once, collecting `(lowercaseKey, byteOffsetInCsv)` in
 *      chunks of ~CHUNK_SIZE. Sort each chunk, spill it to a temp chunk file
 *      as `<key>\t<offset>` lines. Only strings + numbers per chunk → cheap.
 *   2. k-way merge the sorted chunks. For every merged entry we seek back into
 *      the source CSV at its recorded offset, read just that one line, and
 *      append it to `ecdict.dat`, recording the write pointer in `ecdict.off`.
 * Peak heap stays well under 200 MB (a few chunk buffers + one 13.6 MB offset
 * table). Temp chunk files are deleted at the end.
 *
 * Idempotent: re-running wipes the old chunks/output and rebuilds from scratch.
 *
 * Run with: `npm run dict:index`  (Node 20+; no extra deps).
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { open, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = path.join(ROOT, 'data', 'ecdict', 'stardict', 'stardict.csv');
const INDEX_DIR = path.join(ROOT, 'data', 'ecdict', 'index');
const CHUNK_DIR = path.join(INDEX_DIR, '_chunks');
const DAT_PATH = path.join(INDEX_DIR, 'ecdict.dat');
const OFF_PATH = path.join(INDEX_DIR, 'ecdict.off');
const META_PATH = path.join(INDEX_DIR, 'meta.json');

/** Rows per on-disk sorted run. ~12 runs for 3.4M; keeps each chunk in RAM cheaply. */
const CHUNK_SIZE = 300_000;

const NL = 0x0a;
const CR = 0x0d;

function die(msg) {
  process.stderr.write(`[build-dict-index] ${msg}\n`);
  process.exit(1);
}

/** A tiny RFC-4180-ish CSV line parser. Fields separated by commas; a field
 *  wrapped in `"` may contain commas and escaped `""`. The literal `\n` that
 *  ECDICT stores inside translation/definition is just two ordinary chars here
 *  (real newlines never appear mid-record — that is why streaming by line works). */
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

/**
 * Streaming line reader. Yields `{ line: Buffer (no trailing \n or \r), start }`
 * where `start` is the absolute byte offset of the line within the file. Lines
 * that span chunk boundaries are reassembled; the offset always points at the
 * first byte of the record so a later seek reproduces it exactly.
 */
class LineReader {
  constructor(stream) {
    this.stream = stream;
    this.buf = Buffer.alloc(0);
    this.base = 0; // absolute offset of buf[0]
    this.finished = false;
    this.err = null;
    this.waiters = [];
    stream.on('data', (c) => {
      this.buf = Buffer.concat([this.buf, c]);
      this._release();
    });
    stream.on('end', () => {
      this.finished = true;
      this._release();
    });
    stream.on('error', (e) => {
      this.err = e;
      this._release();
    });
  }

  _release() {
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve();
  }

  _wait() {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async next() {
    for (;;) {
      const nl = this.buf.indexOf(NL);
      if (nl >= 0) {
        let end = nl;
        if (end > 0 && this.buf[end - 1] === CR) end -= 1;
        const line = this.buf.subarray(0, end);
        const start = this.base;
        this.buf = this.buf.subarray(nl + 1);
        this.base += nl + 1;
        return { line, start };
      }
      if (this.finished) {
        if (this.buf.length > 0) {
          let end = this.buf.length;
          if (end > 0 && this.buf[end - 1] === CR) end -= 1;
          const line = this.buf.subarray(0, end);
          const start = this.base;
          this.buf = Buffer.alloc(0);
          this.base += line.length;
          return { line, start };
        }
        return null;
      }
      if (this.err) throw this.err;
      await this._wait();
    }
  }
}

/** Write one sorted run to disk as `<key>\t<offset>` lines. */
async function flushChunk(index, keys, offs) {
  const order = Array.from(keys.keys());
  order.sort((a, b) => (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : 0));
  const lines = order.map((i) => `${keys[i]}\t${offs[i]}`);
  const content = lines.join('\n') + '\n';
  const file = path.join(CHUNK_DIR, `chunk_${index}.txt`);
  await writeFile(file, content, 'utf8');
  return file;
}

/** Read a single CSV record starting at `offset` by locating the next `\n`.
 *  Small fixed read (records are short); falls back to more reads if a record
 *  ever exceeds the window. Strips a trailing CR so ecdict.dat stays clean. */
async function readCsvLineAt(fh, offset) {
  const WINDOW = 65536;
  let collected = Buffer.alloc(0);
  let pos = offset;
  for (;;) {
    const tmp = Buffer.alloc(WINDOW);
    const { bytesRead } = await fh.read(tmp, 0, WINDOW, pos);
    if (bytesRead === 0) break;
    collected = Buffer.concat([collected, tmp.subarray(0, bytesRead)]);
    const nl = collected.indexOf(NL);
    if (nl >= 0) {
      let end = nl;
      if (end > 0 && collected[end - 1] === CR) end -= 1;
      return collected.subarray(0, end);
    }
    if (bytesRead < WINDOW) break; // EOF without newline (last line)
    pos += bytesRead;
  }
  let end = collected.length;
  if (end > 0 && collected[end - 1] === CR) end -= 1;
  return collected.subarray(0, end);
}

function writeAsync(stream, buf) {
  return new Promise((resolve, reject) => {
    stream.write(buf, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  const t0 = Date.now();
  let srcSize = 0;
  try {
    srcSize = (await stat(CSV_PATH)).size;
  } catch {
    die(
      `找不到数据源：${CSV_PATH}\n` +
        `请先从 https://codeload.github.com/skywind3000/ECDICT/zip/refs/heads/master 拉仓库，\n` +
        `解压后用 tar.exe -xf stardict.7z 得到 stardict.csv，放到 data/ecdict/stardict/ 下。`,
    );
  }

  await mkdir(INDEX_DIR, { recursive: true });
  await rm(CHUNK_DIR, { recursive: true, force: true });
  await mkdir(CHUNK_DIR, { recursive: true });

  // --- pass 1: stream the CSV, spill sorted chunks -------------------------
  const reader = new LineReader(createReadStream(CSV_PATH, { highWaterMark: 1 << 20 }));
  await reader.next(); // discard the header line

  const chunkFiles = [];
  let keys = [];
  let offs = [];
  let chunkIndex = 0;
  let rows = 0;

  for (;;) {
    const r = await reader.next();
    if (!r) break;
    const word = parseCsvLine(r.line)[0] || '';
    keys.push(word.toLowerCase());
    offs.push(r.start);
    rows += 1;
    if (keys.length >= CHUNK_SIZE) {
      chunkFiles.push(await flushChunk(chunkIndex, keys, offs));
      chunkIndex += 1;
      keys = [];
      offs = [];
    }
  }
  if (keys.length) {
    chunkFiles.push(await flushChunk(chunkIndex, keys, offs));
    chunkIndex += 1;
  }

  // --- merge: k-way, seek source, write ecdict.dat + ecdict.off -----------
  const mergeReaders = chunkFiles.map(
    (f) => new LineReader(createReadStream(f, { highWaterMark: 1 << 20 })),
  );
  const parseChunkLine = (buf) => {
    const tab = buf.indexOf(0x09);
    return [buf.subarray(0, tab).toString('utf8'), Number(buf.subarray(tab + 1).toString('utf8'))];
  };
  const heads = [];
  for (const cr of mergeReaders) {
    const ln = await cr.next();
    heads.push(ln ? parseChunkLine(ln.line) : null);
  }

  const csvFH = await open(CSV_PATH, 'r');
  const out = createWriteStream(DAT_PATH);
  const offTable = []; // Uint32; one entry per row = start byte in ecdict.dat
  let writePos = 0;
  let emitted = 0;
  let batch = [];
  let batchLen = 0;

  const flushBatch = async () => {
    if (!batch.length) return;
    await writeAsync(out, Buffer.concat(batch));
    batch = [];
    batchLen = 0;
  };

  for (;;) {
    let best = -1;
    for (let k = 0; k < heads.length; k += 1) {
      if (heads[k] && (best < 0 || heads[k][0] < heads[best][0])) best = k;
    }
    if (best < 0) break;

    const lineBuf = await readCsvLineAt(csvFH, heads[best][1]);
    offTable.push(writePos);
    const piece = Buffer.concat([lineBuf, Buffer.from('\n')]);
    batch.push(piece);
    batchLen += piece.length;
    writePos += piece.length;
    emitted += 1;
    if (batchLen > 2 << 20) await flushBatch();

    const ln = await mergeReaders[best].next();
    heads[best] = ln ? parseChunkLine(ln.line) : null;
  }
  await flushBatch();
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  await csvFH.close();

  // --- write offset table + meta ------------------------------------------
  const offArr = new Uint32Array(offTable);
  const offBuf = Buffer.from(offArr.buffer, offArr.byteOffset, offArr.byteLength);
  await writeFile(OFF_PATH, offBuf);

  const meta = {
    count: emitted,
    builtAt: new Date().toISOString(),
    sourceSize: srcSize,
    version: 1,
  };
  await writeFile(META_PATH, JSON.stringify(meta, null, 2), 'utf8');

  await rm(CHUNK_DIR, { recursive: true, force: true });

  const datBytes = (await stat(DAT_PATH)).size;
  const offBytes = (await stat(OFF_PATH)).size;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(
    `[build-dict-index] 完成\n` +
      `  条数        : ${emitted}\n` +
      `  产物目录    : ${INDEX_DIR}\n` +
      `  ecdict.dat  : ${(datBytes / 1024 / 1024).toFixed(1)} MB\n` +
      `  ecdict.off  : ${(offBytes / 1024 / 1024).toFixed(1)} MB (${offArr.length} 个 uint32)\n` +
      `  meta.json   : count=${meta.count} sourceSize=${srcSize} builtAt=${meta.builtAt}\n` +
      `  耗时        : ${secs} s\n`,
  );
}

main().catch((err) => die(err?.stack || String(err)));
