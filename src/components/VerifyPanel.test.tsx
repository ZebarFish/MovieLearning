import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VerifyPanel } from './GuidedLearning';
import type { SubtitleCue } from '../types';
import type { DiffResult } from '../utils/textDiff';

const cues: SubtitleCue[] = [
  { index: 1, start: 0, end: 2, text: 'Hello world.' },
  { index: 2, start: 2, end: 4, text: 'Second sentence here.' },
];

const results: Record<number, DiffResult> = {
  1: {
    tokens: [
      { text: 'Hello', status: 'ok' },
      { text: 'world', status: 'missing' },
    ],
    extraTyped: [],
    wrongWords: ['world'],
  },
};

function renderPanel(overrides?: Partial<Parameters<typeof VerifyPanel>[0]>) {
  const props = {
    cues,
    typed: { 1: 'Hello world.', 2: 'Second sentence here.' },
    results,
    onReplayCue: vi.fn(),
    onRetry: vi.fn(),
    onNext: vi.fn(),
    subtitleVisible: false,
    onToggleSubtitle: vi.fn(),
    displayMode: 'en' as const,
    ...overrides,
  };
  render(<VerifyPanel {...props} />);
  return props;
}

describe('VerifyPanel (回听验证)', () => {
  it('starts unconfirmed: 0/2 and the next button is disabled', () => {
    renderPanel();
    expect(screen.getByText('已确认 0/2')).toBeTruthy();
    const next = screen.getByText('下一步：跟读 →') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('shows the user dictation and the correction view', () => {
    renderPanel();
    expect(screen.getByText(/你的听写:Hello world\./)).toBeTruthy();
    // MUI Tooltip renders the hint as aria-label on the marked word in jsdom.
    expect(screen.getByLabelText('正确写法:world')).toBeTruthy();
  });

  it('requires every cue confirmed before enabling next', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByTestId('verify-confirm-1'));
    expect(screen.getByText('已确认 1/2')).toBeTruthy();
    expect(
      (screen.getByText('下一步：跟读 →') as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByTestId('verify-confirm-2'));
    expect(screen.getByText('已确认 2/2')).toBeTruthy();
    const next = screen.getByText('下一步：跟读 →') as HTMLButtonElement;
    expect(next.disabled).toBe(false);

    fireEvent.click(next);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it('replaying a cue forwards it to onReplayCue', () => {
    const props = renderPanel();
    const replayButtons = screen.getAllByText('重听这句');
    fireEvent.click(replayButtons[1]!);
    expect(props.onReplayCue).toHaveBeenCalledWith(cues[1]);
  });

  it('重新听写 goes back to dictation via onRetry', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByText('重新听写'));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});
