/**
 * ankiTemplate.ts
 *
 * Static definition of the note type this app creates in Anki — the
 * "听美剧学英语" model. Pure data (no network, no AnkiConnect calls), so the
 * payload can be unit-tested and reviewed without a running Anki.
 *
 * Cards carry nine fields …
 *   单词      the English word
 *   单词释义  its Chinese definition
 *   例句      the sentence the word was met in
 *   例句释义  that sentence's Chinese translation
 *   音标      IPA phonetic (from the offline ECDICT dictionary)
 *   英文释义  English (WordNet-style) definition, also from ECDICT
 *   词形变化  inflection summary (原形 / 过去式 / 三单 …)
 *   词性分布  BNC part-of-speech ratios, e.g. "n:41/v:59"
 *   词汇标记  Oxford / Collins / exam-tag / frequency badges
 *
 * … plus a pronunciation: `{{tts en_US:单词}}` makes Anki synthesise and
 * play the word itself, so no audio files need to be shipped.
 *
 * The back of the card also carries a 「拼写」 block: it re-renders the word
 * spaced out in a monospace face so the learner can verify the spelling
 * letter by letter after recalling the meaning.
 */

export const ANKI_MODEL_NAME = '听美剧学英语';

export const FIELD_WORD = '单词';
export const FIELD_DEFINITION = '单词释义';
export const FIELD_SENTENCE = '例句';
export const FIELD_TRANSLATION = '例句释义';
export const FIELD_PHONETIC = '音标';
export const FIELD_ENGLISH_DEFINITION = '英文释义';
export const FIELD_FORMS = '词形变化';
export const FIELD_POS = '词性分布';
export const FIELD_LEXICAL_TAGS = '词汇标记';

/**
 * Field order matters: sync maps the model's fields positionally onto a
 * foreign note type, and the first four names are the contract that existing
 * decks rely on. The five appended fields are additive — older decks simply
 * leave them blank until the note type is upgraded.
 */
export const ANKI_FIELDS: string[] = [
  FIELD_WORD,
  FIELD_DEFINITION,
  FIELD_SENTENCE,
  FIELD_TRANSLATION,
  FIELD_PHONETIC,
  FIELD_ENGLISH_DEFINITION,
  FIELD_FORMS,
  FIELD_POS,
  FIELD_LEXICAL_TAGS,
];

/**
 * Anki renders this on the card and speaks it with the en_US voice.
 * Requires a TTS voice for English to be installed on the device that
 * reviews the card; otherwise Anki simply renders nothing.
 */
export const TTS_EXPRESSION = `{{tts en_US:${FIELD_WORD}}}`;

export const CARD_NAME = '单词卡';

export const CARD_FRONT = `<div class="word">{{${FIELD_WORD}}}</div>
<div class="phonetic">{{${FIELD_PHONETIC}}}</div>
<div class="sound">{{tts en_US:${FIELD_WORD}}}</div>`;

export const CARD_BACK = `{{FrontSide}}

<hr id="answer">

<div class="section">
  <div class="label">拼写</div>
  <div class="value spell">{{${FIELD_WORD}}}</div>
</div>

<div class="section">
  <div class="label">单词释义</div>
  <div class="value">{{${FIELD_DEFINITION}}}</div>
</div>

<div class="section">
  <div class="label">英文释义</div>
  <div class="value">{{${FIELD_ENGLISH_DEFINITION}}}</div>
</div>

<div class="section">
  <div class="label">例句</div>
  <div class="value sentence">{{${FIELD_SENTENCE}}}</div>
</div>

<div class="section">
  <div class="label">例句释义</div>
  <div class="value">{{${FIELD_TRANSLATION}}}</div>
</div>

<div class="section">
  <div class="label">词形变化</div>
  <div class="value">{{${FIELD_FORMS}}}</div>
</div>

<div class="section">
  <div class="label">词性分布</div>
  <div class="value">{{${FIELD_POS}}}</div>
</div>

<div class="section">
  <div class="label">词汇标记</div>
  <div class="value tags">{{${FIELD_LEXICAL_TAGS}}}</div>
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

.phonetic {
  font-family: Georgia, serif;
  font-size: 16px;
  color: #6b7488;
  margin-top: 4px;
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

.tags {
  color: #8a93a5;
}

.sentence {
  font-style: italic;
  color: #3c4658;
}

/* 拼写 block: keep the word readable letter by letter. This rule must stay
   AFTER the .value rule — both are single-class selectors, so the later one
   wins and .value would otherwise override the colour. */
.spell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-weight: 600;
  letter-spacing: 0.35em;
  color: #1b5e9c;
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

.night_mode .phonetic,
.nightMode .phonetic {
  color: #9aa3b5;
}

.night_mode hr#answer,
.nightMode hr#answer {
  border-top-color: #3a3f4b;
}

.night_mode .value,
.nightMode .value {
  color: #e6e9f0;
}

.night_mode .tags,
.nightMode .tags {
  color: #9aa3b5;
}

.night_mode .sentence,
.nightMode .sentence {
  color: #bfc6d4;
}

/* Appended last so it out-cascades the night-mode .value rule (same
   specificity: whichever comes later wins). */
.night_mode .spell,
.nightMode .spell {
  color: #7fb6e8;
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

/**
 * Payload for AnkiConnect's `createModel` action, which wants an ARRAY of
 * `{ Name, Front, Back }`.
 *
 * Do NOT reuse this for `updateModelTemplates` — see `buildTemplateMap()`.
 */
export function buildCardTemplates(): {
  Name: string;
  Front: string;
  Back: string;
}[] {
  return [{ Name: CARD_NAME, Front: CARD_FRONT, Back: CARD_BACK }];
}

/**
 * Payload for AnkiConnect's `updateModelTemplates` action, which — unlike
 * `createModel` — wants the templates keyed BY NAME:
 *
 *   { '单词卡': { Front, Back } }
 *
 * The two shapes are not interchangeable. Handing this action the array form
 * makes AnkiConnect crash with `'list' object has no attribute 'get'`: its
 * handler does `templates = model['templates']` and then
 * `templates.get(ankiTemplate['name'])`, so a list has no `.get`
 * (addons21/2055492159/__init__.py → updateModelTemplates).
 */
export function buildTemplateMap(): Record<
  string,
  { Front: string; Back: string }
> {
  return { [CARD_NAME]: { Front: CARD_FRONT, Back: CARD_BACK } };
}
