/**
 * Types for `dictionary.mjs`.
 *
 * The implementation is plain JavaScript on purpose — see the header of
 * dictionary.mjs. TypeScript resolves a `./dictionary.mjs` import to this
 * `.d.mts` file, which is what lets `vite.config.ts` call the export without
 * pulling `@types/node` into the project.
 */
import type { PreviewServer, ViteDevServer } from 'vite';

/** Mounts the `/dict/offline/*` lookup endpoints. Works on dev and preview servers. */
export declare function registerDictionaryService(server: ViteDevServer | PreviewServer): void;
