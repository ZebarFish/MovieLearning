/**
 * MovieCard
 *
 * A single movie/series card in the discovery grid. Shows a poster (or a
 * tasteful placeholder when no poster URL is available), key learning
 * metrics, a few genre chips, a recommendation reason, and a compact action
 * row (favorite / watched / hide / detail). The "开始学习" button is only
 * rendered when the parent passes `onStartLearning`.
 */
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import type { MovieEntry, MovieMediaType } from '../types';
import { difficultyLabel, GENRE_LABELS, LANG_LABELS } from '../utils/movieRecommend';

interface MovieCardProps {
  movie: MovieEntry;
  isFavorite: boolean;
  isWatched: boolean;
  onToggleFavorite(): void;
  onToggleWatched(): void;
  onHide(): void;
  onOpenDetail(): void;
  onStartLearning?(): void;
  /** Recommendation reason, from describeFit. */
  fitReason?: string;
  /** Poster direct URL; null/undefined → render a placeholder block. */
  posterUrl?: string | null;
}

function mediaTypeLabel(type: MovieMediaType): string {
  return type === 'movie' ? '电影' : '剧集';
}

/** Deterministic gradient so each placeholder looks intentional, not blank. */
function posterGradient(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) % 360;
  }
  const h2 = (h + 38) % 360;
  return `linear-gradient(135deg, hsl(${h} 52% 38%), hsl(${h2} 58% 20%))`;
}

function Poster({
  movie,
  posterUrl,
  onOpenDetail,
}: {
  movie: MovieEntry;
  posterUrl?: string | null;
  onOpenDetail(): void;
}) {
  const ratioBox = {
    position: 'relative',
    width: '100%',
    aspectRatio: '2 / 3',
    bgcolor: 'action.hover',
    overflow: 'hidden',
  } as const;

  if (posterUrl) {
    return (
      <CardActionArea onClick={onOpenDetail} data-testid={`movie-card-poster-${movie.id}`}>
        <Box
          component="img"
          src={posterUrl}
          alt={movie.title}
          sx={{
            ...ratioBox,
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </CardActionArea>
    );
  }

  // Placeholder: gradient fill + first character + title at the bottom.
  const initial = (movie.title || movie.originalTitle || '?').trim().charAt(0);
  return (
    <CardActionArea
      onClick={onOpenDetail}
      data-testid={`movie-card-poster-${movie.id}`}
      sx={{ ...ratioBox, background: posterGradient(movie.id || movie.title) }}
    >
      <Typography
        variant="h2"
        sx={{
          position: 'absolute',
          top: '30%',
          left: 0,
          right: 0,
          textAlign: 'center',
          color: 'rgba(255,255,255,0.85)',
          fontWeight: 700,
          fontSize: '3.2rem',
          lineHeight: 1,
          userSelect: 'none',
        }}
      >
        {initial}
      </Typography>
      <Typography
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          p: 1,
          color: 'rgba(255,255,255,0.95)',
          fontSize: '0.8rem',
          fontWeight: 600,
          textShadow: '0 1px 3px rgba(0,0,0,0.5)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {movie.title || movie.originalTitle}
      </Typography>
    </CardActionArea>
  );
}

export function MovieCard({
  movie,
  isFavorite,
  isWatched,
  onToggleFavorite,
  onToggleWatched,
  onHide,
  onOpenDetail,
  onStartLearning,
  fitReason,
  posterUrl,
}: MovieCardProps): JSX.Element {
  const genres = movie.genres.slice(0, 3);

  return (
    <Card
      elevation={2}
      sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      data-testid={`movie-card-${movie.id}`}
    >
      <Poster movie={movie} posterUrl={posterUrl} onOpenDetail={onOpenDetail} />

      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.75, p: 1.25 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
            {movie.title}
          </Typography>
          {movie.originalTitle && (
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {movie.originalTitle} · {movie.year}
            </Typography>
          )}
        </Box>

        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            label={mediaTypeLabel(movie.mediaType)}
            color="default"
            variant="outlined"
            sx={{ height: 20, fontSize: '0.7rem' }}
          />
          <Typography variant="caption" color="text.secondary">
            {difficultyLabel(movie.difficulty)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            ★ {movie.rating.toFixed(1)}
          </Typography>
          <Chip
            size="small"
            label={LANG_LABELS[movie.primaryLang]}
            color="primary"
            variant="outlined"
            sx={{ height: 20, fontSize: '0.7rem' }}
          />
        </Stack>

        {genres.length > 0 && (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {genres.map((g) => (
              <Chip
                key={g}
                size="small"
                label={GENRE_LABELS[g]}
                sx={{ height: 20, fontSize: '0.68rem' }}
              />
            ))}
          </Stack>
        )}

        {fitReason && (
          <Typography
            variant="caption"
            color="secondary.main"
            sx={{ lineHeight: 1.4, display: 'block' }}
          >
            {fitReason}
          </Typography>
        )}

        <Box sx={{ flex: 1 }} />

        <Stack
          direction="row"
          spacing={0.25}
          alignItems="center"
          justifyContent="space-between"
          sx={{ mt: 0.5 }}
        >
          <Stack direction="row" spacing={0.25} alignItems="center">
            <Tooltip title={isFavorite ? '取消收藏' : '收藏'}>
              <IconButton
                size="small"
                color={isFavorite ? 'warning' : 'default'}
                onClick={onToggleFavorite}
                data-testid={`movie-card-fav-${movie.id}`}
                aria-label={isFavorite ? '取消收藏' : '收藏'}
              >
                {isFavorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title={isWatched ? '取消已看' : '标为已看'}>
              <IconButton
                size="small"
                color={isWatched ? 'success' : 'default'}
                onClick={onToggleWatched}
                data-testid={`movie-card-watched-${movie.id}`}
                aria-label={isWatched ? '取消已看' : '已看'}
              >
                {isWatched ? <CheckCircleIcon fontSize="small" /> : <CheckCircleOutlineIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title="隐藏此片">
              <IconButton
                size="small"
                onClick={onHide}
                data-testid={`movie-card-hide-${movie.id}`}
                aria-label="隐藏"
              >
                <VisibilityOffIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>

          <Tooltip title="查看详情">
            <Button
              size="small"
              onClick={onOpenDetail}
              data-testid={`movie-card-detail-${movie.id}`}
            >
              详情
            </Button>
          </Tooltip>
        </Stack>

        {onStartLearning && (
          <Button
            variant="contained"
            size="small"
            fullWidth
            sx={{ mt: 0.5 }}
            onClick={onStartLearning}
            data-testid={`movie-card-start-${movie.id}`}
          >
            开始学习
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
