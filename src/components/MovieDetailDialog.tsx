/**
 * MovieDetailDialog
 *
 * Full detail modal for a movie/series entry. Shows the poster, titles,
 * metadata, synopsis, tags, and a visual breakdown of the four learning
 * metrics (difficulty / speech rate / vocabulary / dialogue density, each
 * 1~5) so the user can judge fit at a glance.
 */
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import type { Level1to5, MovieEntry, MovieMediaType } from '../types';
import { difficultyLabel, GENRE_LABELS, LANG_LABELS } from '../utils/movieRecommend';

interface MovieDetailDialogProps {
  movie: MovieEntry | null;
  open: boolean;
  onClose(): void;
  isFavorite: boolean;
  isWatched: boolean;
  onToggleFavorite(): void;
  onToggleWatched(): void;
  posterUrl?: string | null;
  onStartLearning?(): void;
}

function mediaTypeLabel(type: MovieMediaType): string {
  return type === 'movie' ? '电影' : '剧集';
}

/** A single 1~5 metric shown as a 5-segment bar with a label. */
function MetricBar({
  label,
  level,
}: {
  label: string;
  level: Level1to5;
}) {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" color="text.secondary">
          {level} / 5
        </Typography>
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ mt: 0.25 }}>
        {([1, 2, 3, 4, 5] as const).map((seg) => (
          <Box
            key={seg}
            sx={{
              flex: 1,
              height: 8,
              borderRadius: 1,
              bgcolor: seg <= level ? 'primary.main' : 'action.hover',
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}

export function MovieDetailDialog({
  movie,
  open,
  onClose,
  isFavorite,
  isWatched,
  onToggleFavorite,
  onToggleWatched,
  posterUrl,
  onStartLearning,
}: MovieDetailDialogProps): JSX.Element {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-testid="movie-detail-dialog"
    >
      {movie && (
        <>
          <DialogTitle sx={{ pr: 6 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {movie.title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {movie.originalTitle} · {movie.year}
            </Typography>
            <IconButton
              onClick={onClose}
              size="small"
              sx={{ position: 'absolute', right: 8, top: 8 }}
              aria-label="关闭"
            >
              <CloseIcon />
            </IconButton>
          </DialogTitle>

          <DialogContent dividers>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Box
                sx={{
                  width: { xs: '100%', sm: 140 },
                  flexShrink: 0,
                  alignSelf: 'flex-start',
                }}
              >
                {posterUrl ? (
                  <Box
                    component="img"
                    src={posterUrl}
                    alt={movie.title}
                    sx={{
                      width: '100%',
                      aspectRatio: '2 / 3',
                      objectFit: 'cover',
                      borderRadius: 1,
                      display: 'block',
                      bgcolor: 'action.hover',
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: '100%',
                      aspectRatio: '2 / 3',
                      borderRadius: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'rgba(255,255,255,0.9)',
                      fontWeight: 700,
                      fontSize: '2.4rem',
                      background:
                        'linear-gradient(135deg, hsl(220 45% 32%), hsl(260 50% 18%))',
                    }}
                  >
                    {(movie.title || movie.originalTitle || '?').trim().charAt(0)}
                  </Box>
                )}
              </Box>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                  <Chip size="small" label={mediaTypeLabel(movie.mediaType)} variant="outlined" />
                  <Chip size="small" label={LANG_LABELS[movie.primaryLang]} color="primary" variant="outlined" />
                  <Chip size="small" label={`★ ${movie.rating.toFixed(1)}`} />
                  {movie.accent && (
                    <Chip size="small" label={movie.accent} variant="outlined" />
                  )}
                </Stack>

                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                  {movie.genres.map((g) => (
                    <Chip key={g} size="small" label={GENRE_LABELS[g]} />
                  ))}
                </Stack>

                <Typography variant="body2" sx={{ lineHeight: 1.7, mb: 1.5 }}>
                  {movie.synopsis}
                </Typography>

                {movie.tags.length > 0 && (
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                    {movie.tags.map((t) => (
                      <Chip
                        key={t}
                        size="small"
                        label={`#${t}`}
                        sx={{ height: 20, fontSize: '0.68rem' }}
                        variant="outlined"
                      />
                    ))}
                  </Stack>
                )}

                <Stack spacing={1.25} sx={{ mt: 0.5 }}>
                  <MetricBar label={`综合难度 · ${difficultyLabel(movie.difficulty)}`} level={movie.difficulty} />
                  <MetricBar label="语速" level={movie.speechRate} />
                  <MetricBar label="词汇难度" level={movie.vocabulary} />
                  <MetricBar label="对白密度" level={movie.dialogueDensity} />
                </Stack>
              </Box>
            </Stack>
          </DialogContent>

          <DialogActions sx={{ px: 2, py: 1.5 }}>
            <Button
              color={isFavorite ? 'warning' : 'inherit'}
              startIcon={isFavorite ? <StarIcon /> : <StarBorderIcon />}
              onClick={onToggleFavorite}
              data-testid="movie-detail-fav"
            >
              {isFavorite ? '已收藏' : '收藏'}
            </Button>
            <Button
              color={isWatched ? 'success' : 'inherit'}
              startIcon={isWatched ? <CheckCircleIcon /> : <CheckCircleOutlineIcon />}
              onClick={onToggleWatched}
              data-testid="movie-detail-watched"
            >
              {isWatched ? '已看' : '标为已看'}
            </Button>
            {onStartLearning && (
              <Button variant="contained" onClick={onStartLearning} data-testid="movie-detail-start">
                开始学习
              </Button>
            )}
            <Box sx={{ flexGrow: 1 }} />
            <Button onClick={onClose}>关闭</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
