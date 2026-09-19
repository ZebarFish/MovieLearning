/**
 * Types for `downloader.mjs`.
 *
 * The implementation is plain JavaScript on purpose — see the header of
 * downloader.mjs. TypeScript resolves a `./downloader.mjs` import to this
 * `.d.mts` file, which is what lets `vite.config.ts` call the export without
 * pulling `@types/node` into the project.
 */
import type { PreviewServer, ViteDevServer } from 'vite';

/** Mounts the `/dl/*` download endpoints. Works on dev and preview servers. */
export declare function registerDownloadService(server: ViteDevServer | PreviewServer): void;
