/**
 * MovieDiscover 测试
 *
 * 覆盖：首屏列表与计数、语言/题材筛选、搜索过滤、换一批、收藏写入
 * localStorage、海报解析成功时渲染 <img>、以及解析不到时的占位降级。
 *
 * 海报解析模块被 mock 掉 —— 真实实现会访问豆瓣 / TVmaze / iTunes，
 * 测试里不应该发真实网络请求（既慢又不稳）。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MovieDiscover } from './MovieDiscover';
import { MOVIE_CATALOG, CATALOG_LANGS } from '../data/movieCatalog';
import { ALL_GENRES } from '../utils/movieRecommend';
import { fetchPosterUrl } from '../utils/posters';
import type { MovieEntry } from '../types';

vi.mock('../utils/posters', () => ({
  fetchPosterUrl: vi.fn(async () => null),
  clearPosterCache: vi.fn(),
}));

const PREFS_KEY = 'letv.moviePrefs.v1';

const byId = new Map<string, MovieEntry>(MOVIE_CATALOG.map((m) => [m.id, m]));

function getGrid(): HTMLElement {
  return screen.getByTestId('movie-grid');
}

function gridIds(): string[] {
  return Array.from(getGrid().children).map((c) =>
    (c.getAttribute('data-testid') ?? '').replace('movie-card-', ''),
  );
}

function matchesQuery(m: MovieEntry, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [m.title, m.originalTitle, m.synopsis, ...m.tags]
    .filter((t): t is string => typeof t === 'string')
    .some((t) => t.toLowerCase().includes(s));
}

beforeEach(() => {
  localStorage.clear();
  // 默认：所有片子都解析不到海报 → 走占位块分支。
  vi.mocked(fetchPosterUrl).mockReset();
  vi.mocked(fetchPosterUrl).mockResolvedValue(null);
});

describe('MovieDiscover — 首屏渲染', () => {
  it('lists the catalog and the count matches the number of cards', () => {
    render(<MovieDiscover />);
    const grid = getGrid();
    const count = grid.children.length;
    expect(count).toBe(MOVIE_CATALOG.length);

    // 结果计数「共 N 部」与卡片数一致
    expect(screen.getByText(new RegExp(`共 ${count} 部`))).toBeTruthy();
  });
});

describe('MovieDiscover — 语言筛选', () => {
  it('clicking a language chip keeps only that language and updates the count', () => {
    const lang = CATALOG_LANGS.find((l) =>
      MOVIE_CATALOG.some((m) => m.langs.includes(l)),
    );
    expect(lang).toBeTruthy();

    render(<MovieDiscover />);
    fireEvent.click(screen.getByTestId(`movie-filter-lang-${lang}`));

    const ids = gridIds();
    const expected = MOVIE_CATALOG.filter((m) => m.langs.includes(lang!)).length;
    expect(ids.length).toBe(expected);
    for (const id of ids) {
      expect(byId.get(id)!.langs.includes(lang!)).toBe(true);
    }
    expect(screen.getByText(new RegExp(`共 ${expected} 部`))).toBeTruthy();
  });
});

describe('MovieDiscover — 题材筛选', () => {
  it('clicking a genre chip keeps only that genre', () => {
    const genre = ALL_GENRES.find((g) =>
      MOVIE_CATALOG.some((m) => m.genres.includes(g)),
    );
    expect(genre).toBeTruthy();

    render(<MovieDiscover />);
    fireEvent.click(screen.getByTestId(`movie-filter-genre-${genre}`));

    const ids = gridIds();
    const expected = MOVIE_CATALOG.filter((m) => m.genres.includes(genre!)).length;
    expect(ids.length).toBe(expected);
    for (const id of ids) {
      expect(byId.get(id)!.genres.includes(genre!)).toBe(true);
    }
  });
});

describe('MovieDiscover — 搜索过滤', () => {
  it('typing in the search box filters by title', () => {
    const sample = MOVIE_CATALOG[0];
    expect(sample).toBeTruthy();

    render(<MovieDiscover />);
    const input = screen.getByTestId('movie-search-input');
    fireEvent.change(input, { target: { value: sample.title } });

    const ids = gridIds();
    expect(ids.length).toBeGreaterThanOrEqual(1);
    // 选中的影片一定在结果里
    expect(ids).toContain(sample.id);
    // 每条结果都确实命中关键字
    for (const id of ids) {
      expect(matchesQuery(byId.get(id)!, sample.title)).toBe(true);
    }
  });
});

describe('MovieDiscover — 换一批', () => {
  it('changes the displayed set while staying a subset of the filtered results', async () => {
    render(<MovieDiscover />);
    const before = gridIds();
    const allIds = new Set(MOVIE_CATALOG.map((m) => m.id));

    fireEvent.click(screen.getByTestId('movie-shuffle-btn'));

    const after = gridIds();
    // 仍是筛选结果（默认无筛选 = 全集）的子集
    for (const id of after) {
      expect(allIds.has(id)).toBe(true);
    }
    // 集合 / 顺序发生变化
    expect(after.join(',')).not.toBe(before.join(','));
  });
});

describe('MovieDiscover — 收藏', () => {
  it('toggles favorite state and writes to localStorage', async () => {
    render(<MovieDiscover />);
    const id = gridIds()[0];
    const favBtn = screen.getByTestId(`movie-card-fav-${id}`);

    // 初始未收藏
    expect(favBtn.getAttribute('aria-label')).toBe('收藏');

    fireEvent.click(favBtn);

    // 按钮状态翻转
    await waitFor(() => {
      expect(screen.getByTestId(`movie-card-fav-${id}`).getAttribute('aria-label')).toBe(
        '取消收藏',
      );
    });

    // localStorage 被写入
    await waitFor(() => {
      const raw = localStorage.getItem(PREFS_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!) as { favorites: string[] };
      expect(parsed.favorites).toContain(id);
    });
  });
});

describe('MovieDiscover — 海报', () => {
  it('renders the resolved poster as an <img> for that card', async () => {
    const target = MOVIE_CATALOG[0];
    expect(target).toBeTruthy();
    const url = 'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg';

    vi.mocked(fetchPosterUrl).mockImplementation(async (m) =>
      m.id === target!.id ? url : null,
    );

    const { container } = render(<MovieDiscover />);

    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toBeTruthy();
      expect(img?.getAttribute('src')).toBe(url);
    });
    // 只有解析成功的那一张是 <img>，其余仍是占位块。
    expect(container.querySelectorAll('img').length).toBe(1);
  });

  it('falls back to a placeholder and does not crash when nothing resolves', async () => {
    const { container } = render(<MovieDiscover />);
    const firstId = gridIds()[0];

    // 占位块存在（海报区 data-testid）
    expect(screen.getByTestId(`movie-card-poster-${firstId}`)).toBeTruthy();
    // 不应渲染任何 <img>
    expect(container.querySelectorAll('img').length).toBe(0);
  });
});
