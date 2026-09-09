/**
 * A-B loop helpers.
 *
 * The A-B loop logic is intentionally implemented as pure functions where
 * possible so the React effect in `ABLoopControls.tsx` stays small and
 * predictable.
 */
import type { ABLoopState } from '../types';

/**
 * Decide which point to set when the user clicks "set marker":
 *   - if A is unset or currentTime < A: set A
 *   - else if B is unset or currentTime <= B: set B
 *   - else (both set): reset and treat this click as setting a new A
 *
 * Returns a new ABLoopState without mutating the input.
 */
export function nextABState(
  current: ABLoopState,
  currentTime: number,
): ABLoopState {
  const { pointA, pointB } = current;

  // No A yet, or currentTime is before A → set A.
  if (pointA === null || currentTime < pointA) {
    return { pointA: currentTime, pointB: null, enabled: false };
  }

  // A is set, B unset. Only set B if it is strictly after A.
  // A zero-width loop (A === B) is useless and confusing, so we ignore it.
  if (pointB === null) {
    if (currentTime <= pointA) {
      return { ...current };
    }
    return { pointA, pointB: currentTime, enabled: false };
  }

  // Both A and B set: start a fresh loop with A at current time.
  return { pointA: currentTime, pointB: null, enabled: false };
}

/** Return true if the currentTime is at or past point B and a loop is active. */
export function shouldLoopBack(state: ABLoopState, currentTime: number): boolean {
  if (!state.enabled) {
    return false;
  }
  if (state.pointA === null || state.pointB === null) {
    return false;
  }
  return currentTime >= state.pointB;
}

/** Reset all loop state. */
export function clearABLoop(): ABLoopState {
  return { pointA: null, pointB: null, enabled: false };
}