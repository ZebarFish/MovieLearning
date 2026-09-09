// Vitest setup file. Provides clean localStorage between tests.
import { afterEach, beforeEach } from 'vitest';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});