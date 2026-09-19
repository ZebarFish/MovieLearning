/**
 * Tests for the pure `WordMeta` formatting layer (`wordMeta.ts`).
 * These helpers are shared by the word card UI and the Anki exporter, so the
 * signatures are frozen; the tests pin both the output shape and the exact
 * Chinese labels / ordering.
 */
import { describe, expect, it } from 'vitest';
import type { WordDefinition } from './dictionary';
import type { WordMeta } from '../types';
import {
  EXAM_TAG_LABELS,
  formatForms,
  formatLexicalTags,
  metaBadges,
  toWordMeta,
} from './wordMeta';

describe('EXAM_TAG_LABELS', () => {
  it('maps every ECDICT exam code to its Chinese label', () => {
    expect(EXAM_TAG_LABELS).toEqual({
      zk: '中考',
      gk: '高考',
      cet4: '四级',
      cet6: '六级',
      ky: '考研',
      toefl: '托福',
      ielts: '雅思',
      gre: 'GRE',
    });
  });
});

describe('toWordMeta', () => {
  it('returns just the phonetic for an online source with no meta', () => {
    const def: WordDefinition = { word: 'test', phonetic: '/tɛst/', meanings: [] };
    expect(toWordMeta(def)).toEqual({ phonetic: '/tɛst/' });
  });

  it('drops an empty-string phonetic instead of keeping an empty key', () => {
    const def: WordDefinition = { word: 'x', phonetic: '', meanings: [] };
    expect(toWordMeta(def)).toEqual({});
  });

  it('lets the lookup phonetic override a meta phonetic', () => {
    const def: WordDefinition = {
      word: 'x',
      phonetic: '/a/',
      meanings: [],
      meta: { phonetic: '/b/', oxford: true },
    };
    expect(toWordMeta(def)).toEqual({ phonetic: '/a/', oxford: true });
  });

  it('returns {} when nothing is storable', () => {
    const def: WordDefinition = { word: 'x', meanings: [] };
    expect(toWordMeta(def)).toEqual({});
  });

  it("turns ECDICT's literal \\n separators into real newlines", () => {
    const def: WordDefinition = {
      word: 'x',
      meanings: [],
      meta: { definition: 'n. a thing\\nvt. to thing' },
    };
    expect(toWordMeta(def).definition).toBe('n. a thing\nvt. to thing');
  });

  it('drops a definition that is nothing but separators', () => {
    const def: WordDefinition = {
      word: 'x',
      meanings: [],
      meta: { definition: '\\n\\n' },
    };
    expect(toWordMeta(def).definition).toBeUndefined();
  });
});

describe('metaBadges', () => {
  const full: WordMeta = {
    phonetic: "'dɪskʌvə",
    pos: 'v:100',
    collins: 4,
    oxford: true,
    tags: ['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'],
    bnc: 49,
    frq: 47,
    forms: { lemma: 'discover' },
  };

  it('emits Oxford, Collins, all tags and frequency in fixed order', () => {
    expect(metaBadges(full)).toEqual([
      '牛津3000',
      '柯林斯 ★★★★',
      '中考',
      '高考',
      '四级',
      '六级',
      '考研',
      '托福',
      '雅思',
      'GRE',
      '词频 49',
    ]);
  });

  it('returns [] for undefined', () => {
    expect(metaBadges(undefined)).toEqual([]);
  });

  it('returns [] for an empty meta object', () => {
    expect(metaBadges({})).toEqual([]);
  });

  it('only shows the labels that are present (partial)', () => {
    expect(metaBadges({ collins: 3, tags: ['gk', 'cet4'] })).toEqual([
      '柯林斯 ★★★',
      '高考',
      '四级',
    ]);
  });

  it('collins boundary: 0 and 6 are dropped, 5 is shown', () => {
    expect(metaBadges({ collins: 0 })).toEqual([]);
    expect(metaBadges({ collins: 6 })).toEqual([]);
    expect(metaBadges({ collins: 5 })).toEqual(['柯林斯 ★★★★★']);
  });

  it('frequency boundary: prefers bnc, falls back to frq, none when absent', () => {
    expect(metaBadges({ bnc: 100 })).toEqual(['词频 100']);
    expect(metaBadges({ frq: 200 })).toEqual(['词频 200']);
    expect(metaBadges({ bnc: 100, frq: 200 })).toEqual(['词频 100']);
    expect(metaBadges({})).toEqual([]);
  });

  it('tag order does not depend on input order', () => {
    const reversed = { tags: ['gre', 'cet6', 'zk', 'gk', 'cet4', 'ky', 'toefl', 'ielts'] };
    expect(metaBadges(reversed)).toEqual([
      '中考',
      '高考',
      '四级',
      '六级',
      '考研',
      '托福',
      '雅思',
      'GRE',
    ]);
  });
});

describe('formatForms', () => {
  it('joins the full paradigm in fixed order', () => {
    const meta: WordMeta = {
      forms: {
        lemma: 'discover',
        past: 'discovered',
        pastParticiple: 'discovered',
        presentParticiple: 'discovering',
        thirdPerson: 'discovers',
      },
    };
    expect(formatForms(meta)).toBe(
      '原形 discover · 过去式 discovered · 过去分词 discovered · 现在分词 discovering · 三单 discovers',
    );
  });

  it('skips missing inflections and works with a base form', () => {
    expect(formatForms({ forms: { lemma: 'chore', plural: 'chores' } })).toBe(
      '原形 chore · 复数 chores',
    );
  });

  it('returns empty string for undefined and for no forms', () => {
    expect(formatForms(undefined)).toBe('');
    expect(formatForms({})).toBe('');
  });
});

describe('formatLexicalTags', () => {
  it('assembles Oxford / Collins / tags / BNC / 当代 in fixed order', () => {
    const meta: WordMeta = {
      oxford: true,
      collins: 5,
      tags: ['gk', 'cet4'],
      bnc: 49,
      frq: 47,
    };
    expect(formatLexicalTags(meta)).toBe(
      '牛津3000 · 柯林斯★★★★★ · 高考 / 四级 · BNC 49 · 当代 47',
    );
  });

  it('skips absent segments', () => {
    expect(formatLexicalTags({ oxford: true, collins: 5 })).toBe('牛津3000 · 柯林斯★★★★★');
  });

  it('returns empty string for undefined and for an empty meta', () => {
    expect(formatLexicalTags(undefined)).toBe('');
    expect(formatLexicalTags({})).toBe('');
  });
});
