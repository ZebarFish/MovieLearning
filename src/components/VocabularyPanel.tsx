/**
 * VocabularyPanel
 *
 * Right-side MUI Drawer that shows the user's collected vocabulary and
 * provides Anki sync (via AnkiConnect), .txt export fallback, and clear-all.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
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
import type { VocabWord } from '../types';
import { downloadAnkiExport } from '../utils/ankiExport';
import {
  checkAnkiConnection,
  syncVocabToAnki,
  listAnkiDecks,
  listAnkiNoteTypes,
  type AnkiConnectionStatus,
  type SyncResult,
} from '../utils/ankiConnect';
import { formatTime } from '../utils/subtitleParser';

interface VocabularyPanelProps {
  open: boolean;
  onClose: () => void;
  vocab: VocabWord[];
  onRemove: (word: string) => void;
  onClearAll: () => void;
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
}: VocabularyPanelProps): JSX.Element {
  const [deck, setDeck] = useState<string>(() => loadSetting(DECK_KEY, 'Default'));
  const [noteType, setNoteType] = useState<string>(() => loadSetting(NOTE_KEY, 'Basic'));
  const [conn, setConn] = useState<AnkiConnectionStatus | null>(null);
  const [checking, setChecking] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string>('');
  const [deckOptions, setDeckOptions] = useState<string[]>([]);
  const [noteOptions, setNoteOptions] = useState<string[]>([]);

  // Probe AnkiConnect each time the drawer opens, and pull real deck /
  // note-type lists so the user picks from what actually exists.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChecking(true);
    setSyncResult(null);
    setSyncError('');
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
          // Fix saved settings that no longer exist in this collection.
          setDeck((cur) => (deckList.includes(cur) ? cur : deckList[0] ?? cur));
          setNoteType((cur) => (noteList.includes(cur) ? cur : noteList[0] ?? cur));
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

  const handleSync = async (): Promise<void> => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError('');
    try {
      const result = await syncVocabToAnki(
        vocab,
        deck.trim() || '系统默认',
        noteType.trim() || 'Basic',
      );
      setSyncResult(result);
    } catch (err) {
      setSyncError((err as Error).message);
    } finally {
      setSyncing(false);
    }
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
        sx: { width: { xs: '100%', sm: 420 }, maxWidth: '100%' },
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
            disabled={vocab.length === 0 || syncing || !conn?.ok}
            fullWidth
            data-testid="anki-sync-btn"
          >
            一键同步到 Anki
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

        {/* Deck / note type config (only meaningful when connected). */}
        {conn?.ok && (
          <>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
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
                {noteOptions.length > 0 ? (
                  noteOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))
                ) : (
                  <option value={noteType}>{noteType}</option>
                )}
              </TextField>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              查重只针对上方牌组:其他牌组(如课程词书)有同一个词不影响同步。
            </Typography>
          </>
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
        {conn && !conn.ok && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, lineHeight: 1.5 }}>
            💡 启用一键同步: 打开 Anki → 工具 → 插件 → 获取插件,输入代码
            <strong> 2055492159</strong>,重启 Anki。然后在插件配置中把
            <code> "webCorsOriginList": ["*"] </code>加入 config.json。
          </Typography>
        )}
        {!conn?.ok && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            导出的 .txt 可在 Anki 中「文件 → 导入」。翻译字段留空，请在 Anki 中补全。
          </Typography>
        )}
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
          <List>
            {vocab.map((entry) => (
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
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {entry.surface}
                      </Typography>
                      <Chip
                        size="small"
                        label={`${entry.video} · ${formatTime(entry.time)}`}
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                    </Stack>
                  }
                  secondary={
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5, fontStyle: 'italic' }}
                    >
                      {entry.sentence}
                    </Typography>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Drawer>
  );
}
