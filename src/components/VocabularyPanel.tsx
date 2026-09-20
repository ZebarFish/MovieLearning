/**
 * VocabularyPanel
 *
 * Right-side MUI Drawer that shows the user's collected vocabulary and
 * provides Anki sync (via AnkiConnect), .txt export fallback, and clear-all.
 *
 * Syncing is a two-step pipeline:
 *   1. enrich — fill 单词释义 (dictionary) and 例句释义 (ZH subtitles, else
 *      machine translation) for any entry still missing them,
 *   2. push  — create/repair the "听美剧学英语" note type and add the notes.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Divider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import type { SubtitleCue, VocabWord } from '../types';
import { downloadAnkiExport } from '../utils/ankiExport';
import {
  checkAnkiConnection,
  ensureAnkiModel,
  getSyncedWords,
  setWordSyncedManually,
  syncVocabToAnki,
  listAnkiDecks,
  listAnkiNoteTypes,
  type AnkiConnectionStatus,
  type AnkiModelStatus,
  type SyncResult,
} from '../utils/ankiConnect';
import { ANKI_MODEL_NAME, ANKI_FIELDS } from '../utils/ankiTemplate';
import { countPendingEnrichment, enrichVocab } from '../utils/vocabEnrich';
import { formatTime } from '../utils/subtitleParser';
import { CollapsiblePanel } from './CollapsiblePanel';

interface VocabularyPanelProps {
  open: boolean;
  onClose: () => void;
  vocab: VocabWord[];
  onRemove: (word: string) => void;
  onClearAll: () => void;
  /** Chinese subtitle cues, used to fill 例句释义 from the real subtitles. */
  zhCues?: SubtitleCue[];
  /** Persist enriched entries (definition / translation) back to storage. */
  onUpdateWord?: (entry: VocabWord) => void;
}

const DECK_KEY = 'learnTV.anki.deck';
const NOTE_KEY = 'learnTV.anki.noteType';

function loadSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota errors */
  }
}

export function VocabularyPanel({
  open,
  onClose,
  vocab,
  onRemove,
  onClearAll,
  zhCues,
  onUpdateWord,
}: VocabularyPanelProps): JSX.Element {
  const [deck, setDeck] = useState<string>(() => loadSetting(DECK_KEY, 'Default'));
  const [noteType, setNoteType] = useState<string>(() =>
    loadSetting(NOTE_KEY, ANKI_MODEL_NAME),
  );
  const [conn, setConn] = useState<AnkiConnectionStatus | null>(null);
  const [checking, setChecking] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string>('');
  const [deckOptions, setDeckOptions] = useState<string[]>([]);
  const [noteOptions, setNoteOptions] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState<AnkiModelStatus | null>(null);
  const [creatingModel, setCreatingModel] = useState<boolean>(false);
  const [modelError, setModelError] = useState<string>('');
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  /** Which subset of the list to show, by Anki sync state. */
  const [syncFilter, setSyncFilter] = useState<'all' | 'unsynced' | 'synced'>('all');
  /** Bumped whenever the synced record may have changed (sync / manual edit). */
  const [syncedVersion, setSyncedVersion] = useState<number>(0);

  const modelExists = noteOptions.includes(ANKI_MODEL_NAME);

  // The deck sync will actually use (same fallback as handleSync).
  const activeDeck = deck.trim() || '系统默认';

  // Lowercase words recorded as synced for the active deck. Re-read whenever
  // the drawer opens, the deck changes, or a sync/manual edit happened.
  const syncedSet = useMemo(
    () => (open ? getSyncedWords(activeDeck) : new Set<string>()),
    [open, activeDeck, syncedVersion],
  );
  const isSynced = (entry: VocabWord): boolean =>
    syncedSet.has(entry.word.trim().toLowerCase());
  const syncedCount = vocab.filter(isSynced).length;
  const unsyncedCount = vocab.length - syncedCount;
  // 一键同步 only ever touches words not yet recorded as synced.
  const unsyncedEntries = vocab.filter((e) => !isSynced(e));
  const shownVocab =
    syncFilter === 'all'
      ? vocab
      : vocab.filter((e) => (syncFilter === 'synced' ? isSynced(e) : !isSynced(e)));

  // Probe AnkiConnect each time the drawer opens, and pull real deck /
  // note-type lists so the user picks from what actually exists.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChecking(true);
    setSyncResult(null);
    setSyncError('');
    setModelError('');
    checkAnkiConnection().then(async (status) => {
      if (cancelled) return;
      setConn(status);
      setChecking(false);
      if (status.ok) {
        try {
          const [decks, notes] = await Promise.all([
            listAnkiDecks(),
            listAnkiNoteTypes(),
          ]);
          if (cancelled) return;
          const deckList = Array.isArray(decks) ? decks : [];
          const noteList = Array.isArray(notes) ? notes : [];
          setDeckOptions(deckList);
          setNoteOptions(noteList);
          // Fix saved settings that no longer exist in this collection — but
          // keep our own template name, which we can create on demand.
          setDeck((cur) => (deckList.includes(cur) ? cur : deckList[0] ?? cur));
          setNoteType((cur) =>
            noteList.includes(cur) || cur === ANKI_MODEL_NAME
              ? cur
              : noteList[0] ?? cur,
          );
        } catch {
          /* non-fatal: user can still type manually */
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleDeckChange = (v: string): void => {
    setDeck(v);
    saveSetting(DECK_KEY, v);
  };
  const handleNoteTypeChange = (v: string): void => {
    setNoteType(v);
    saveSetting(NOTE_KEY, v);
  };

  /** Create the note type (or repair a stale copy) and select it. */
  const handleCreateModel = async (): Promise<void> => {
    setCreatingModel(true);
    setModelError('');
    setSyncResult(null);
    try {
      const status = await ensureAnkiModel();
      setModelStatus(status);
      const notes = await listAnkiNoteTypes();
      setNoteOptions(Array.isArray(notes) ? notes : []);
      handleNoteTypeChange(ANKI_MODEL_NAME);
    } catch (err) {
      setModelError((err as Error).message);
    } finally {
      setCreatingModel(false);
    }
  };

  const handleSync = async (): Promise<void> => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError('');
    setEnrichProgress(null);
    try {
      // 0) Only words not yet recorded as synced — re-syncing everything
      //    would just produce a wall of "duplicate" skips.
      const entries = unsyncedEntries;

      // 1) Fill 单词释义 / 例句释义 for anything still missing them.
      let enriched = entries;
      const total = countPendingEnrichment(entries);
      if (total > 0) {
        setEnrichProgress({ done: 0, total });
        enriched = await enrichVocab(entries, {
          zhCues,
          onProgress: (done, t) => setEnrichProgress({ done, total: t }),
        });
        enriched.forEach((entry, index) => {
          if (entry !== entries[index]) onUpdateWord?.(entry);
        });
      }
      setEnrichProgress(null);

      // 2) Push into Anki (creates/repairs our note type on the way).
      const result = await syncVocabToAnki(
        enriched,
        deck.trim() || '系统默认',
        noteType.trim() || ANKI_MODEL_NAME,
      );
      setSyncResult(result);
      setSyncedVersion((v) => v + 1);
    } catch (err) {
      setSyncError((err as Error).message);
    } finally {
      setEnrichProgress(null);
      setSyncing(false);
    }
  };

  /** Manual synced/unsynced override from the word list. */
  const handleToggleSynced = (entry: VocabWord): void => {
    setWordSyncedManually(activeDeck, entry.word, !isSynced(entry));
    setSyncedVersion((v) => v + 1);
  };

  const handleExport = (): void => {
    downloadAnkiExport(vocab);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: { width: { xs: '100%', sm: 560 }, maxWidth: '100%' },
      }}
    >
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <MenuBookIcon color="primary" />
          <Typography variant="h6">我的词库</Typography>
          <Chip size="small" label={vocab.length} color="primary" />
        </Stack>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Divider />

      {/* Anki connection status */}
      <Box sx={{ p: 2, pb: 0 }}>
        {checking ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">
              正在检测 Anki 连接…
            </Typography>
          </Stack>
        ) : conn?.ok ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontSize: 16, lineHeight: 1 }}>✅</Typography>
            <Typography variant="caption" color="success.main">
              已连接 Anki (AnkiConnect v{conn.version}) — 可以一键同步
            </Typography>
          </Stack>
        ) : conn && !conn.ok ? (
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Typography sx={{ fontSize: 16, lineHeight: 1.3 }}>⚠️</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
              未连接 Anki。仍可导出 .txt 手动导入。
            </Typography>
          </Stack>
        ) : null}
      </Box>

      <Box sx={{ p: 2 }}>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            startIcon={
              syncing ? <CircularProgress size={16} color="inherit" /> : (
                <Box component="span" sx={{ fontSize: '1rem', lineHeight: 1 }}>⟳</Box>
              )
            }
            onClick={() => void handleSync()}
            disabled={vocab.length === 0 || unsyncedCount === 0 || syncing || !conn?.ok}
            fullWidth
            data-testid="anki-sync-btn"
            title={unsyncedCount === 0 ? '全部已同步' : undefined}
          >
            一键同步 {unsyncedCount} 个未同步词
          </Button>
          <Button
            variant="outlined"
            startIcon={<FileDownloadIcon />}
            onClick={handleExport}
            disabled={vocab.length === 0}
            title="导出 .txt 手动导入 Anki"
          >
            导出
          </Button>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={onClearAll}
            disabled={vocab.length === 0}
          >
            清空
          </Button>
        </Stack>

        {/* Enrichment progress (definition / translation backfill) */}
        {enrichProgress && (
          <Box sx={{ mt: 1.5 }} data-testid="anki-enrich-progress">
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={14} />
              <Typography variant="caption" color="text.secondary">
                正在补全释义与例句翻译 {enrichProgress.done}/{enrichProgress.total} …
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={
                enrichProgress.total > 0
                  ? (enrichProgress.done / enrichProgress.total) * 100
                  : 0
              }
              sx={{ mt: 0.5, height: 4, borderRadius: 2 }}
            />
          </Box>
        )}

        {/* Sync feedback */}
        {syncResult && (
          <Alert
            severity={syncResult.added > 0 || syncResult.duplicates.length > 0 ? 'success' : 'warning'}
            sx={{ mt: 1.5 }}
            data-testid="anki-sync-result"
          >
            同步完成: 新增 {syncResult.added} 张卡片到「{deck.trim() || '系统默认'}」
            {syncResult.duplicates.length > 0 && (
              <Box component="div" sx={{ mt: 0.5, fontSize: '0.8rem' }}>
                {syncResult.duplicates.length} 个词本牌组已有,已跳过:
                <Box component="span" sx={{ display: 'block', mt: 0.25 }}>
                  {syncResult.duplicates.slice(0, 8).map((d) => d.word).join('、')}
                  {syncResult.duplicates.length > 8 && ' …'}
                </Box>
              </Box>
            )}
            {syncResult.failed.length > 0 && (
              <Box component="div" sx={{ mt: 0.5, fontSize: '0.8rem', color: 'error.main' }}>
                {syncResult.failed.length} 个词添加失败: {syncResult.failed.join('、')}
              </Box>
            )}
          </Alert>
        )}
        {syncError && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            同步失败: {syncError}
          </Alert>
        )}

        {/* Anki settings + explanations — collapsible so a long word list
            keeps the space it needs. */}
        <CollapsiblePanel
          title="Anki 设置与说明"
          hint={`牌组:${activeDeck} · 已同步 ${syncedCount} / 未同步 ${unsyncedCount}`}
          defaultExpanded={false}
        >
          {conn?.ok && (
            <>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                <TextField
                  size="small"
                  label="牌组 (Deck)"
                  value={deck}
                  onChange={(e) => handleDeckChange(e.target.value)}
                  fullWidth
                  select
                  SelectProps={{ native: true }}
                  data-testid="anki-deck-select"
                >
                  {deckOptions.length > 0 ? (
                    deckOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))
                  ) : (
                    <option value={deck}>{deck}</option>
                  )}
                </TextField>
                <TextField
                  size="small"
                  label="笔记类型"
                  value={noteType}
                  onChange={(e) => handleNoteTypeChange(e.target.value)}
                  fullWidth
                  select
                  SelectProps={{ native: true }}
                  data-testid="anki-notetype-select"
                >
                  {noteOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                  {!modelExists && (
                    <option value={ANKI_MODEL_NAME}>
                      {ANKI_MODEL_NAME}（本应用创建）
                    </option>
                  )}
                </TextField>
              </Stack>

              {/* Built-in note type: 单词 / 读音 / 单词释义 / 例句 / 例句释义 */}
              <Box
                sx={{
                  mt: 1.5,
                  p: 1.25,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                }}
                data-testid="anki-template-box"
              >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    笔记模板「{ANKI_MODEL_NAME}」
                  </Typography>
                  {modelExists ? (
                    <Chip size="small" color="success" label="已存在" sx={{ height: 18, fontSize: '0.65rem' }} />
                  ) : (
                    <Chip size="small" color="warning" label="未创建" sx={{ height: 18, fontSize: '0.65rem' }} />
                  )}
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}
                >
                  字段：{ANKI_FIELDS.join(' / ')}，其中读音由{' '}
                  <code>{'{{tts en_US:单词}}'}</code> 自动发音。
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ mt: 1 }}
                  onClick={() => void handleCreateModel()}
                  disabled={creatingModel}
                  startIcon={creatingModel ? <CircularProgress size={14} /> : undefined}
                  data-testid="anki-create-model-btn"
                >
                  {modelExists ? '检查 / 修复模板' : '创建笔记模板'}
                </Button>
                {modelStatus && (
                  <Typography
                    variant="caption"
                    color="success.main"
                    sx={{ display: 'block', mt: 0.75 }}
                    data-testid="anki-model-status"
                  >
                    {modelStatus.created
                      ? `已创建「${modelStatus.name}」，字段：${modelStatus.fields.join(' / ')}`
                      : `模板已就绪（新增字段 ${
                          modelStatus.addedFields.length > 0
                            ? modelStatus.addedFields.join('、')
                            : '无'
                          }，卡片模板${modelStatus.templatesUpdated ? '已更新' : '保持不变'}）`}
                  </Typography>
                )}
                {modelError && (
                  <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.75 }}>
                    创建失败：{modelError}
                  </Typography>
                )}
                {!modelExists && !modelStatus && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    点「创建笔记模板」即可写入 Anki；同步时会自动创建，无需手动操作。
                  </Typography>
                )}
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                查重只针对上方牌组:其他牌组(如课程词书)有同一个词不影响同步。
              </Typography>
              {countPendingEnrichment(unsyncedEntries) > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  有 {countPendingEnrichment(unsyncedEntries)} 个未同步词缺释义或例句翻译，同步前会自动补全。
                </Typography>
              )}
            </>
          )}
          {conn && !conn.ok && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}>
              💡 启用一键同步: 打开 Anki → 工具 → 插件 → 获取插件,输入代码
              <strong> 2055492159</strong>,重启 Anki。然后在插件配置中把
              <code> "webCorsOriginList": ["*"] </code>加入 config.json。
            </Typography>
          )}
          {!conn?.ok && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              导出的 .txt 含 {ANKI_FIELDS.join(' / ')} 共 {ANKI_FIELDS.length} 列，可在 Anki 中
              「文件 → 导入」，导入时选「听美剧学英语」笔记类型即可。
            </Typography>
          )}
        </CollapsiblePanel>
      </Box>
      <Divider />

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {vocab.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              还没有收藏单词。点击字幕中的任意单词即可加入词库。
            </Typography>
          </Box>
        ) : (
          <>
            {/* Sync-state filter: 全部 / 未同步 / 已同步 */}
            <Stack direction="row" spacing={0.75} sx={{ p: 1.5, pb: 0.5 }} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                label={`全部 ${vocab.length}`}
                color={syncFilter === 'all' ? 'primary' : 'default'}
                variant={syncFilter === 'all' ? 'filled' : 'outlined'}
                clickable
                onClick={() => setSyncFilter('all')}
                data-testid="vocab-filter-all"
              />
              <Chip
                size="small"
                label={`未同步 ${unsyncedCount}`}
                color={syncFilter === 'unsynced' ? 'primary' : 'default'}
                variant={syncFilter === 'unsynced' ? 'filled' : 'outlined'}
                clickable
                disabled={unsyncedCount === 0}
                onClick={() => setSyncFilter('unsynced')}
                data-testid="vocab-filter-unsynced"
              />
              <Chip
                size="small"
                label={`已同步 ${syncedCount}`}
                color={syncFilter === 'synced' ? 'primary' : 'default'}
                variant={syncFilter === 'synced' ? 'filled' : 'outlined'}
                clickable
                disabled={syncedCount === 0}
                onClick={() => setSyncFilter('synced')}
                data-testid="vocab-filter-synced"
              />
            </Stack>
            {shownVocab.length === 0 ? (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  该筛选下没有单词。
                </Typography>
              </Box>
            ) : (
              <List>
                {shownVocab.map((entry) => {
                  const synced = isSynced(entry);
                  return (
                    <ListItem
                      key={entry.word}
                      alignItems="flex-start"
                      secondaryAction={
                        <Tooltip title="移除">
                          <IconButton
                            edge="end"
                            onClick={() => onRemove(entry.word)}
                            size="small"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      }
                    >
                      <ListItemText
                        primary={
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                              {entry.surface}
                            </Typography>
                            <Tooltip
                              title={
                                synced
                                  ? '已同步到 Anki。点击改为未同步,下次同步会重新添加。'
                                  : '尚未同步。点击改为已同步(适合已用其他方式导入 Anki 的词)。'
                              }
                            >
                              <Chip
                                size="small"
                                label={synced ? '已同步' : '未同步'}
                                color={synced ? 'success' : 'warning'}
                                variant="outlined"
                                clickable
                                onClick={() => handleToggleSynced(entry)}
                                data-testid={`vocab-sync-mark-${entry.word}`}
                                sx={{ height: 20, fontSize: '0.7rem' }}
                              />
                            </Tooltip>
                            <Chip
                              size="small"
                              label={`${entry.video} · ${formatTime(entry.time)}`}
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          </Stack>
                        }
                        secondary={
                          <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ fontStyle: 'italic' }}
                            >
                              {entry.sentence}
                            </Typography>
                            {entry.translation && (
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mt: 0.25 }}
                                data-testid="vocab-translation"
                              >
                                {entry.translation}
                              </Typography>
                            )}
                            {entry.definition && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block', mt: 0.5, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}
                              >
                                {entry.definition}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    </ListItem>
                  );
                })}
              </List>
            )}
          </>
        )}
      </Box>
    </Drawer>
  );
}
