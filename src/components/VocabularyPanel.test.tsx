/**
 * Tests for the vocabulary panel's sync-state UX: per-word synced marks,
 * the 全部/未同步/已同步 filter, and the "only sync unsynced" button.
 * fetch is mocked to reject — the panel degrades to "Anki offline" mode,
 * which is exactly the state where manual marks matter most.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VocabularyPanel } from './VocabularyPanel';
import type { VocabWord } from '../types';

const SYNCED_KEY = 'learnTV.anki.syncedWords.v1';
const DECK_KEY = 'learnTV.anki.deck';

const word = (w: string): VocabWord => ({
  word: w,
  surface: w,
  sentence: `This is ${w}.`,
  video: 'demo.mp4',
  time: 5,
  addedAt: new Date().toISOString(),
});

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(globalThis, 'fetch', {
    value: fetchMock,
    writable: true,
  });
  fetchMock.mockReset();
  // Anki offline: checkAnkiConnection must resolve ok=false, not throw.
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
});

describe('VocabularyPanel sync marks & filter', () => {
  it('marks words from the record and filters by sync state', async () => {
    localStorage.setItem(DECK_KEY, 'Default');
    localStorage.setItem(
      SYNCED_KEY,
      JSON.stringify({ Default: [{ word: 'hello', manual: true }] }),
    );

    render(
      <VocabularyPanel
        open
        onClose={() => {}}
        vocab={[word('hello'), word('world')]}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('vocab-sync-mark-hello')).toBeTruthy();
    });

    // hello is recorded as synced; world is not.
    expect(screen.getByTestId('vocab-sync-mark-hello').textContent).toContain('已同步');
    expect(screen.getByTestId('vocab-sync-mark-world').textContent).toContain('未同步');

    // The sync button only offers the unsynced word.
    const syncBtn = screen.getByTestId('anki-sync-btn') as HTMLButtonElement;
    expect(syncBtn.textContent).toContain('一键同步 1 个未同步词');
    expect(syncBtn.disabled).toBe(true); // Anki offline anyway

    // Collapsible header summarises the state without taking list space.
    expect(screen.getByText(/已同步 1 \/ 未同步 1/)).toBeTruthy();
  });

  it('filter chips show only the matching subset', async () => {
    localStorage.setItem(DECK_KEY, 'Default');
    localStorage.setItem(
      SYNCED_KEY,
      JSON.stringify({ Default: [{ word: 'hello', manual: true }] }),
    );

    render(
      <VocabularyPanel
        open
        onClose={() => {}}
        vocab={[word('hello'), word('world')]}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('vocab-sync-mark-world')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('vocab-filter-unsynced'));
    expect(screen.queryByTestId('vocab-sync-mark-hello')).toBeNull();
    expect(screen.getByTestId('vocab-sync-mark-world')).toBeTruthy();

    fireEvent.click(screen.getByTestId('vocab-filter-synced'));
    expect(screen.getByTestId('vocab-sync-mark-hello')).toBeTruthy();
    expect(screen.queryByTestId('vocab-sync-mark-world')).toBeNull();

    fireEvent.click(screen.getByTestId('vocab-filter-all'));
    expect(screen.getByTestId('vocab-sync-mark-hello')).toBeTruthy();
    expect(screen.getByTestId('vocab-sync-mark-world')).toBeTruthy();
  });

  it('clicking a word mark toggles it in the record and updates the UI', async () => {
    localStorage.setItem(DECK_KEY, 'Default');

    render(
      <VocabularyPanel
        open
        onClose={() => {}}
        vocab={[word('hello'), word('world')]}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('vocab-sync-mark-world')).toBeTruthy();
    });

    // Mark world as synced by hand.
    fireEvent.click(screen.getByTestId('vocab-sync-mark-world'));
    expect(screen.getByTestId('vocab-sync-mark-world').textContent).toContain('已同步');

    const stored = JSON.parse(
      localStorage.getItem(SYNCED_KEY) ?? '{}',
    ) as { Default: { word: string; manual?: boolean }[] };
    expect(stored.Default).toContainEqual({ word: 'world', manual: true });

    // Only hello is left unsynced now (and Anki is offline, so still disabled).
    const syncBtn = screen.getByTestId('anki-sync-btn') as HTMLButtonElement;
    expect(syncBtn.textContent).toContain('一键同步 1 个未同步词');
    expect(syncBtn.disabled).toBe(true);

    // Toggle back: the record drops the word.
    fireEvent.click(screen.getByTestId('vocab-sync-mark-world'));
    expect(screen.getByTestId('vocab-sync-mark-world').textContent).toContain('未同步');
  });
});
