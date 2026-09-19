/**
 * MovieDiscover
 *
 * Full-screen "discovery" view: pick a film/series to practice listening on.
 * Browsing + filtering + favorites only — wiring into the study flow is a
 * reserved callback (`onStartLearning`) that the host app does not pass yet.
 *
 * Data flow:
 *   MOVIE_CATALOG → applyPrefs (drop hidden) → filterMovies → sortMovies
 *   (or pickBatch when the user hits "换一批" on the 综合推荐 sort).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import type {
  Level1to5,
  MovieEntry,
  MovieFilter,
  MovieGenre,
  MovieSortKey,
  SubtitleLang,
} from '../types';
import { CATALOG_LANGS, MOVIE_CATALOG } from '../data/movieCatalog';
import {
  ALL_GENRES,
  applyPrefs,
  DEFAULT_FILTER,
  describeFit,
  difficultyLabel,
  filterMovies,
  GENRE_LABELS,
  LANG_LABELS,
  pickBatch,
  sortMovies,
} from '../utils/movieRecommend';
import { fetchPosterUrl, hasTmdbApiKey } from '../utils/tmdb';
import { useMoviePrefs } from '../hooks/useMoviePrefs';
import { CollapsiblePanel } from './CollapsiblePanel';
import { MovieCard } from './MovieCard';
import { MovieDetailDialog } from './MovieDetailDialog';

interface MovieDiscoverProps {
  /** Reserved: invoked when the user wants to study this title. Wired later. */
  onStartLearning?(movie: MovieEntry): void;
}

/** How many titles a single "换一批" batch surfaces. */
const BATCH_SIZE = 12;

const SORT_OPTIONS: { value: MovieSortKey; label: string }[] = [
  { value: 'match', label: '综合推荐' },
  { value: 'rating', label: '评分最高' },
  { value: 'difficulty-asc', label: '由易到难' },
  { value: 'difficulty-desc', label: '由难到易' },
  { value: 'year', label: '最新' },
];

function DifficultySelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Level1to5;
  onChange(next: Level1to5): void;
}) {
  return (
    <FormControl size="small" sx={{ minWidth: 110 }}>
      <InputLabel>{label}</InputLabel>
      <Select
        label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as Level1to5)}
      >
        {([1, 2, 3, 4, 5] as const).map((lv) => (
          <MenuItem key={lv} value={lv}>
            {difficultyLabel(lv)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export function MovieDiscover({ onStartLearning }: MovieDiscoverProps): JSX.Element {
  const { prefs, isFavorite, isWatched, toggleFavorite, toggleWatched, toggleHidden } =
    useMoviePrefs();

  const [filter, setFilter] = useState<MovieFilter>(DEFAULT_FILTER);
  const [sort, setSort] = useState<MovieSortKey>('match');
  // null → use sortMovies; a number → use pickBatch with that seed (match only).
  const [batchSeed, setBatchSeed] = useState<number | null>(null);
  const [detailMovie, setDetailMovie] = useState<MovieEntry | null>(null);

  // --- Filter mutations (each resets the "换一批" batch) --------------------
  const resetBatch = (): void => setBatchSeed(null);

  const toggleLang = (lang: SubtitleLang): void => {
    resetBatch();
    setFilter((f) => {
      const has = f.langs.includes(lang);
      return {
        ...f,
        langs: has ? f.langs.filter((l) => l !== lang) : [...f.langs, lang],
      };
    });
  };

  const toggleGenre = (genre: MovieGenre): void => {
    resetBatch();
    setFilter((f) => {
      const has = f.genres.includes(genre);
      return {
        ...f,
        genres: has ? f.genres.filter((g) => g !== genre) : [...f.genres, genre],
      };
    });
  };

  const setDifficultyMin = (next: Level1to5): void => {
    resetBatch();
    setFilter((f) => ({
      ...f,
      difficulty: [next, next > f.difficulty[1] ? next : f.difficulty[1]],
    }));
  };

  const setDifficultyMax = (next: Level1to5): void => {
    resetBatch();
    setFilter((f) => ({
      ...f,
      difficulty: [next < f.difficulty[0] ? next : f.difficulty[0], next],
    }));
  };

  const setMediaType = (value: MovieFilter['mediaType']): void => {
    if (value === null) return;
    resetBatch();
    setFilter((f) => ({ ...f, mediaType: value }));
  };

  const setQuery = (value: string): void => {
    resetBatch();
    setFilter((f) => ({ ...f, query: value }));
  };

  const changeSort = (value: MovieSortKey): void => {
    setBatchSeed(null);
    setSort(value);
  };

  const resetFilters = (): void => {
    setFilter(DEFAULT_FILTER);
    setSort('match');
    setBatchSeed(null);
  };

  const shuffleBatch = (): void => {
    setBatchSeed((s) => (s === null ? 1 : s + 1));
  };

  // --- Derived list --------------------------------------------------------
  const catalogAfterPrefs = useMemo(() => applyPrefs(MOVIE_CATALOG, prefs), [prefs]);
  const filtered = useMemo(
    () => filterMovies(catalogAfterPrefs, filter),
    [catalogAfterPrefs, filter],
  );
  const list = useMemo<MovieEntry[]>(() => {
    if (batchSeed !== null && sort === 'match') {
      const size = Math.min(filtered.length, BATCH_SIZE);
      return pickBatch(filtered, size, batchSeed);
    }
    return sortMovies(filtered, sort, filter, prefs);
  }, [filtered, sort, batchSeed, filter, prefs]);

  // --- Optional TMDB poster backfill (graceful, key-detected) ---------------
  const [posterMap, setPosterMap] = useState<Record<string, string>>({});
  const hasKey = hasTmdbApiKey();
  useEffect(() => {
    if (!hasKey) {
      setPosterMap({});
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const m of list) {
        if (m.tmdbId == null) continue;
        try {
          const url = await fetchPosterUrl(m.tmdbId, controller.signal);
          if (url) next[m.id] = url;
        } catch {
          /* skip — placeholder shows instead */
        }
      }
      if (!cancelled) setPosterMap(next);
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [hasKey, list]);

  const handleHide = (movie: MovieEntry): void => {
    toggleHidden(movie.id);
    if (detailMovie?.id === movie.id) setDetailMovie(null);
  };

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        p: { xs: 1.5, sm: 2 },
      }}
      data-testid="movie-discover-view"
    >
      {/* Title row */}
      <Stack
        direction="row"
        alignItems="baseline"
        spacing={1}
        flexWrap="wrap"
        sx={{ mb: 1.5 }}
      >
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          发现片单
        </Typography>
        <Typography variant="body2" color="text.secondary">
          按语言和题材挑一部适合练听力的片子
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="body2" color="text.secondary">
          共 {list.length} 部
        </Typography>
      </Stack>

      {/* Filter bar */}
      <CollapsiblePanel title="筛选" defaultExpanded>
        <Stack spacing={1.5}>
          {/* Language */}
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              语言
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              <Chip
                label="全部"
                size="small"
                color={filter.langs.length === 0 ? 'primary' : 'default'}
                variant={filter.langs.length === 0 ? 'filled' : 'outlined'}
                onClick={() => {
                  resetBatch();
                  setFilter((f) => ({ ...f, langs: [] }));
                }}
                data-testid="movie-filter-lang-all"
              />
              {CATALOG_LANGS.map((lang) => {
                const selected = filter.langs.includes(lang);
                return (
                  <Chip
                    key={lang}
                    label={LANG_LABELS[lang]}
                    size="small"
                    color={selected ? 'primary' : 'default'}
                    variant={selected ? 'filled' : 'outlined'}
                    onClick={() => toggleLang(lang)}
                    data-testid={`movie-filter-lang-${lang}`}
                  />
                );
              })}
            </Stack>
          </Box>

          {/* Genre */}
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              题材
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              <Chip
                label="全部"
                size="small"
                color={filter.genres.length === 0 ? 'primary' : 'default'}
                variant={filter.genres.length === 0 ? 'filled' : 'outlined'}
                onClick={() => {
                  resetBatch();
                  setFilter((f) => ({ ...f, genres: [] }));
                }}
                data-testid="movie-filter-genre-all"
              />
              {ALL_GENRES.map((genre) => {
                const selected = filter.genres.includes(genre);
                return (
                  <Chip
                    key={genre}
                    label={GENRE_LABELS[genre]}
                    size="small"
                    color={selected ? 'primary' : 'default'}
                    variant={selected ? 'filled' : 'outlined'}
                    onClick={() => toggleGenre(genre)}
                    data-testid={`movie-filter-genre-${genre}`}
                  />
                );
              })}
            </Stack>
          </Box>

          {/* Difficulty + media type + sort + shuffle + reset */}
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                难度区间
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <DifficultySelect
                  label="最低"
                  value={filter.difficulty[0]}
                  onChange={setDifficultyMin}
                />
                <Typography variant="caption" color="text.secondary">
                  ~
                </Typography>
                <DifficultySelect
                  label="最高"
                  value={filter.difficulty[1]}
                  onChange={setDifficultyMax}
                />
              </Stack>
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                形态
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={filter.mediaType}
                onChange={(_e, v) => setMediaType(v)}
              >
                <ToggleButton value="all">全部</ToggleButton>
                <ToggleButton value="movie">电影</ToggleButton>
                <ToggleButton value="series">剧集</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                排序
              </Typography>
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel>排序</InputLabel>
                <Select
                  label="排序"
                  value={sort}
                  onChange={(e) => changeSort(e.target.value as MovieSortKey)}
                >
                  {SORT_OPTIONS.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Tooltip
              title={
                sort === 'match'
                  ? '换一批精选推荐'
                  : '仅在「综合推荐」排序下可用'
              }
            >
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AutoAwesomeIcon />}
                  onClick={shuffleBatch}
                  disabled={sort !== 'match'}
                  data-testid="movie-shuffle-btn"
                >
                  换一批
                </Button>
              </span>
            </Tooltip>

            <Button
              size="small"
              variant="text"
              startIcon={<RestartAltIcon />}
              onClick={resetFilters}
              data-testid="movie-reset-btn"
            >
              重置筛选
            </Button>
          </Stack>

          {/* Search */}
          <TextField
            size="small"
            label="搜索片名 / 标签 / 简介"
            placeholder="如：friends、职场、英音"
            value={filter.query}
            onChange={(e) => setQuery(e.target.value)}
            fullWidth
            inputProps={{ 'data-testid': 'movie-search-input' }}
          />
        </Stack>
      </CollapsiblePanel>

      {/* Card grid / empty state */}
      {list.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            mt: 2,
            p: 4,
            textAlign: 'center',
            border: '1px dashed',
            borderColor: 'divider',
          }}
          data-testid="movie-empty-state"
        >
          <Typography variant="h6" sx={{ mb: 1 }}>
            没有符合条件的片子
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            试试放宽语言 / 题材 / 难度，或清除搜索关键字。
          </Typography>
          <Button variant="contained" onClick={resetFilters}>
            重置筛选
          </Button>
        </Paper>
      ) : (
        <Box
          sx={{
            mt: 2,
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              sm: 'repeat(3, 1fr)',
              md: 'repeat(4, 1fr)',
              lg: 'repeat(6, 1fr)',
            },
            gap: 2,
            alignItems: 'stretch',
          }}
          data-testid="movie-grid"
        >
          {list.map((movie) => (
            <MovieCard
              key={movie.id}
              movie={movie}
              isFavorite={isFavorite(movie.id)}
              isWatched={isWatched(movie.id)}
              onToggleFavorite={() => toggleFavorite(movie.id)}
              onToggleWatched={() => toggleWatched(movie.id)}
              onHide={() => handleHide(movie)}
              onOpenDetail={() => setDetailMovie(movie)}
              onStartLearning={
                onStartLearning ? () => onStartLearning(movie) : undefined
              }
              fitReason={sort === 'match' ? describeFit(movie, filter) : undefined}
              posterUrl={posterMap[movie.id] ?? null}
            />
          ))}
        </Box>
      )}

      <MovieDetailDialog
        movie={detailMovie}
        open={detailMovie !== null}
        onClose={() => setDetailMovie(null)}
        isFavorite={detailMovie ? isFavorite(detailMovie.id) : false}
        isWatched={detailMovie ? isWatched(detailMovie.id) : false}
        onToggleFavorite={() => detailMovie && toggleFavorite(detailMovie.id)}
        onToggleWatched={() => detailMovie && toggleWatched(detailMovie.id)}
        posterUrl={detailMovie ? posterMap[detailMovie.id] ?? null : null}
        onStartLearning={
          onStartLearning && detailMovie ? () => onStartLearning(detailMovie) : undefined
        }
      />
    </Box>
  );
}
