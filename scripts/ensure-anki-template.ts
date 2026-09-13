/**
 * CLI helper: create (or repair) the "听美剧学英语" note type in a running Anki.
 *
 * The app does this automatically — on the 词库 panel's「创建笔记模板」button
 * and again at the start of every sync — so this script is only for setting
 * Anki up from a terminal, or for checking that the template is current.
 *
 * Usage:
 *   npm run anki:template
 */
import {
  checkAnkiConnection,
  ensureAnkiModel,
  listAnkiNoteTypes,
} from '../src/utils/ankiConnect';
import { ANKI_FIELDS, TTS_EXPRESSION } from '../src/utils/ankiTemplate';

async function main(): Promise<void> {
  const conn = await checkAnkiConnection();
  if (!conn.ok) {
    console.error(conn.error);
    process.exitCode = 1;
    return;
  }
  console.log(`AnkiConnect v${conn.version} connected.`);

  const status = await ensureAnkiModel();
  const fields = await listAnkiNoteTypes();

  console.log(`笔记类型「${status.name}」${status.created ? '已创建' : '已存在'}`);
  console.log(`  字段: ${status.fields.join(' / ')}`);
  if (status.addedFields.length > 0) {
    console.log(`  新增字段: ${status.addedFields.join('、')}`);
  }
  console.log(`  卡片模板: ${status.templatesUpdated ? '已安装/更新' : '保持原样'}`);
  console.log(`  朗读: ${TTS_EXPRESSION}`);
  console.log(`  期望字段: ${ANKI_FIELDS.join(' / ')}`);
  console.log(`  当前模型数: ${fields.length}`);
}

void main();
