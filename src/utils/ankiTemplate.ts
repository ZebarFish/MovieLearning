/**
 * ankiTemplate.ts
 *
 * Static definition of the note type this app creates in Anki — the
 * "听美剧学英语" model. Pure data (no network, no AnkiConnect calls), so the
 * payload can be unit-tested and reviewed without a running Anki.
 *
 * Cards carry four fields …
 *   单词      the English word
 *   单词释义  its definition
 *   例句      the sentence the word was met in
 *   例句释义  that sentence's Chinese translation
 *
 * … plus a pronunciation: `{{tts en_US:单词}}` makes Anki synthesise and
 * play the word itself, so no audio files need to be shipped.
 */

export const ANKI_MODEL_NAME = '听美剧学英语';

export const FIELD_WORD = '单词';
export const FIELD_DEFINITION = '单词释义';
export const FIELD_SENTENCE = '例句';
export const FIELD_TRANSLATION = '例句释义';

/** Field order matters: sync maps the model's fields positionally. */
export const ANKI_FIELDS: string[] = [
  FIELD_WORD,
  FIELD_DEFINITION,
  FIELD_SENTENCE,
  FIELD_TRANSLATION,
];

/**
 * Anki renders this on the card and speaks it with the en_US voice.
 * Requires a TTS voice for English to be installed on the device that
 * reviews the card; otherwise Anki simply renders nothing.
 */
export const TTS_EXPRESSION = `{{tts en_US:${FIELD_WORD}}}`;

export const CARD_NAME = '单词卡';

export const CARD_FRONT = `<div class="word">{{${FIELD_WORD}}}</div>
<div class="sound">{{tts en_US:${FIELD_WORD}}}</div>`;

export const CARD_BACK = `{{FrontSide}}

<hr id="answer">

<div class="section">
  <div class="label">单词释义</div>
  <div class="value">{{${FIELD_DEFINITION}}}</div>
</div>

<div class="section">
  <div class="label">例句</div>
  <div class="value sentence">{{${FIELD_SENTENCE}}}</div>
</div>

<div class="section">
  <div class="label">例句释义</div>
  <div class="value">{{${FIELD_TRANSLATION}}}</div>
</div>`;

export const ANKI_CSS = `.card {
  font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 20px;
  line-height: 1.6;
  text-align: left;
  color: #1f2430;
  background: #fbfbfd;
  padding: 18px 22px;
}

.word {
  font-size: 34px;
  font-weight: 700;
  color: #1b5e9c;
  letter-spacing: 0.01em;
}

.sound {
  margin-top: 6px;
}

hr#answer {
  border: none;
  border-top: 1px solid #e2e6ee;
  margin: 16px 0;
}

.section {
  margin-bottom: 14px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #8a93a5;
  margin-bottom: 4px;
}

.value {
  white-space: pre-wrap;
  color: #1f2430;
}

.sentence {
  font-style: italic;
  color: #3c4658;
}

.night_mode .card,
.nightMode .card {
  color: #e6e9f0;
  background: #23262e;
}

.night_mode .word,
.nightMode .word {
  color: #7fb6e8;
}

.night_mode hr#answer,
.nightMode hr#answer {
  border-top-color: #3a3f4b;
}

.night_mode .value,
.nightMode .value {
  color: #e6e9f0;
}

.night_mode .sentence,
.nightMode .sentence {
  color: #bfc6d4;
}`;

/** Payload for AnkiConnect's `createModel` action. */
export function buildAnkiModelPayload(): {
  modelName: string;
  inOrderFields: string[];
  css: string;
  isCloze: boolean;
  cardTemplates: { Name: string; Front: string; Back: string }[];
} {
  return {
    modelName: ANKI_MODEL_NAME,
    inOrderFields: [...ANKI_FIELDS],
    css: ANKI_CSS,
    isCloze: false,
    cardTemplates: buildCardTemplates(),
  };
}

/** Payload for AnkiConnect's `updateModelTemplates` action. */
export function buildCardTemplates(): {
  Name: string;
  Front: string;
  Back: string;
}[] {
  return [{ Name: CARD_NAME, Front: CARD_FRONT, Back: CARD_BACK }];
}
