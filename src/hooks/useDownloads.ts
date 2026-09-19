/**
 * useDownloads — state for the download centre.
 *
 * The transfers live on the server, so this hook is only a view of them: it
 * reads the task list and forwards commands. It polls **only while something
 * is actually downloading**, which keeps an idle download page (and every test
 * that happens to render it) completely quiet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DownloadApiError,
  cancelDownload,
  isDownloadAvailable,
  listDownloads,
  pauseDownload,
  removeDownload,
  resumeDownload,
  startDownload,
  type DownloadTask,
} from '../utils/downloader';

/** Fast enough to feel live, slow enough not to spam the local server. */
const POLL_INTERVAL_MS = 800;

export interface UseDownloadsResult {
  tasks: DownloadTask[];
  /** Where the files land on disk (empty until the first successful load). */
  dir: string;
  available: boolean;
  /** True only for the first load, so the UI can tell "loading" from "empty". */
  loading: boolean;
  busy: boolean;
  error: string;
  refresh: () => Promise<void>;
  /** Each mutation resolves `true` when it succeeded, so a form can reset. */
  start: (url: string, filename?: string) => Promise<boolean>;
  pause: (id: string) => Promise<boolean>;
  resume: (id: string) => Promise<boolean>;
  cancel: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
}

const describe = (err: unknown): string => {
  if (err instanceof DownloadApiError) return err.message;
  return err instanceof Error ? err.message : '操作失败。';
};

export function useDownloads(): UseDownloadsResult {
  const available = isDownloadAvailable();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [dir, setDir] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(available);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Guards every setState below: the poll interval and an in-flight mutation
  // can both outlive the component.
  const aliveRef = useRef<boolean>(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!available) return;
    try {
      const listing = await listDownloads();
      if (!aliveRef.current) return;
      setTasks(listing.tasks);
      setDir(listing.dir);
      setError('');
    } catch (err) {
      if (!aliveRef.current) return;
      setError(describe(err));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [available]);

  // The interval below reads the LATEST refresh without depending on it, so a
  // re-render never tears down and rebuilds the timer mid-download.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!available) {
      setLoading(false);
      return;
    }
    void refreshRef.current();
  }, [available]);

  const hasActive = useMemo(
    () => tasks.some((task) => task.status === 'downloading'),
    [tasks],
  );

  useEffect(() => {
    if (!available || !hasActive) return undefined;
    const timer = window.setInterval(() => {
      void refreshRef.current();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [available, hasActive]);

  /**
   * Run a mutation, refresh the list afterwards, and surface any failure.
   *
   * The failure text is re-applied AFTER the refresh: a successful refresh
   * clears the error slot (that is how a recovered load stops showing a stale
   * message), and without the second write it would wipe the very explanation
   * we just produced — leaving the user with a button that did nothing.
   */
  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      if (!available) return false;
      let failure: string | null = null;
      setBusy(true);
      try {
        await action();
      } catch (err) {
        failure = describe(err);
      } finally {
        if (aliveRef.current) setBusy(false);
        await refreshRef.current();
      }
      if (aliveRef.current && failure !== null) setError(failure);
      return failure === null;
    },
    [available],
  );

  const start = useCallback(
    (url: string, filename?: string) => run(() => startDownload(url, filename)),
    [run],
  );
  const pause = useCallback((id: string) => run(() => pauseDownload(id)), [run]);
  const resume = useCallback((id: string) => run(() => resumeDownload(id)), [run]);
  const cancel = useCallback((id: string) => run(() => cancelDownload(id)), [run]);
  const remove = useCallback((id: string) => run(() => removeDownload(id)), [run]);

  return {
    tasks,
    dir,
    available,
    loading,
    busy,
    error,
    refresh,
    start,
    pause,
    resume,
    cancel,
    remove,
  };
}
