/**
 * SubtitleOffsetControl
 *
 * Compact control to nudge the subtitle timeline (−1s … +1s steps) so the
 * subtitles stay in sync with the video/audio. Positive values delay the
 * subtitles; negative values make them appear earlier.
 */
import { Box, Button, Stack, Tooltip, Typography } from '@mui/material';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { formatOffset } from '../utils/subtitleOffset';

interface SubtitleOffsetControlProps {
  /** Current offset in seconds. */
  offset: number;
  onChange: (offset: number) => void;
}

const STEPS = [-1, -0.5, 0.5, 1];

export function SubtitleOffsetControl({
  offset,
  onChange,
}: SubtitleOffsetControlProps): JSX.Element {
  return (
    <Box
      sx={{
        p: 1.5,
        mb: 1,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: 1,
      }}
    >
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <Typography
          variant="subtitle2"
          sx={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 0.5 }}
        >
          <ScheduleIcon sx={{ fontSize: 16 }} /> 字幕对时
        </Typography>
        {STEPS.map((s) => (
          <Tooltip
            key={s}
            title={s < 0 ? '字幕提前出现' : '字幕延后出现'}
          >
            <Button
              size="small"
              variant="outlined"
              sx={{ minWidth: 0, px: 1, whiteSpace: 'nowrap' }}
              onClick={() => onChange(offset + s)}
            >
              {s > 0 ? `+${s}s` : `${s}s`}
            </Button>
          </Tooltip>
        ))}
        <Button
          size="small"
          variant="text"
          disabled={offset === 0}
          onClick={() => onChange(0)}
          sx={{ minWidth: 0, px: 1, whiteSpace: 'nowrap' }}
        >
          重置
        </Button>
        <Typography
          variant="caption"
          sx={{
            ml: 'auto',
            whiteSpace: 'nowrap',
            fontWeight: 600,
            color: offset === 0 ? 'text.secondary' : 'primary.main',
          }}
        >
          当前偏移:{formatOffset(offset)}
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        字幕比声音早 → 按 + 延后;字幕比声音晚 → 按 − 提前。
      </Typography>
    </Box>
  );
}
