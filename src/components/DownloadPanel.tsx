/**
 * DownloadPanel — the 「下载中心」 view.
 *
 * A control surface over the server-side downloader (`server/downloader.mjs`):
 * paste a direct link, and the file is fetched by the local server into the
 * project's `downloads/` directory, surviving navigation and tab close.
 *
 * The panel deliberately contains no transfer state of its own — everything is
 * read back from the server, so leaving this view and returning shows the truth
 * rather than a stale local illusion.
 */
import { useCallback, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useDownloads } from '../hooks/useDownloads';
import {
  describeProgress,
  formatSpeed,
  isPlayableMedia,
  progressPercent,
  revealDownload,
  statusLabel,
  type DownloadStatus,
  type DownloadTask,
} from '../utils/downloader';

interface DownloadPanelProps {
  /** Hand a finished file to the study stage (sets it as the video source). */
  onUseForStudy?: (task: DownloadTask) => void;
}

const CHIP_COLOR: Record<DownloadStatus, 'default' | 'primary' | 'success' | 'error'> = {
  downloading: 'primary',
  paused: 'default',
  done: 'success',
  error: 'error',
  canceled: 'default',
};

export function DownloadPanel({ onUseForStudy }: DownloadPanelProps): JSX.Element {
  const {
    tasks,
    dir,
    available,
    loading,
    busy,
    error,
    start,
    pause,
    resume,
    cancel,
    remove,
  } = useDownloads();

  const [url, setUrl] = useState<string>('');
  const [filename, setFilename] = useState<string>('');
  const [hint, setHint] = useState<string>('');

  const handleStart = useCallback(async (): Promise<void> => {
    const trimmed = url.trim();
    if (!trimmed) {
      setHint('请先粘贴视频直链。');
      return;
    }
    setHint('');
    const ok = await start(trimmed, filename.trim() || undefined);
    if (ok) {
      setUrl('');
      setFilename('');
    }
  }, [filename, start, url]);

  /** Nothing downloads without a direct http(s) link — say so up front. */
  const disabled = !available || busy;

  return (
    <Box
      data-testid="download-panel"
      sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: { xs: 1.5, sm: 2 } }}
    >
      <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap" sx={{ mb: 0.5 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          下载中心
        </Typography>
        <Typography variant="body2" color="text.secondary">
          粘贴视频直链，由本机服务后台下载，下完可以直接拿来学
        </Typography>
      </Stack>

      {dir && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          保存到 <code>{dir}</code>
        </Typography>
      )}

      {!available && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          下载功能需要本机服务支持，请用项目根目录的 <code>start.bat</code> 启动应用。
        </Alert>
      )}

      <Paper elevation={3} sx={{ p: 1.5, mb: 1.5 }}>
        <Stack spacing={1}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              size="small"
              fullWidth
              label="视频直链"
              placeholder="粘贴视频直链（mp4 / m3u8 等可直连的文件）"
              value={url}
              disabled={disabled}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleStart();
              }}
              inputProps={{ 'data-testid': 'download-url-input' }}
            />
            <TextField
              size="small"
              sx={{ minWidth: { sm: 220 } }}
              label="保存为"
              placeholder="留空则按链接取名"
              value={filename}
              disabled={disabled}
              onChange={(event) => setFilename(event.target.value)}
              inputProps={{ 'data-testid': 'download-filename-input' }}
            />
            <Button
              variant="contained"
              onClick={() => void handleStart()}
              disabled={disabled}
              data-testid="download-start"
              sx={{ whiteSpace: 'nowrap' }}
            >
              开始下载
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            只支持你自己有权下载的直链。应用不提供也不检索任何影视资源。
          </Typography>
          {hint && (
            <Typography variant="caption" color="warning.main">
              {hint}
            </Typography>
          )}
        </Stack>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Typography variant="body2" color="text.secondary">
          正在读取下载列表…
        </Typography>
      ) : tasks.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          还没有下载任务。
        </Typography>
      ) : (
        <Stack spacing={1}>
          {tasks.map((task) => {
            const percent = progressPercent(task);
            const playable = task.status === 'done' && isPlayableMedia(task.filename);
            return (
              <Paper
                key={task.id}
                elevation={1}
                data-testid={`download-task-${task.id}`}
                sx={{ p: 1.25 }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  sx={{ mb: 0.75 }}
                >
                  <Typography
                    variant="subtitle2"
                    sx={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}
                  >
                    {task.filename}
                  </Typography>
                  <Chip
                    size="small"
                    color={CHIP_COLOR[task.status]}
                    variant={task.status === 'downloading' ? 'filled' : 'outlined'}
                    label={statusLabel(task.status)}
                    data-testid={`download-task-status-${task.id}`}
                  />
                </Stack>

                <LinearProgress
                  variant={percent === null ? 'indeterminate' : 'determinate'}
                  value={percent ?? undefined}
                />

                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  sx={{ mt: 0.75 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {describeProgress(task)}
                    {percent !== null ? ` · ${percent}%` : ''}
                  </Typography>
                  {task.status === 'downloading' && (
                    <Typography variant="caption" color="text.secondary">
                      {formatSpeed(task.speedBps)}
                    </Typography>
                  )}
                  <Box sx={{ flexGrow: 1 }} />

                  {task.status === 'downloading' && (
                    <Button size="small" disabled={busy} onClick={() => void pause(task.id)}>
                      暂停
                    </Button>
                  )}
                  {(task.status === 'paused' || task.status === 'error') && (
                    <Button size="small" disabled={busy} onClick={() => void resume(task.id)}>
                      继续
                    </Button>
                  )}
                  {(task.status === 'downloading' || task.status === 'paused') && (
                    <Button size="small" disabled={busy} onClick={() => void cancel(task.id)}>
                      取消
                    </Button>
                  )}
                  {playable && onUseForStudy && (
                    <Button
                      size="small"
                      variant="contained"
                      disabled={busy}
                      data-testid={`download-use-${task.id}`}
                      onClick={() => onUseForStudy(task)}
                    >
                      用来学习
                    </Button>
                  )}
                  {task.status === 'done' && (
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() => void revealDownload(task.id).catch(() => undefined)}
                    >
                      打开文件夹
                    </Button>
                  )}
                  <Button
                    size="small"
                    color="inherit"
                    disabled={busy}
                    onClick={() => void remove(task.id)}
                  >
                    删除
                  </Button>
                </Stack>

                {task.status === 'error' && task.error && (
                  <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.5 }}>
                    {task.error}
                  </Typography>
                )}
              </Paper>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
