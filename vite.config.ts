import { defineConfig } from 'vite';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { registerDownloadService } from './server/downloader.mjs';

// Dictionary + translation API proxies. Browser-side requests to external
// services suffer from CORS blocks and unstable direct connectivity (CN
// networks); routing them through the dev server fixes both. The clients
// (src/utils/dictionary.ts, src/utils/translate.ts) prefix these paths
// whenever the app is served from localhost.
const DICT_PROXY = {
  '/dict/api': {
    target: 'https://api.dictionaryapi.dev',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/dict\/api/, '/api/v2'),
  },
  '/dict/youdao': {
    target: 'https://dict.youdao.com',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/dict\/youdao/, ''),
  },
  '/dict/datamuse': {
    target: 'https://api.datamuse.com',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/dict\/datamuse/, ''),
  },
  // Sentence translation for the Anki card's 例句释义 field.
  '/dict/mymemory': {
    target: 'https://api.mymemory.translated.net',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/dict\/mymemory/, ''),
  },
};

// Poster providers for the discovery page (see src/utils/posters.ts).
//
// TMDB is not the default because api.themoviedb.org times out on many CN
// connections, and www.themoviedb.org — where you register for a key — can be
// blocked too. The catalog therefore resolves posters through keyless sources
// that DO answer here: Douban matches our Chinese titles best, TVmaze is
// near-perfect for series. TMDB is used first only when the user has a key.
//
// iTunes Search was removed: its `entity=movie` returns zero results in every
// region tried, and TVmaze already covers every series iTunes could find.
const POSTER_PROXY = {
  '/poster/douban': {
    target: 'https://movie.douban.com',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/poster\/douban/, ''),
    headers: { Referer: 'https://movie.douban.com/' },
  },
  '/poster/tvmaze': {
    target: 'https://api.tvmaze.com',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/poster\/tvmaze/, ''),
  },
  '/tmdb': {
    target: 'https://api.themoviedb.org/3',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/tmdb/, ''),
  },
};

const PROXY = { ...DICT_PROXY, ...POSTER_PROXY };

/**
 * Image hosts `/poster-img` may re-fetch. An allowlist keeps the endpoint from
 * becoming an open proxy.
 */
const POSTER_IMAGE_HOSTS = [
  /(^|\.)doubanio\.com$/,
  /(^|\.)tvmaze\.com$/,
  /(^|\.)tmdb\.org$/,
];

/**
 * Douban's image CDN rejects hotlinks — 418 with no Referer, 403 with a
 * localhost one — so its posters cannot be used as a plain `<img src>`. This
 * middleware re-fetches the image server-side with a plausible Referer and
 * streams the bytes back, which also sidesteps CORS.
 *
 * Usage: `/poster-img?u=<encodeURIComponent(absolute image url)>`
 *
 * The handler is written as an inline arrow so its parameters are contextually
 * typed by Vite; the request/response surface it touches is deliberately tiny
 * (`url`, `statusCode`, `setHeader`, `end`) so this file needs no `@types/node`
 * — it is the only Node-side file in the project.
 */
function registerPosterImageProxy(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use('/poster-img', (req, res) => {
    void (async (): Promise<void> => {
      const target = ((): URL | null => {
        try {
          // `req` is typed by Vite through connect, whose `IncomingMessage`
          // shape is not fully resolvable without @types/node; the middleware
          // only ever reads `url`, so read it structurally.
          const raw = new URL(
            String((req as { url?: unknown }).url ?? ''),
            'http://localhost',
          ).searchParams.get('u');
          return raw ? new URL(raw) : null;
        } catch {
          return null;
        }
      })();

      if (!target || target.protocol !== 'https:') {
        res.statusCode = 400;
        res.end('bad url');
        return;
      }
      if (!POSTER_IMAGE_HOSTS.some((re) => re.test(target.hostname))) {
        res.statusCode = 403;
        res.end('host not allowed');
        return;
      }

      try {
        const upstream = await fetch(target, {
          headers: {
            // Douban only serves its posters to a matching referer.
            Referer: 'https://movie.douban.com/',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          },
        });
        if (!upstream.ok) {
          res.statusCode = 502;
          res.end(`upstream ${upstream.status}`);
          return;
        }
        // Uint8Array is a valid `end()` payload and avoids the Node-only Buffer.
        const buf = new Uint8Array(await upstream.arrayBuffer());
        res.setHeader(
          'Content-Type',
          upstream.headers.get('content-type') ?? 'image/jpeg',
        );
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.statusCode = 200;
        res.end(buf);
      } catch {
        res.statusCode = 502;
        res.end('fetch failed');
      }
    })();
  });
}

function posterImageProxy(): Plugin {
  return {
    name: 'poster-image-proxy',
    configureServer(server) {
      registerPosterImageProxy(server);
    },
    configurePreviewServer(server) {
      registerPosterImageProxy(server);
    },
  };
}

/**
 * The download centre (`/dl/*`).
 *
 * The transfer itself lives in `server/downloader.mjs` — it has to run here
 * rather than in the page, because a browser tab cannot keep downloading after
 * the user navigates away. Like the poster proxy it is registered on BOTH
 * servers, so it works in `vite dev` and in the `vite preview` build that
 * `start.bat` launches.
 */
function downloadService(): Plugin {
  return {
    name: 'download-service',
    configureServer(server) {
      registerDownloadService(server);
    },
    configurePreviewServer(server) {
      registerDownloadService(server);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), posterImageProxy(), downloadService()],
  server: {
    port: 5173,
    open: true,
    proxy: PROXY,
  },
  preview: {
    port: 5180,
    strictPort: true,
    open: true,
    proxy: PROXY,
  },
});
