/**
 * ensure-build.mjs
 *
 * Decides whether the `dist/` bundle is stale and, if so, rebuilds it.
 *
 * Why this exists: `start.bat` used to only check whether `dist/index.html`
 * EXISTS. After a `git pull` (or any source edit) the previously built bundle
 * was still served, so the user silently ran an outdated app. This script also
 * compares modification times, so a rebuild happens whenever the sources or
 * build config are newer than the last build.
 *
 * Usage (from the project root):
 *   node scripts/ensure-build.mjs
 *
 * Exit codes:
 *   0        build is up to date, or the rebuild succeeded
 *   non-zero the rebuild failed (the child's exit code is forwarded as-is)
 *
 * NOTE: every string printed to the terminal is kept ASCII-only, because the
 * same messages are surfaced through a cmd.exe console on Windows.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Two files written within the same second can end up with `dist/index.html`
 * a few milliseconds OLDER than the source it was built from. A one-second
 * grace window absorbs that jitter and stops us rebuilding on every launch.
 */
const MTIME_TOLERANCE_MS = 1000;

/** Directory names that never take part in the freshness comparison. */
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist']);

/**
 * Root-level files whose changes must trigger a rebuild. `src/**` is scanned
 * separately.
 */
const ROOT_FILES = [
  'index.html',
  'vite.config.ts',
  'vitest.config.ts',
  'package.json',
  'tailwind.config.js',
  'postcss.config.js',
];

/**
 * Recursively collect every regular file below `dir`.
 *
 * Directories named in SKIP_DIR_NAMES are pruned so vendored / VCS / build
 * output never influences freshness.
 *
 * @param {string} dir absolute directory to scan
 * @param {string[]} acc accumulator of absolute file paths
 * @returns {string[]} the same accumulator, for convenience
 */
function collectFiles(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Missing or unreadable directory contributes no files.
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      collectFiles(full, acc);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Modification time in milliseconds, or `null` when the path is missing or
 * unreadable.
 *
 * @param {string} absPath
 * @returns {number | null}
 */
function mtimeMsOf(absPath) {
  try {
    return statSync(absPath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Render an absolute path relative to `projectRoot` using forward slashes, so
 * messages look identical on every platform (e.g. `src/App.tsx`).
 *
 * @param {string} projectRoot
 * @param {string} absPath
 * @returns {string}
 */
function toRelative(projectRoot, absPath) {
  return path.relative(projectRoot, absPath).split(path.sep).join('/');
}

/**
 * Return `null` when `dist/index.html` exists and is at least as new as every
 * tracked source/config file; otherwise return a short English reason that
 * explains what is stale.
 *
 * @param {string} projectRoot absolute path to the project root
 * @returns {string | null} `null` when up to date, else a human-readable reason
 */
export function findStaleReason(projectRoot) {
  const root = path.resolve(projectRoot);

  const distMtime = mtimeMsOf(path.join(root, 'dist', 'index.html'));
  if (distMtime === null) {
    return 'dist is missing';
  }

  const candidates = collectFiles(path.join(root, 'src'), []);
  for (const name of ROOT_FILES) {
    const full = path.join(root, name);
    if (existsSync(full)) {
      candidates.push(full);
    }
  }

  // Find the newest tracked file; only it can make the build stale.
  let newestFile = null;
  let newestMtime = Number.NEGATIVE_INFINITY;
  for (const file of candidates) {
    const mtime = mtimeMsOf(file);
    if (mtime === null) continue;
    if (mtime > newestMtime) {
      newestMtime = mtime;
      newestFile = file;
    }
  }

  const limit = distMtime + MTIME_TOLERANCE_MS;
  if (newestFile !== null && newestMtime > limit) {
    return `${toRelative(root, newestFile)} is newer than dist`;
  }
  return null;
}

/**
 * True when this module is the entry point of a `node scripts/ensure-build.mjs`
 * run (as opposed to being imported by a test).
 *
 * @returns {boolean}
 */
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

/**
 * Run `npm run build` in `projectRoot`, forwarding its exit code to the
 * caller. `shell: true` is required on Windows so `npm` resolves to
 * `npm.cmd`.
 *
 * @param {string} projectRoot
 */
function runBuild(projectRoot) {
  const child = spawn('npm', ['run', 'build'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
  });

  child.on('error', (err) => {
    console.error(`[2/3] Failed to start the build: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (code === null) {
      console.error(`[2/3] Build stopped by signal ${signal}.`);
      process.exit(1);
    }
    process.exit(code);
  });
}

/** CLI entry point. */
function main() {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );

  const reason = findStaleReason(projectRoot);
  if (reason === null) {
    console.log('[2/3] Build is up to date.');
    process.exit(0);
  }

  console.log(`[2/3] Building the project (${reason}) ...`);
  runBuild(projectRoot);
}

if (isDirectRun()) {
  main();
}
