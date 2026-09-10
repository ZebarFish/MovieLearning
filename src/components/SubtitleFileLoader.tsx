/**
 * SubtitleFileLoader
 *
 * Compact subtitle-file picker. Load a local .srt / .vtt file — the
 * language is auto-detected from the subtitle text (CJK / kana / hangul
 * heuristics) and the parsed track is forwarded to the parent via
 * onAddTrack.
 *
 * `collapsible` renders a single-line header that expands on click — used
 * on the main stage to keep the right column compact.
 */
import { useRef, useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SubtitlesIcon from '@mui/icons-material/Subtitles';
import type { SubtitleLang, SubtitleTrack } from '../types';
import { parseSubtitles } from '../utils/subtitleParser';

const LANG_LABELS: Record<SubtitleLang, string> = {
  en: 'English',
  zh: '中文 (简体)',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  other: '其它',
};

/**
 * Guess subtitle language from its text content.
 * Priority: kana → ja, hangul → ko, CJK-heavy → zh, otherwise en.
 */
export function detectSubtitleLang(text: string): SubtitleLang {
  const kana = (text.match(/[\u3040-\u30ff]/g) ?? []).length;
  if (kana > 0) return 'ja';
  const hangul = (text.match(/[\uac00-\ud7af]/g) ?? []).length;
  if (hangul > 0) return 'ko';
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cjk > 0 && cjk > latin * 0.3) return 'zh';
  return 'en';
}

interface SubtitleFileLoaderProps {
  onAddTrack: (track: SubtitleTrack) => void;
  /** Render as a collapsible one-line panel (default: always expanded). */
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

export function SubtitleFileLoader({
  onAddTrack,
  collapsible = false,
  defaultExpanded = true,
}: SubtitleFileLoaderProps): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<boolean>(
    collapsible ? defaultExpanded : true,
  );
  const [lastName, setLastName] = useState<string>('');
  const [lastLang, setLastLang] = useState<SubtitleLang | null>(null);
  const [error, setError] = useState<string>('');

  const handleFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    setError('');
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const cues = parseSubtitles(text);
      if (cues.length === 0) {
        setError('无法解析该字幕文件。请确认它是有效的 .srt 或 .vtt 文件。');
        setLastName(`${file.name} (解析失败)`);
        setLastLang(null);
        return;
      }
      const lang = detectSubtitleLang(cues.map((c) => c.text).join('\n'));
      const track: SubtitleTrack = {
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: LANG_LABELS[lang],
        filename: file.name,
        lang,
        cues,
      };
      onAddTrack(track);
      setLastName(file.name);
      setLastLang(lang);
    } catch (err) {
      setError(`读取字幕文件失败:${(err as Error).message}`);
      setLastName(`${file.name} (读取失败)`);
      setLastLang(null);
    }
  };

  const content = (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: collapsible ? 1 : 0 }}>
      <input
        ref={fileRef}
        type="file"
        accept=".srt,.vtt,text/plain,text/vtt"
        hidden
        onChange={(e) => {
          void handleFile(e);
        }}
      />
      <Button
        variant="outlined"
        size="small"
        startIcon={<SubtitlesIcon />}
        onClick={() => fileRef.current?.click()}
        sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
      >
        加载字幕文件
      </Button>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}
      >
        {error
          ? error
          : lastName && lastLang
            ? `已加载 ${LANG_LABELS[lastLang]} · ${lastName}(语言自动识别)`
            : '支持 .srt / .vtt,语言自动识别'}
      </Typography>
    </Stack>
  );

  return (
    <Paper
      elevation={3}
      sx={{
        p: 1.5,
        mb: 1,
        backgroundColor: 'rgba(255,255,255,0.04)',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        onClick={collapsible ? () => setExpanded((v) => !v) : undefined}
        sx={{
          cursor: collapsible ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        <Typography variant="subtitle2" sx={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          📄 字幕文件
        </Typography>
        {collapsible && !expanded && (
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {lastName ? lastName : '加载本地 .srt / .vtt 字幕(点此展开)'}
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
      {collapsible ? <Collapse in={expanded}>{content}</Collapse> : content}
    </Paper>
  );
}
