/**
 * Tests for `scripts/ensure-build.mjs`.
 *
 * Each test builds a throwaway project tree under the OS temp directory with
 * explicitly controlled mtimes, then asserts what `findStaleReason` decides.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findStaleReason } from './ensure-build.mjs';

/** Absolute path of the temp project root for the current test. */
let root;

/** The "now" reference used to lay out mtimes. */
const NOW = Date.now();

/**
 * Create a fresh temp project root.
 *
 * @returns {string} absolute path of the new root
 */
function makeRoot() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-build-'));
  return root;
}

/**
 * Write a file inside the temp root, creating parent directories as needed,
 * and stamp it with the given mtime.
 *
 * @param {string} relPath path relative to the temp root
 * @param {number} [mtimeMs] mtime in ms since epoch; defaults to NOW
 * @returns {string} absolute path of the written file
 */
function write(relPath, mtimeMs = NOW) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x');
  const when = new Date(mtimeMs);
  fs.utimesSync(abs, when, when);
  return abs;
}

afterEach(() => {
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
  }
});

describe('findStaleReason', () => {
  it('reports a missing dist when dist/index.html does not exist', () => {
    makeRoot();
    write('src/App.tsx', NOW - 60_000);

    expect(findStaleReason(root)).toBe('dist is missing');
  });

  it('returns null when dist is newer than every source file', () => {
    makeRoot();
    write('src/App.tsx', NOW - 60_000);
    write('src/main.tsx', NOW - 50_000);
    write('index.html', NOW - 40_000);
    write('vite.config.ts', NOW - 30_000);
    write('package.json', NOW - 20_000);
    write('dist/index.html', NOW);

    expect(findStaleReason(root)).toBeNull();
  });

  it('flags a source file that is newer than dist', () => {
    makeRoot();
    write('src/App.tsx', NOW);
    write('dist/index.html', NOW - 60_000);

    expect(findStaleReason(root)).toBe('src/App.tsx is newer than dist');
  });

  it('flags a newer nested source file using a relative path', () => {
    makeRoot();
    write('dist/index.html', NOW - 60_000);
    write('src/components/VideoPlayer.tsx', NOW);

    expect(findStaleReason(root)).toBe(
      'src/components/VideoPlayer.tsx is newer than dist',
    );
  });

  it('flags a newer root config file', () => {
    makeRoot();
    write('src/App.tsx', NOW - 60_000);
    write('dist/index.html', NOW - 60_000);
    write('tailwind.config.js', NOW);

    expect(findStaleReason(root)).toBe(
      'tailwind.config.js is newer than dist',
    );
  });

  it('ignores files inside node_modules, .git and dist under src', () => {
    makeRoot();
    write('src/App.tsx', NOW - 60_000);
    write('dist/index.html', NOW - 60_000);
    // These are newer than dist but live in pruned directories, so they must
    // not influence the verdict.
    write('src/node_modules/junk.ts', NOW);
    write('src/.git/HEAD', NOW);
    write('src/dist/bundle.js', NOW);

    expect(findStaleReason(root)).toBeNull();
  });

  it('treats a build within the tolerance window as up to date', () => {
    makeRoot();
    // Source is 500ms newer than dist: inside the 1000ms grace window.
    write('dist/index.html', NOW - 500);
    write('src/App.tsx', NOW);

    expect(findStaleReason(root)).toBeNull();
  });

  it('flags a source file clearly beyond the tolerance window', () => {
    makeRoot();
    write('dist/index.html', NOW - 5_000);
    write('src/App.tsx', NOW);

    expect(findStaleReason(root)).toBe('src/App.tsx is newer than dist');
  });

  it('does not require the optional root config files to exist', () => {
    makeRoot();
    write('src/App.tsx', NOW - 60_000);
    write('dist/index.html', NOW);

    // Only a subset of ROOT_FILES is present; the call must not throw.
    expect(findStaleReason(root)).toBeNull();
  });
});
