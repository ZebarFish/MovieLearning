import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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

// Optional TMDB poster enrichment for the discovery page. The catalog ships
// without posters; this proxy is only used when a TMDB API key is configured.
// The poster IMAGE itself is a direct <img> src (image.tmdb.org) and needs no
// proxy. Clients (src/utils/tmdb.ts) prefix these paths via USE_LOCAL_PROXY.
const TMDB_PROXY = {
  '/tmdb': {
    target: 'https://api.themoviedb.org/3',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/tmdb/, ''),
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: { ...DICT_PROXY, ...TMDB_PROXY },
  },
  preview: {
    port: 5180,
    strictPort: true,
    open: true,
    proxy: { ...DICT_PROXY, ...TMDB_PROXY },
  },
});
