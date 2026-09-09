/**
 * LearningSteps
 *
 * Top-of-app progress indicator for the learning workflow:
 *   定位 → 盲听 2 遍 → 听写 → 订正 → 跟读 2 遍 → 收词
 *
 * The user can advance/retreat with arrow buttons or click any step pill to
 * jump to it directly. A progress bar fills proportionally to the current
 * step.
 */
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import type { LearningStep } from '../types';

interface LearningStepsProps {
  steps: LearningStep[];
  currentIndex: number;
  onChange: (index: number) => void;
}

export function LearningSteps({
  steps,
  currentIndex,
  onChange,
}: LearningStepsProps): JSX.Element {
  const safeIndex = Math.max(0, Math.min(currentIndex, steps.length - 1));
  const current = steps[safeIndex];
  const progress = ((safeIndex + 1) / steps.length) * 100;

  const handlePrev = (): void => {
    onChange(Math.max(0, safeIndex - 1));
  };
  const handleNext = (): void => {
    onChange(Math.min(steps.length - 1, safeIndex + 1));
  };

  return (
    <Paper elevation={3} sx={{ p: 2, mb: 3 }}>
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            label={`步骤 ${safeIndex + 1} / ${steps.length}`}
            color="primary"
            size="small"
          />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {current?.title}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Tooltip title="上一步">
            <span>
              <IconButton onClick={handlePrev} disabled={safeIndex === 0}>
                <ArrowBackIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="下一步">
            <span>
              <IconButton
                onClick={handleNext}
                disabled={safeIndex === steps.length - 1}
              >
                <ArrowForwardIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {current?.description}
      </Typography>

      <Box
        sx={{
          width: '100%',
          height: 6,
          borderRadius: 3,
          backgroundColor: 'rgba(255,255,255,0.1)',
          overflow: 'hidden',
          mb: 1,
        }}
      >
        <Box
          sx={{
            width: `${progress}%`,
            height: '100%',
            backgroundColor: 'primary.main',
            transition: 'width 0.3s ease',
          }}
        />
      </Box>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {steps.map((step, idx) => {
          const isActive = idx === safeIndex;
          return (
            <Button
              key={step.key}
              size="small"
              variant={isActive ? 'contained' : 'outlined'}
              onClick={() => onChange(idx)}
              sx={{ minWidth: 0 }}
            >
              {idx + 1}. {step.title}
            </Button>
          );
        })}
      </Stack>
    </Paper>
  );
}