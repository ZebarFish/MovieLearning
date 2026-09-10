/**
 * Save subtitle files into a user-chosen folder (e.g. the project's
 * 资源文件夹) via the File System Access API.
 *
 * The directory handle is persisted in IndexedDB, so the folder is picked
 * once and later saves go there automatically (Chrome/Edge only — the API
 * is unavailable elsewhere, callers should fall back to a plain download).
 */

const DB_NAME = 'subtitle-fs';
const STORE = 'handles';
const KEY = 'resources-dir';

/* eslint-disable @typescript-eslint/no-explicit-any */
type DirHandle = any;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<any> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: any): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Whether the File System Access API is available in this browser. */
export function canWriteToFolder(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function';
}

/** The remembered resources folder, or null if none was picked yet. */
export async function getSavedDir(): Promise<DirHandle | null> {
  try {
    return await idbGet(KEY);
  } catch {
    return null;
  }
}

/** Remember the folder for future saves. */
export async function setSavedDir(dir: DirHandle): Promise<void> {
  await idbSet(KEY, dir);
}

/** Prompt the user to pick the resources folder (called on first save). */
export async function pickResourcesDir(): Promise<DirHandle | null> {
  if (!canWriteToFolder()) return null;
  const dir = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  await setSavedDir(dir);
  return dir;
}

/** Check/request read-write permission on a remembered folder handle. */
export async function ensureDirPermission(
  dir: DirHandle,
): Promise<boolean> {
  try {
    if ((await dir.queryPermission?.({ mode: 'readwrite' })) === 'granted') {
      return true;
    }
    return (
      (await dir.requestPermission?.({ mode: 'readwrite' })) === 'granted'
    );
  } catch {
    return false;
  }
}

/** Write `text` as `filename` into `dir`. */
export async function saveTextToDir(
  dir: DirHandle,
  filename: string,
  text: string,
): Promise<void> {
  const fh = await dir.getFileHandle(filename, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

/**
 * Fallback for browsers without File System Access: trigger a normal
 * browser download (goes to the Downloads folder).
 */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
