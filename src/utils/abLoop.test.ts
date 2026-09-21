import { describe, expect, it } from 'vitest';
import type { ABLoopState } from '../types';
import { clearABLoop, nextABState, shouldLoopBack } from './abLoop';

const empty: ABLoopState = { pointA: null, pointB: null, enabled: false };

describe('nextABState', () => {
  it('empty -> sets A when no points defined', () => {
    const next = nextABState(empty, 10);
    expect(next).toEqual({
      pointA: 10,
      pointB: null,
      enabled: false,
      oneShot: false,
    });
  });

  it('when A is set and B unset, sets B', () => {
    const state: ABLoopState = { pointA: 10, pointB: null, enabled: false };
    const next = nextABState(state, 20);
    expect(next).toEqual({
      pointA: 10,
      pointB: 20,
      enabled: false,
      oneShot: false,
    });
  });

  it('does not mutate input', () => {
    const state: ABLoopState = { pointA: 10, pointB: null, enabled: false };
    nextABState(state, 20);
    expect(state).toEqual({ pointA: 10, pointB: null, enabled: false });
  });

  it('when both A and B set, resets and sets new A', () => {
    const state: ABLoopState = {
      pointA: 10,
      pointB: 20,
      enabled: true,
    };
    const next = nextABState(state, 50);
    expect(next).toEqual({
      pointA: 50,
      pointB: null,
      enabled: false,
      oneShot: false,
    });
  });

  it('currentTime < A replaces A with new earlier time', () => {
    const state: ABLoopState = { pointA: 100, pointB: null, enabled: false };
    const next = nextABState(state, 50);
    expect(next.pointA).toBe(50);
    expect(next.pointB).toBeNull();
  });

  it('does not allow zero-width loop (B same as A)', () => {
    const state: ABLoopState = { pointA: 10, pointB: null, enabled: false };
    const next = nextABState(state, 10);
    expect(next.pointA).toBe(10);
    expect(next.pointB).toBeNull();
  });

  it('does not allow B before A; clicking before A resets A to earlier time', () => {
    const state: ABLoopState = { pointA: 10, pointB: null, enabled: false };
    const next = nextABState(state, 5);
    expect(next.pointA).toBe(5);
    expect(next.pointB).toBeNull();
  });

  it('clears enabled flag when transitioning', () => {
    const enabled: ABLoopState = { pointA: 5, pointB: 15, enabled: true };
    expect(nextABState(enabled, 100).enabled).toBe(false);
    expect(nextABState(empty, 5).enabled).toBe(false);
  });
});

describe('shouldLoopBack', () => {
  it('returns false when not enabled', () => {
    const state: ABLoopState = { pointA: 0, pointB: 10, enabled: false };
    expect(shouldLoopBack(state, 15)).toBe(false);
  });

  it('returns false when A or B is null', () => {
    expect(shouldLoopBack({ pointA: null, pointB: 10, enabled: true }, 15)).toBe(false);
    expect(shouldLoopBack({ pointA: 0, pointB: null, enabled: true }, 15)).toBe(false);
  });

  it('returns true when currentTime >= B and loop enabled', () => {
    const state: ABLoopState = { pointA: 0, pointB: 10, enabled: true };
    expect(shouldLoopBack(state, 10)).toBe(true);
    expect(shouldLoopBack(state, 11)).toBe(true);
  });

  it('returns false when currentTime is before B', () => {
    const state: ABLoopState = { pointA: 0, pointB: 10, enabled: true };
    expect(shouldLoopBack(state, 5)).toBe(false);
    expect(shouldLoopBack(state, 9.99)).toBe(false);
  });
});

describe('clearABLoop', () => {
  it('returns an empty state regardless of input', () => {
    expect(clearABLoop()).toEqual({
      pointA: null,
      pointB: null,
      enabled: false,
      oneShot: false,
    });
  });
});