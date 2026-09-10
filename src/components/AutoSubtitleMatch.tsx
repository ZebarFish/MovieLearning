/**
 * AutoSubtitleMatch
 *
 * One-click subtitle lookup for the loaded local video via OpenSubtitles
 * hash matching (accurate — same rip = same subtitles). Requires a free
 * API key; it is stored in localStorage.
 *
 * `collapsible` renders a single-line header that expands on click — used
 * on the main stage so the panel stays discoverable without eating space.
 * In the media drawer it renders fully expanded.
 */
import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Link,
  List,
  ListItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import DownloadIcon from '@mui/icons-material/Download';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { SubtitleCue, SubtitleLang, SubtitleTrack } from '../types';
import {
  computeOpenSubtitlesHash,
  downloadSubtitle,
  fetchSubtitleCues,
  getStoredApiKey,
  osLangToLang,
  searchSubtitles,
  storeApiKey,
  type SubtitleCandidate,
} from '../utils/opensubtitles';

interface AutoSubtitleMatchProps {
  /** The loaded local video file (hash cannot be computed for URLs). */
  videoFile: File | null;
  onAddTrack: (track: SubtitleTrack) => void;
  /** Render as a collapsible one-line panel (default: always expanded). */
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

export function AutoSubtitleMatch({
  videoFile,
  onAddTrack,
  collapsible = false,
  defaultExpanded = true,
}: AutoSubtitleMatchProps): JSX.Element {
  const [expanded, setExpanded] = useState<boolean>(
    collapsible ? defaultExpanded : true,
  );
  const [apiKey, setApiKey] = useState<string>(getStoredApiKey());
  const [searching, setSearching] = useState<boolean>(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [results, setResults] = useState<SubtitleCandidate[]>([]);
  const [error, setError] = useState<string>('');
  const [info, setInfo] = useState<string>('');

  const handleSaveKey = (): void => {
    storeApiKey(apiKey.trim());
    setInfo(apiKey.trim() ? 'API Key 已保存。' : 'API Key 已清除。');
    setError('');
  };

  const handleSearch = async (): Promise<void> => {
    setError('');
    setInfo('');
    setResults([]);
    if (!apiKey.trim()) {
      setError('请先填入 OpenSubtitles API Key(免费申请,见上方链接)。');
      return;
    }
    if (!videoFile) {
      setError(
        '自动匹配需要本地视频文件(通过 URL 播放的视频无法计算哈希,请用下方搜索方式)。',
      );
      return;
    }
    storeApiKey(apiKey.trim());
    setSearching(true);
    try {
      const hash = await computeOpenSubtitlesHash(videoFile);
      const found = await searchSubtitles(apiKey.trim(), hash);
      setResults(found);
      if (found.length === 0) {
        setInfo('哈希匹配没有找到字幕。可尝试下方关键词搜索,或确认视频是原版文件(转码过的可能匹配不到)。');
      } else {
        setInfo(`找到 ${found.length} 条匹配字幕,按下载量排序,点击「加载」直接导入。`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const handleLoad = async (c: SubtitleCandidate): Promise<void> => {
    if (c.fileId === null) return;
    setError('');
    setInfo('');
    setLoadingId(c.id);
    try {
      const { link, remaining } = await downloadSubtitle(apiKey.trim(), c.fileId);
      const cues: SubtitleCue[] = await fetchSubtitleCues(link);
      if (cues.length === 0) {
        throw new Error('下载的字幕内容无法解析。');
      }
      const lang: SubtitleLang = osLangToLang(c.language) as SubtitleLang;
      const track: SubtitleTrack = {
        id: `os-${c.id}-${Date.now()}`,
        label: `OpenSubtitles · ${c.language}`,
        filename: c.release || `opensubtitles-${c.id}`,
        lang,
        cues,
      };
      onAddTrack(track);
      setInfo(
        `已加载「${c.release || c.id}」(${cues.length} 条)` +
          (remaining !== null ? ` · 剩余下载额度:${remaining}` : ''),
      );
    } catch (err) {
      const msg = (err as Error).message;
      setError(
        `${msg} 若下载失败,可点该条目的 🔗 打开网页手动下载后用「加载字幕文件」导入。`,
      );
    } finally {
      setLoadingId(null);
    }
  };

  const body = (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        根据视频文件特征哈希精确匹配字幕 — 准确率远高于按文件名搜索。
        需要免费的 OpenSubtitles API Key。
      </Typography>

      {/* API key row */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ sm: 'center' }}
        sx={{ mb: 2 }}
      >
        <TextField
          size="small"
          type="password"
          label="OpenSubtitles API Key"
          placeholder="粘贴你的 API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          sx={{ flex: 1 }}
        />
        <Button size="small" variant="outlined" onClick={handleSaveKey}>
          保存
        </Button>
        <Tooltip title="免费注册后,在 Account → API keys 页面创建">
          <Link
            href="https://www.opensubtitles.com/zh-cn/apikey"
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            sx={{ display: 'flex', alignItems: 'center', fontSize: '0.8rem' }}
          >
            免费申请 <OpenInNewIcon sx={{ fontSize: 14, ml: 0.25 }} />
          </Link>
        </Tooltip>
      </Stack>

      {/* Search button */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Button
          variant="contained"
          startIcon={searching ? undefined : <AutoFixHighIcon />}
          onClick={() => void handleSearch()}
          disabled={searching || !videoFile}
        >
          {searching ? '正在计算哈希并搜索…' : '🔍 根据视频自动搜索字幕'}
        </Button>
        {!videoFile && (
          <Typography variant="caption" color="text.secondary">
            （需要先加载本地视频文件）
          </Typography>
        )}
      </Stack>

      {(info || error) && (
        <Typography
          variant="caption"
          color={error ? 'error' : 'text.secondary'}
          sx={{ display: 'block', mb: 1, lineHeight: 1.5 }}
        >
          {error || info}
        </Typography>
      )}

      {/* Results */}
      {results.length > 0 && (
        <List dense sx={{ maxHeight: 320, overflowY: 'auto' }}>
          {[...results]
            .sort((a, b) => b.downloads - a.downloads)
            .map((c) => (
              <ListItem
                key={c.id}
                sx={{
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  py: 0.75,
                }}
                secondaryAction={
                  <Box>
                    <Tooltip title={c.fileId === null ? '该条目无直接下载文件' : '下载并加载'}>
                      <span>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<DownloadIcon />}
                          disabled={c.fileId === null || loadingId !== null}
                          onClick={() => void handleLoad(c)}
                        >
                          {loadingId === c.id ? '加载中…' : '加载'}
                        </Button>
                      </span>
                    </Tooltip>
                    <Tooltip title="打开字幕网页(手动下载备用)">
                      <Button
                        size="small"
                        href={c.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ minWidth: 0, px: 0.5 }}
                      >
                        🔗
                      </Button>
                    </Tooltip>
                  </Box>
                }
              >
                <Box sx={{ pr: 12, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      label={c.language}
                      color={
                        c.language.toLowerCase().startsWith('zh')
                          ? 'secondary'
                          : 'primary'
                      }
                      variant="outlined"
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                    {c.hearingImpaired && (
                      <Chip
                        size="small"
                        label="听力版"
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                    )}
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      mt: 0.25,
                    }}
                  >
                    {c.release || c.id} · ⬇ {c.downloads.toLocaleString()} · ⭐{' '}
                    {c.rating.toFixed(1)}
                  </Typography>
                </Box>
              </ListItem>
            ))}
        </List>
      )}
    </>
  );

  return (
    <Paper elevation={3} sx={{ p: collapsible ? 1.5 : 3, mb: 1 }}>
      {/* Header — clickable when collapsible. */}
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        onClick={collapsible ? () => setExpanded((v) => !v) : undefined}
        sx={{
          cursor: collapsible ? 'pointer' : 'default',
          userSelect: 'none',
          py: collapsible ? 0.5 : 0,
        }}
      >
        <Typography variant={collapsible ? 'subtitle2' : 'h6'}>
          ⚡ 自动匹配字幕{collapsible ? '' : '（推荐）'}
        </Typography>
        {collapsible && !expanded && (
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            根据视频哈希精确匹配字幕(点此展开)
          </Typography>
        )}
        {collapsible && (
          <IconButton
            size="small"
            aria-label={expanded ? '收起' : '展开'}
            sx={{
              ml: 'auto',
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s',
            }}
          >
            <ExpandMoreIcon />
          </IconButton>
        )}
      </Stack>
      {collapsible ? <Collapse in={expanded}>{body}</Collapse> : body}
    </Paper>
  );
}
