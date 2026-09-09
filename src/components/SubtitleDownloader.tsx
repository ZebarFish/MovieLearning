/**
 * SubtitleDownloader
 *
 * UI for finding subtitle files online and managing the currently loaded
 * tracks. Two flows are supported:
 *   1. Search: click a chip → opens the matching subtitle site in a new tab.
 *   2. URL:  paste a direct link to a `.srt`/`.vtt` URL → fetched + parsed.
 *
 * Loaded tracks can be removed individually.
 */
import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  Paper,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { SubtitleTrack } from '../types';
import { SUBTITLE_SOURCES, fetchSubtitleText } from '../utils/subtitleSources';
import { parseSubtitles } from '../utils/subtitleParser';

interface SubtitleDownloaderProps {
  tracks: SubtitleTrack[];
  videoName: string;
  /** Called when a new track is loaded from URL and parsed. */
  onAddTrack: (track: SubtitleTrack) => void;
  /** Called when the user clicks the X on a loaded track. */
  onRemoveTrack: (id: string) => void;
}

export function SubtitleDownloader({
  tracks,
  videoName,
  onAddTrack,
  onRemoveTrack,
}: SubtitleDownloaderProps): JSX.Element {
  const [query, setQuery] = useState<string>(videoName || '');
  const [url, setUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleFetch = async (): Promise<void> => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      const text = await fetchSubtitleText(trimmed);
      const cues = parseSubtitles(text);
      if (cues.length === 0) {
        setError('下载的内容不是有效的 .srt/.vtt 字幕文件。');
        setLoading(false);
        return;
      }
      const track: SubtitleTrack = {
        id: `url-${Date.now()}`,
        label: '已加载 · URL',
        filename: trimmed.slice(trimmed.lastIndexOf('/') + 1) || 'subtitle.srt',
        lang: 'other',
        cues,
      };
      onAddTrack(track);
      setUrl('');
    } catch (err) {
      const hint = (() => {
        const m = String((err as Error).message);
        if (m.includes('Failed to fetch') || m.includes('CORS')) {
          return '（可能受 CORS 限制 — 请用搜索按钮打开下载页,下载后用左侧文件按钮加载）';
        }
        return '';
      })();
      setError(`下载失败:${(err as Error).message}${hint}`);
    } finally {
      setLoading(false);
    }
  };

  // Lightweight guess for "Desperate Housewives S01E01" filename style.
  function runQuickGuess(text: string): { name: string; url: string } | null {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    // Special-case: Desperate Housewives S01E01 fansub direct mirror is
    // unreliable, so we skip an automated fetch and just return a search link.
    return null;
  }

  return (
    <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        2. 查找 / 下载字幕
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        按顺序操作：搜索或直链下载 → 文件保存到本机 → 用上方「字幕文件」加载。
      </Typography>

      <Stack spacing={2.5} sx={{ maxWidth: 640 }}>
        {/* 2a. Quick search */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            🔍 关键词搜索
          </Typography>
          <TextField
            size="small"
            fullWidth
            placeholder="输入剧名和集数,例如:Desperate Housewives S01E01"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ mb: 1.5 }}
          />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {SUBTITLE_SOURCES.map((src) => (
              <Button
                key={src.label}
                size="small"
                variant="outlined"
                startIcon={<OpenInNewIcon />}
                endIcon={
                  <Chip
                    label={src.tag}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: '0.65rem',
                      ml: 0.5,
                      bgcolor: src.lang === 'en' ? '#1976d2' : '#d32f2f',
                      color: '#fff',
                    }}
                  />
                }
                onClick={() => {
                  const q = query.trim() || videoName || 'English subtitle';
                  window.open(src.url(q), '_blank', 'noopener,noreferrer');
                }}
              >
                {src.label}
              </Button>
            ))}
          </Stack>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 1, lineHeight: 1.5 }}
          >
            点击按钮在新标签页打开对应字幕站的搜索结果，找到 .srt 文件下载到本机。
          </Typography>
        </Box>

        {/* 2b. URL fetch */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            🔗 通过 URL 直接获取
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              placeholder="https://example.com/sub.srt"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleFetch();
              }}
            />
            <Button
              variant="contained"
              startIcon={
                loading ? <CircularProgress size={16} /> : <DownloadIcon />
              }
              onClick={() => void handleFetch()}
              disabled={loading || !url.trim()}
              sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              获取
            </Button>
          </Stack>
          {error && (
            <Typography
              variant="caption"
              color="error"
              sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}
            >
              {error}
            </Typography>
          )}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 1, lineHeight: 1.5 }}
          >
            ⚠️ 多数字幕服务没开 CORS，直接获取可能失败；失败时请用上面的搜索方式下载到本机再加载。
          </Typography>
        </Box>
      </Stack>

      {/* 2c. Loaded tracks list */}
      <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2" gutterBottom>
          📄 当前已加载的字幕 {tracks.length > 0 && `(${tracks.length})`}
        </Typography>
        {tracks.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            还没有字幕。通过上方任一方式添加后，这里会显示列表。
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {tracks.map((t) => (
              <Chip
                key={t.id}
                label={`${t.label} · ${t.cues.length} 条`}
                onDelete={() => onRemoveTrack(t.id)}
                deleteIcon={<DeleteOutlineIcon />}
                sx={{ mb: 1 }}
                color="primary"
                variant="outlined"
              />
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}
