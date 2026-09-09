/**
 * VideoSelector
 *
 * Drawer controls that let the user pick a video (file or URL). Subtitle
 * files are loaded from the SubtitleFileLoader above the subtitle list on
 * the main stage.
 */
import { useRef, useState } from 'react';
import {
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import LinkIcon from '@mui/icons-material/Link';
import type { VideoSource } from '../types';
import { detectKind, MEDIA_FILE_INPUT_ATTR } from '../utils/mediaFile';

interface VideoSelectorProps {
  videoName: string;
  onVideoChange: (source: VideoSource | null) => void;
}

export function VideoSelector({
  videoName,
  onVideoChange,
}: VideoSelectorProps) {
  const mediaFileRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState<string>('');
  const [mediaFileName, setMediaFileName] = useState<string>('');
  const [mediaKind, setMediaKind] = useState<'video' | 'audio'>('video');

  const handleMediaFile = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    const kind = detectKind(file);
    setMediaFileName(file.name);
    setMediaKind(kind);
    onVideoChange({
      src: objectUrl,
      name: file.name,
      isRemote: false,
      kind,
    });
  };

  const handleUrlSubmit = (): void => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    // Heuristic: URL ending in audio extension => audio; otherwise video.
    const lower = trimmed.toLowerCase().split(/[?#]/)[0];
    const kind: 'video' | 'audio' = /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/.test(
      lower,
    )
      ? 'audio'
      : 'video';
    onVideoChange({
      src: trimmed,
      name: trimmed,
      isRemote: true,
      kind,
    });
    setMediaFileName(trimmed);
    setMediaKind(kind);
  };

  return (
    <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom>
        1. 选择视频
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        选择本地视频 / 音频文件，或粘贴视频 URL。
      </Typography>

      <Stack spacing={2.5}>
        {/* 1a. Local media file */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            🎬 本地视频 / 音频文件
          </Typography>
          <input
            ref={mediaFileRef}
            type="file"
            accept={MEDIA_FILE_INPUT_ATTR}
            hidden
            onChange={handleMediaFile}
          />
          <Button
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={() => mediaFileRef.current?.click()}
            fullWidth
            sx={{ whiteSpace: 'nowrap' }}
          >
            选择视频或音频文件
          </Button>
          {mediaFileName && (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                mt: 0.5,
                color: 'primary.main',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              当前:{mediaFileName}
            </Typography>
          )}
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5, lineHeight: 1.4 }}
          >
            视频推荐 MP4 (H.264 + AAC)；音频支持 MP3 / M4A / WAV / OGG 等。
          </Typography>
          {mediaKind === 'audio' && mediaFileName && (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                mt: 0.5,
                color: 'primary.main',
                fontWeight: 500,
              }}
            >
              🎧 当前为音频模式 — 滚动选择字幕与变速播放
            </Typography>
          )}
        </Box>

        {/* 1b. Video URL */}
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            🔗 视频 URL
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              placeholder="https://example.com/video.mp4"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUrlSubmit();
              }}
            />
            <Button
              variant="contained"
              startIcon={<LinkIcon />}
              onClick={handleUrlSubmit}
              disabled={!urlInput.trim()}
              sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              加载
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            当前视频:{videoName || '（未选择）'}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5, lineHeight: 1.5 }}
          >
            💡 字幕文件请在主界面右侧「📄 字幕文件」处加载。
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}
