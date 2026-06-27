// Minimal IndexedDB persistence for the collection. No dependencies.
//
// Two stores:
//   owned    — one record per figure (charId:variantId), with a map of the
//              physical tag UIDs seen (so duplicates are counted by real copy).
//   wishlist — figure keys the user wants but hasn't scanned.

const DB_NAME = 'portal-tracker';
const DB_VERSION = 1;
const OWNED = 'owned';
const WISHLIST = 'wishlist';

export interface TagCopy {
  uid: string;
  firstSeen: number;
  lastSeen: number;
  scans: number;
}

export interface OwnedEntry {
  key: string; // `${charId}:${variantId}`
  charId: number;
  variantId: number;
  name: string;
  section: string;
  unknown: boolean;
  copies: TagCopy[];
}

export interface WishlistEntry {
  key: string;
  charId: number;
  variantId: number;
  name: string;
  section: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

// Some environments deny IndexedDB entirely — InPrivate windows, Edge/Firefox
// strict tracking prevention, corrupted profiles — where `open` rejects with
// "UnknownError: Internal error". Rather than let that abort app startup, we
// fall back to in-memory maps so the app still runs this session (cloud sync
// keeps persisting for signed-in users; only the local cache is skipped).
let idbBroken = false;
const mem = {
  [OWNED]: new Map<string, OwnedEntry>(),
  [WISHLIST]: new Map<string, WishlistEntry>(),
} as Record<string, Map<string, OwnedEntry | WishlistEntry>>;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err); // indexedDB itself can throw on access in some sandboxes
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OWNED)) db.createObjectStore(OWNED, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(WISHLIST)) db.createObjectStore(WISHLIST, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
  return dbPromise;
}

/** Run a read against IndexedDB, falling back to the in-memory map on failure. */
async function read<T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>, fallback: () => T): Promise<T> {
  if (!idbBroken) {
    try {
      const db = await openDB();
      return await new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, 'readonly');
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      markBroken(err);
    }
  }
  return fallback();
}

/** Run a write against IndexedDB, falling back to the in-memory map on failure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function write(store: string, fn: (s: IDBObjectStore) => IDBRequest<any>, fallback: () => void): Promise<void> {
  if (!idbBroken) {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
      return;
    } catch (err) {
      markBroken(err);
    }
  }
  fallback();
}

function markBroken(err: unknown): void {
  if (!idbBroken) {
    idbBroken = true;
    console.warn('Local storage (IndexedDB) is unavailable — your collection won’t be saved on this device this session. Sign in to sync to the cloud.', err);
  }
}

/** True once IndexedDB has failed and the in-memory fallback is in use. */
export const localStorageBroken = () => idbBroken;

export const ownedGetAll = () =>
  read<OwnedEntry[]>(OWNED, (s) => s.getAll(), () => [...mem[OWNED].values()] as OwnedEntry[]);
export const ownedPut = (e: OwnedEntry) =>
  write(OWNED, (s) => s.put(e), () => void mem[OWNED].set(e.key, e));
export const ownedDelete = (key: string) =>
  write(OWNED, (s) => s.delete(key), () => void mem[OWNED].delete(key));
export const ownedClear = () =>
  write(OWNED, (s) => s.clear(), () => mem[OWNED].clear());

export const wishlistGetAll = () =>
  read<WishlistEntry[]>(WISHLIST, (s) => s.getAll(), () => [...mem[WISHLIST].values()] as WishlistEntry[]);
export const wishlistPut = (e: WishlistEntry) =>
  write(WISHLIST, (s) => s.put(e), () => void mem[WISHLIST].set(e.key, e));
export const wishlistDelete = (key: string) =>
  write(WISHLIST, (s) => s.delete(key), () => void mem[WISHLIST].delete(key));
export const wishlistClear = () =>
  write(WISHLIST, (s) => s.clear(), () => mem[WISHLIST].clear());
