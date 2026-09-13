/**
 * localProxy
 *
 * Several browser-side calls to public APIs (dictionaries, machine
 * translation) fail in the field: CORS blocks them, and on CN networks the
 * direct hosts are often unreachable. Vite's dev/preview server can proxy
 * them server-side, which fixes both problems.
 *
 * Whether that proxy is available depends on RUNTIME, not on the build:
 * `import.meta.env.DEV` is compiled in as `false` for a production bundle,
 * yet `vite preview` still serves that bundle from localhost with a working
 * proxy. So we key off the page's hostname instead.
 */

export const IS_TEST = Boolean(import.meta.env.VITEST);

/** True when the page is served from this machine (dev server or preview). */
export const SERVED_LOCALLY =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(window.location.hostname);

/** True when `/dict/*` requests will be proxied by the Vite server. */
export const USE_LOCAL_PROXY =
  !IS_TEST && (Boolean(import.meta.env.DEV) || SERVED_LOCALLY);
