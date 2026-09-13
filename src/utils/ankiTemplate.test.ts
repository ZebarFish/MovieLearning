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
  FIELD_DEFINITION,
  FIELD_SENTENCE,
  FIELD_TRANSLATION,
  FIELD_WORD,
  TTS_EXPRESSION,
  buildAnkiModelPayload,
  buildCardTemplates,
} from './ankiTemplate';

describe('ankiTemplate', () => {
  it('declares the four card fields in the expected order', () => {
    expect(ANKI_FIELDS).toEqual([
      FIELD_WORD,
      FIELD_DEFINITION,
      FIELD_SENTENCE,
      FIELD_TRANSLATION,
    ]);
    expect(ANKI_FIELDS).toEqual(['单词', '单词释义', '例句', '例句释义']);
  });

  it('pronounces the word itself via TTS', () => {
    expect(TTS_EXPRESSION).toBe('{{tts en_US:单词}}');
    expect(CARD_FRONT).toContain(TTS_EXPRESSION);
    expect(CARD_FRONT).toContain(`{{${FIELD_WORD}}}`);
  });

  it('shows the definition, example and its translation on the back', () => {
    for (const field of [FIELD_DEFINITION, FIELD_SENTENCE, FIELD_TRANSLATION]) {
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
});
