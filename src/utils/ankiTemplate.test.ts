/**
 * Tests for the built-in Anki note type (utils/ankiTemplate.ts).
 * Pure data — no Anki instance required.
 */
import { describe, expect, it } from 'vitest';
import {
  ANKI_FIELDS,
  ANKI_MODEL_NAME,
  CARD_BACK,
  CARD_FRONT,
  CARD_NAME,
  FIELD_DEFINITION,
  FIELD_ENGLISH_DEFINITION,
  FIELD_FORMS,
  FIELD_LEXICAL_TAGS,
  FIELD_PHONETIC,
  FIELD_POS,
  FIELD_SENTENCE,
  FIELD_TRANSLATION,
  FIELD_WORD,
  TTS_EXPRESSION,
  buildAnkiModelPayload,
  buildCardTemplates,
  buildTemplateMap,
} from './ankiTemplate';

describe('ankiTemplate', () => {
  it('declares the nine card fields in the expected order', () => {
    expect(ANKI_FIELDS).toEqual([
      FIELD_WORD,
      FIELD_DEFINITION,
      FIELD_SENTENCE,
      FIELD_TRANSLATION,
      FIELD_PHONETIC,
      FIELD_ENGLISH_DEFINITION,
      FIELD_FORMS,
      FIELD_POS,
      FIELD_LEXICAL_TAGS,
    ]);
    expect(ANKI_FIELDS).toEqual([
      '单词',
      '单词释义',
      '例句',
      '例句释义',
      '音标',
      '英文释义',
      '词形变化',
      '词性分布',
      '词汇标记',
    ]);
  });

  it('keeps the original four names first, so existing decks keep working', () => {
    expect(ANKI_FIELDS.slice(0, 4)).toEqual([
      '单词',
      '单词释义',
      '例句',
      '例句释义',
    ]);
  });

  it('pronounces the word itself via TTS and shows the IPA on the front', () => {
    expect(TTS_EXPRESSION).toBe('{{tts en_US:单词}}');
    expect(CARD_FRONT).toContain(TTS_EXPRESSION);
    expect(CARD_FRONT).toContain(`{{${FIELD_WORD}}}`);
    expect(CARD_FRONT).toContain(`{{${FIELD_PHONETIC}}}`);
  });

  it('shows every back-of-card field', () => {
    for (const field of [
      FIELD_DEFINITION,
      FIELD_SENTENCE,
      FIELD_TRANSLATION,
      FIELD_ENGLISH_DEFINITION,
      FIELD_FORMS,
      FIELD_POS,
      FIELD_LEXICAL_TAGS,
    ]) {
      expect(CARD_BACK).toContain(`{{${field}}}`);
    }
  });

  it('builds a createModel payload with fields, css and one card template', () => {
    const payload = buildAnkiModelPayload();
    expect(payload.modelName).toBe(ANKI_MODEL_NAME);
    expect(payload.inOrderFields).toEqual(ANKI_FIELDS);
    expect(payload.isCloze).toBe(false);
    expect(payload.css).toContain('.word');
    expect(payload.cardTemplates).toHaveLength(1);
    expect(payload.cardTemplates[0]!.Front).toContain(TTS_EXPRESSION);
  });

  it('hands out a fresh template array on every call', () => {
    const a = buildCardTemplates();
    const b = buildCardTemplates();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('maps templates by NAME for updateModelTemplates, not as an array', () => {
    const map = buildTemplateMap();
    // AnkiConnect's updateModelTemplates handler runs
    // `templates = model['templates']` then `templates.get(...)`, so handing
    // it the array form crashes with
    // "'list' object has no attribute 'get'".
    expect(Array.isArray(map)).toBe(false);
    expect(map).toEqual({
      [CARD_NAME]: { Front: CARD_FRONT, Back: CARD_BACK },
    });
    // The two payloads must stay distinct shapes.
    expect(Array.isArray(buildCardTemplates())).toBe(true);
    expect(buildTemplateMap()).not.toBe(map);
  });
});
