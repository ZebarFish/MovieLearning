import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dictionary API proxies. Browser-side requests to external dictionary
// services suffer from CORS blocks and unstable direct connectivity (CN
// networks); routing them through the dev server fixes both. The client
// (src/utils/dictionary.ts) prefixes these paths in dev mode.
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
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: DICT_PROXY,
  },
  preview: {
    proxy: DICT_PROXY,
  },
});
