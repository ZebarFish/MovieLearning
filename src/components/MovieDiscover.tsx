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
  Link,
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
import {
  clearPosterCache,
  fetchPosterUrl,
  isDoubanBlocked,
  resetPosterSources,
} from '../utils/posters';
import { getTmdbApiKey, setTmdbApiKey } from '../utils/tmdb';
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

/**
 * Poster lookups run through a small worker pool. Fetching ~65 titles one at a
 * time would take tens of seconds; an unbounded fan-out would hammer the APIs.
 * Douban additionally paces its own requests internally.
 */
const POSTER_CONCURRENCY = 6;

/** Free API key signup page, linked from the poster panel. */
const TMDB_SIGNUP_URL = 'https://www.themoviedb.org/settings/api';

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

  // --- Poster backfill (see src/utils/posters.ts) ---------------------------
  const [posterMap, setPosterMap] = useState<Record<string, string>>({});
  const [posterLoading, setPosterLoading] = useState<boolean>(false);
  /** Bumped by 「重新拉取海报」 to force a fresh pass after clearing the cache. */
  const [posterReload, setPosterReload] = useState<number>(0);
  /** True once the keyless film source stopped answering (rate limited). */
  const [sourceBlocked, setSourceBlocked] = useState<boolean>(false);
  // `tmdbKey` is React state rather than a direct `getTmdbApiKey()` call so that
  // saving a key re-runs the lookup immediately — no page reload needed.
  const [tmdbKey, setTmdbKey] = useState<string>(() => getTmdbApiKey());
  const [keyDraft, setKeyDraft] = useState<string>(() => getTmdbApiKey());
  const hasKey = tmdbKey.trim().length > 0;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setPosterLoading(true);

    (async () => {
      const next: Record<string, string> = {};
      // Shared cursor + N workers = the same set is covered exactly once.
      // `cursor++` happens synchronously between awaits, so it is race-free.
      // Douban paces itself internally, so this fan-out only parallelises the
      // providers that tolerate it.
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(POSTER_CONCURRENCY, list.length) },
        async () => {
          for (;;) {
            const i = cursor++;
            if (i >= list.length) return;
            const movie = list[i];
            if (!movie) continue;
            const url = await fetchPosterUrl(movie, controller.signal);
            if (url) next[movie.id] = url;
          }
        },
      );
      await Promise.all(workers);
      if (!cancelled) {
        setPosterMap(next);
        setSourceBlocked(isDoubanBlocked());
        setPosterLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [list, posterReload, hasKey, tmdbKey]);

  const reloadPosters = (): void => {
    clearPosterCache();
    resetPosterSources();
    setPosterMap({});
    setSourceBlocked(false);
    setPosterReload((n) => n + 1);
  };

  const saveTmdbKey = (): void => {
    const next = keyDraft.trim();
    setTmdbApiKey(next); // also drops the poster cache, so the new key applies
    setTmdbKey(next);
  };

  const clearTmdbKey = (): void => {
    setTmdbApiKey('');
    setKeyDraft('');
    setTmdbKey('');
  };

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

      {/* Poster status + optional TMDB upgrade. Series posters resolve
          automatically from TVmaze and film posters from Douban; nothing is
          required. A TMDB key lifts coverage to essentially everything. */}
      <CollapsiblePanel
        title="海报"
        hint={
          posterLoading
            ? '正在补图…'
            : Object.keys(posterMap).length < list.length
              ? `已载入 ${Object.keys(posterMap).length}/${list.length} 张（点开看原因）`
              : `已全部载入 · ${list.length} 张`
        }
        defaultExpanded={sourceBlocked}
      >
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            海报按片名自动匹配，无需配置：剧集走 TVmaze，电影走豆瓣。匹配不到的片子保留占位图。
            海报为第三方内容，仅在本机预览使用。
          </Typography>

          {sourceBlocked && (
            <Typography variant="caption" color="warning.main">
              豆瓣暂时限制了本机请求（短时间内请求过多会触发），已暂停自动补图。稍后点「重新拉取海报」
              重试，或填入 TMDB API Key 改用更稳定的图源。
            </Typography>
          )}

          {!posterLoading &&
            !hasKey &&
            list.length > 0 &&
            Object.keys(posterMap).length < list.length && (
              <Typography variant="caption" color="text.secondary">
                有 {list.length - Object.keys(posterMap).length} 部没匹配到海报：可能是片名对不上，
                也可能是图源临时限流。稍后再点「重新拉取海报」，或填下面的 TMDB Key 提高命中。
              </Typography>
            )}

          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              onClick={reloadPosters}
              disabled={posterLoading}
              data-testid="poster-reload"
            >
              重新拉取海报
            </Button>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ pt: 0.5 }}>
            如果想要更全、更准的海报，可填一个 TMDB API Key（有 Key 时优先走 TMDB）。
            Key 只保存在本机浏览器，不会上传到任何服务器。可到{' '}
            <Link
              href={TMDB_SIGNUP_URL}
              target="_blank"
              rel="noreferrer noopener"
              underline="hover"
            >
              themoviedb.org
            </Link>{' '}
            免费申请（注册后进「设置 → API」选 v3 auth）。国内网络通常需要代理才能访问。
          </Typography>

          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              fullWidth
              label="TMDB API Key"
              placeholder="粘贴 v3 API Key（留空则只用免 Key 图源）"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              inputProps={{ 'data-testid': 'tmdb-key-input' }}
            />
            <Button
              size="small"
              variant="contained"
              onClick={saveTmdbKey}
              data-testid="tmdb-key-save"
            >
              保存
            </Button>
            <Button size="small" onClick={clearTmdbKey} data-testid="tmdb-key-clear">
              清除
            </Button>
          </Stack>
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
